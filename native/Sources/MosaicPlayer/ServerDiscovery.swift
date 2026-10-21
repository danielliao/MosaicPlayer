import Foundation
import Darwin
import MosaicCore

struct FoundServer {
    let address: ServerAddress
    let catalog: ServerCatalog
    let source: String
}

// Only unauthenticated service identity is probed. Saved playback credentials
// are never sent to an automatically discovered address.
// Services and browser are created and scheduled on the main run loop.
@MainActor final class ServerDiscovery: NSObject, @preconcurrency NetServiceBrowserDelegate, @preconcurrency NetServiceDelegate {
    var onResults: (([FoundServer]) -> Void)?
    var onStatus: ((String) -> Void)?
    private(set) var results: [FoundServer] = []
    private let redirectDelegate = NoRedirectDelegate()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2
        config.timeoutIntervalForResource = 3
        config.waitsForConnectivity = false
        return URLSession(configuration: config, delegate: redirectDelegate, delegateQueue: nil)
    }()
    private var browser: NetServiceBrowser?
    private var services: [NetService] = []
    private var task: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var resolvedTasks: [Task<Void, Never>] = []
    private var generation = 0

    func catalog(at address: ServerAddress, timeout: Double = 2) async throws -> ServerCatalog {
        var request = URLRequest(url: address.url.appendingPathComponent("api/discovery"))
        request.timeoutInterval = timeout
        let (data, response) = try await responseData(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              data.count <= 65_536,
              let catalog = try? JSONDecoder().decode(ServerCatalog.self, from: data),
              catalog.isValid else { throw DiscoveryError.incompatible }
        return catalog
    }
    func resolve(at address: ServerAddress, code: String) async throws -> [FoundServer] {
        var request = URLRequest(url: address.url.appendingPathComponent("api/pairing/resolve"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
        let (data, response) = try await responseData(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let groups = object["groups"] as? [[String: Any]] else { throw DiscoveryError.invalidReply }
        return try groups.map { group in
            guard let layout = group["layout"] as? [String: Any] else { throw DiscoveryError.invalidReply }
            let data = try JSONSerialization.data(withJSONObject: [
                "service": "mosaic-player", "protocolVersion": 2, "serverId": group["id"] ?? "",
                "name": group["name"] ?? "播放组", "published": true, "cols": layout["cols"] ?? 1,
                "rows": layout["rows"] ?? 1, "screens": layout["screens"] ?? [], "mode": layout["mode"] ?? "grid",
            ])
            let catalog = try JSONDecoder().decode(ServerCatalog.self, from: data)
            guard catalog.isValid else { throw DiscoveryError.invalidReply }
            return FoundServer(address: address, catalog: catalog, source: "门店配对授权")
        }
    }
    func pair(at address: ServerAddress, screen: PublishedScreen, code: String = "") async throws -> PlayerConnection {
        var request = URLRequest(url: address.url.appendingPathComponent("api/pair"))
        request.httpMethod = "POST"
        request.setValue("programs,audio,screenshot,freeform", forHTTPHeaderField: "X-Mosaic-Capabilities")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["screenId": screen.id, "code": code, "name": Host.current().localizedName ?? "Mac", "client": "native-macos"])
        let (data, response) = try await responseData(for: request)
        guard let http = response as? HTTPURLResponse else { throw DiscoveryError.unavailable }
        if http.statusCode == 409 { throw DiscoveryError.occupied }
        if http.statusCode == 403 { throw DiscoveryError.notPublished }
        guard (200...299).contains(http.statusCode), let value = try JSONSerialization.jsonObject(with: data) as? [String: String],
              value["screenId"] == screen.id, let key = value["key"] else { throw DiscoveryError.invalidReply }
        var link = URLComponents(url: address.url, resolvingAgainstBaseURL: false)!
        link.path = "/play"
        link.queryItems = [.init(name: "screen", value: screen.id), .init(name: "key", value: key)]
        return try PlayerConnection(link: link.string!)
    }
    private func responseData(for request: URLRequest) async throws -> (Data, URLResponse) {
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard response.expectedContentLength <= 65_536 else { throw DiscoveryError.incompatible }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < 65_536 else { throw DiscoveryError.incompatible }
            data.append(byte)
        }
        return (data, response)
    }
    func discover(preferred: [ServerAddress], forceScan: Bool = false) {
        stop(); results = []; onResults?(results)
        let version = generation
        onStatus?("正在尝试已保存和内置的服务器地址…")
        task = Task { [weak self] in
            guard let self else { return }
            for address in preferred {
                guard !Task.isCancelled, version == self.generation else { return }
                if let catalog = try? await self.catalog(at: address) {
                    self.add(FoundServer(address: address, catalog: catalog, source: "已配置地址"), version: version)
                    if !forceScan { self.onStatus?("已找到服务器，请选择本机对应的屏幕。"); return }
                }
            }
            guard !Task.isCancelled, version == self.generation else { return }
            self.onStatus?("正在搜索局域网：Bonjour 与本网段，最多 45 秒…")
            self.beginBonjour()
            self.deadline = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                guard !Task.isCancelled, let self, self.generation == version else { return }
                self.stop()
                self.onStatus?(self.results.isEmpty ? "未找到服务器。可手工输入地址，或检查局域网权限与网络连通性。" : "搜索已结束，请选择服务器与屏幕。")
            }
            let addresses = Self.localCandidates()
            // Bound active probes instead of launching a task for every host.
            await withTaskGroup(of: FoundServer?.self) { group in
                var iterator = addresses.makeIterator()
                func enqueue(_ address: ServerAddress) {
                    group.addTask { [weak self] in
                        guard !Task.isCancelled, let self,
                              let catalog = try? await self.catalog(at: address, timeout: 1) else { return nil }
                        return FoundServer(address: address, catalog: catalog, source: "本网段")
                    }
                }
                for _ in 0..<16 { if let address = iterator.next() { enqueue(address) } }
                while let result = await group.next() {
                    guard !Task.isCancelled, self.generation == version else { group.cancelAll(); return }
                    if let result { self.add(result, version: version) }
                    if let address = iterator.next() { enqueue(address) }
                }
            }
            // Keep Bonjour alive until the finite deadline so delayed mDNS
            // responses and the system permission dialog can finish.
            if !Task.isCancelled, version == self.generation {
                self.onStatus?(self.results.isEmpty ? "本网段探测完成，继续等待 Bonjour；也可手工输入服务器地址。" : "已找到服务器，可选择屏幕；仍在监听 Bonjour。")
            }
        }
    }
    func stop() {
        generation += 1
        task?.cancel(); task = nil; deadline?.cancel(); deadline = nil
        browser?.stop(); browser?.delegate = nil; browser = nil
        for service in services { service.stop(); service.delegate = nil }
        services = []
        resolvedTasks.forEach { $0.cancel() }; resolvedTasks = []
    }
    private func add(_ found: FoundServer, version: Int) {
        guard generation == version, !results.contains(where: { $0.catalog.serverId == found.catalog.serverId }) else { return }
        results.append(found); onResults?(results)
    }
    private func beginBonjour() {
        let browser = NetServiceBrowser(); self.browser = browser
        browser.delegate = self
        browser.searchForServices(ofType: "_mosaic-player._tcp.", inDomain: "local.")
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard services.count < 32 else { return }
        services.append(service); service.delegate = self; service.resolve(withTimeout: 3)
    }
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let host = sender.hostName, (1...65535).contains(sender.port),
              let address = try? ServerAddress("http://\(host):\(sender.port)") else { return }
        let version = generation
        resolvedTasks.append(Task { [weak self] in
            guard let self, let catalog = try? await self.catalog(at: address), !Task.isCancelled else { return }
            self.add(FoundServer(address: address, catalog: catalog, source: "Bonjour"), version: version)
        })
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        onStatus?("Bonjour 暂不可用，继续本网段探测；也可手工输入地址。")
    }
    private static func localCandidates() -> [ServerAddress] {
        var pointer: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&pointer) == 0 else { return [] }
        defer { freeifaddrs(pointer) }
        var current = pointer, networks = 0, addresses: [String] = [], seen = Set<String>()
        while let item = current {
            defer { current = item.pointee.ifa_next }
            let value = item.pointee
            guard networks < 4, value.ifa_flags & UInt32(IFF_UP) != 0,
                  value.ifa_flags & UInt32(IFF_LOOPBACK | IFF_POINTOPOINT) == 0,
                  let addr = value.ifa_addr, let mask = value.ifa_netmask,
                  addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            func numeric(_ value: UnsafeMutablePointer<sockaddr>) -> String? {
                var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                guard getnameinfo(value, socklen_t(value.pointee.sa_len), &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 else { return nil }
                return String(cString: buffer)
            }
            guard let ip = numeric(addr), let netmask = numeric(mask) else { continue }
            let candidates = DiscoverySubnet.candidates(address: ip, netmask: netmask)
            guard !candidates.isEmpty else { continue }
            networks += 1
            // Include the local interface address: this Mac may also host Mosaic.
            for value in [ip] + candidates where seen.insert(value).inserted { addresses.append(value) }
        }
        return addresses.compactMap { try? ServerAddress($0) }
    }
}
