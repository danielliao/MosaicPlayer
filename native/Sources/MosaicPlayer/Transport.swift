import Foundation
import QuartzCore
import MosaicCore

@MainActor final class SyncTransport {
    var onState: ((WallState) -> Void)?
    var onStatus: ((Bool, String) -> Void)?
    var onValidated: ((PlayerConnection) -> Void)?
    var onRejected: (() -> Void)?
    var onCommand: (([String: Any]) -> Void)?
    private(set) var connection: PlayerConnection?
    private(set) var connected = false
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var timer: Timer?
    private var pingCounter = 0
    private var generation = 0
    private var pendingPings: [Int: Double] = [:]
    private var clock = ClockEstimator()
    private var backoff: Double = 1
    private let wallAnchor = Date().timeIntervalSince1970 * 1000
    private let monotonicAnchor = CACurrentMediaTime() * 1000
    private let delegate = NoRedirectDelegate()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    }()
    var localNow: Double { wallAnchor + CACurrentMediaTime() * 1000 - monotonicAnchor }
    var serverNow: Double { localNow + clock.offset }
    var clockReady: Bool { clock.ready }
    var latency: Double? { clock.rtt }

    func connect(_ connection: PlayerConnection) {
        disconnect(); self.connection = connection; clock.reset(); backoff = 1
        open()
        timer = Timer(timeInterval: 3, repeats: true) { [weak self] _ in Task { @MainActor in self?.ping() } }
        if let timer { RunLoop.main.add(timer, forMode: .common) }
    }
    func disconnect() {
        generation += 1; receiveTask?.cancel(); retryTask?.cancel()
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        timer?.invalidate(); timer = nil; connected = false; connection = nil
        pendingPings.removeAll(); clock.reset()
    }
    func recalibrate() {
        clock.reset(); pendingPings.removeAll()
        Task { @MainActor [weak self] in
            for _ in 0..<8 { self?.ping(); try? await Task.sleep(nanoseconds: 120_000_000) }
        }
    }
    private func open() {
        guard let connection else { return }
        generation += 1
        let version = generation
        onStatus?(false, "正在连接 \(connection.origin.host ?? "后台")…")
        receiveTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let (data, response) = try await self.session.data(for: connection.request("/api/state"))
                guard self.generation == version else { return }
                guard let http = response as? HTTPURLResponse else { throw PlayerError.download }
                if http.statusCode == 401 || http.statusCode == 403 { throw PlayerError.unauthorized }
                guard http.statusCode == 200 else { throw URLError(.badServerResponse) }
                let initial = try JSONDecoder().decode(ServerMessage.self, from: data)
                if let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let commands = envelope["commands"] as? [[String: Any]] { commands.forEach { self.onCommand?($0) } }
                guard let state = initial.state, state.isValid else { throw PlayerError.invalidLayout }
                guard state.layout.screens.contains(where: { $0.id == connection.screenID }) else { throw PlayerError.missingScreen }
                self.onValidated?(connection)
                let socket = self.session.webSocketTask(with: connection.request("/ws", websocket: true))
                self.socket = socket; socket.resume()
                self.onState?(state)
                while !Task.isCancelled, self.generation == version {
                    let message = try await socket.receive()
                    guard self.generation == version else { return }
                    if !self.connected {
                        self.connected = true; self.backoff = 1; self.onStatus?(true, "同步服务已连接"); self.recalibrate()
                    }
                    let payload: Data
                    switch message { case .data(let data): payload = data; case .string(let text): payload = Data(text.utf8); @unknown default: continue }
                    let decoded = try JSONDecoder().decode(ServerMessage.self, from: payload)
                    if decoded.type == "command", let envelope = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
                       let command = envelope["command"] as? [String: Any] { self.onCommand?(command) }
                    if decoded.type == "clock", let id = decoded.id, let server = decoded.serverTime, let sent = self.pendingPings.removeValue(forKey: id) {
                        self.clock.record(sent: sent, received: self.localNow, server: server)
                    }
                    if decoded.type == "state", let state = decoded.state {
                        guard state.isValid else { throw PlayerError.invalidLayout }
                        guard state.layout.screens.contains(where: { $0.id == connection.screenID }) else { throw PlayerError.missingScreen }
                        self.onState?(state)
                    }
                }
            } catch {
                guard self.generation == version, !Task.isCancelled else { return }
                self.connected = false; self.socket?.cancel(with: .goingAway, reason: nil); self.socket = nil
                if let error = error as? PlayerError {
                    self.onStatus?(false, error.localizedDescription)
                    self.connection = nil; self.timer?.invalidate(); self.timer = nil
                    self.onRejected?()
                    return
                }
                // Never interpolate NSError URLs: they may contain credentials from external servers.
                self.onStatus?(false, "连接中断，继续播放本机缓存；正在自动重连…")
                let delay = self.backoff; self.backoff = min(10, self.backoff * 1.7)
                self.retryTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    guard !Task.isCancelled, self?.generation == version else { return }
                    self?.open()
                }
            }
        }
    }
    private func ping() {
        guard connected else { return }
        pingCounter += 1; pendingPings[pingCounter] = localNow
        pendingPings = pendingPings.filter { localNow - $0.value < 10_000 }
        send(["type": "clock", "id": pingCounter])
    }
    func send(_ payload: [String: Any]) {
        guard let socket, connected, let data = try? JSONSerialization.data(withJSONObject: payload), let text = String(data: data, encoding: .utf8) else { return }
        Task { try? await socket.send(.string(text)) }
    }
}
