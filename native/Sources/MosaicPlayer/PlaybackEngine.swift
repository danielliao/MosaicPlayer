import AppKit
import AVFoundation
import MosaicCore

@MainActor final class LoadedMedia {
    let media: MediaAsset
    let url: URL
    let player: AVQueuePlayer?
    let looper: AVPlayerLooper?
    let image: CGImage?
    var preparationID: String?
    var scheduledRevision: Int?
    init(media: MediaAsset, url: URL, player: AVQueuePlayer? = nil, looper: AVPlayerLooper? = nil, image: CGImage? = nil) {
        self.media = media; self.url = url; self.player = player; self.looper = looper; self.image = image
    }
    func releasePlayback() { player?.pause(); looper?.disableLooping(); player?.removeAllItems() }
}

@MainActor final class PlaybackEngine {
    let transport = SyncTransport()
    let power = PowerGuard()
    let cache: MediaCache
    let programs: ProgramPlayback
    var captureFrame: (() async throws -> Data)?
    private var screenshotInFlight = false
    var onChange: (() -> Void)?
    var onMedia: ((LoadedMedia?) -> Void)?
    var onLayout: ((WallLayout, WallScreen) -> Void)?
    var onPairingValidated: ((PlayerConnection) -> Void)?
    var displaySize: (() -> CGSize)?
    var renderInfo: (() -> [String: Any])?
    private(set) var state: WallState?
    private(set) var current: LoadedMedia?
    private(set) var screen: WallScreen?
    private(set) var status = "idle"
    private(set) var detail = "选择服务器与屏幕编号，即可加入拼接画布；也可粘贴原有设备链接。"
    private(set) var networkDetail = "尚未连接"
    private(set) var drift: Double?
    private(set) var connected = false
    private var prepared: LoadedMedia?
    private var loadTask: Task<Void, Never>?
    private var loadTag: String?
    private var loadGeneration = 0
    private var tickTimer: Timer?
    private var reportTimer: Timer?
    private var retryAfter = 0.0
    private var seeking = false
    private var activeRevision: Int?
    private let diagnostics: URL?

    init(cacheDirectory: URL, diagnostics: URL? = nil) {
        cache = MediaCache(directory: cacheDirectory); self.diagnostics = diagnostics
        programs = ProgramPlayback(cache: cache, directory: cacheDirectory)
        programs.send = { [weak self] in self?.transport.send($0) }
        programs.onError = { [weak self] in self?.detail = $0; self?.onChange?() }
        programs.canPresent = { [weak self] id, media in
            guard let self else { return false }
            if self.current?.media.id == id || self.prepared?.media.id == id { return true }
            if let asset = media.first(where: { $0.id == id }) { self.load(asset, tag: "program:\(id)", preparationID: nil) }
            return false
        }
        transport.onCommand = { [weak self] in self?.command($0) }
        transport.onState = { [weak self] state in self?.receive(state) }
        transport.onStatus = { [weak self] online, text in
            guard let self else { return }; self.connected = online; self.networkDetail = text; self.onChange?()
        }
        transport.onValidated = { [weak self] connection in self?.onPairingValidated?(connection) }
        transport.onRejected = { [weak self] in
            guard let self else { return }; self.programs.revoke(); self.clearMedia(); self.state = nil; self.screen = nil
            self.status = "error"; self.detail = self.networkDetail; self.onChange?()
        }
        tickTimer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
        reportTimer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in Task { @MainActor in self?.report() } }
        for timer in [tickTimer, reportTimer].compactMap({ $0 }) { RunLoop.main.add(timer, forMode: .common) }
    }
    func connect(_ connection: PlayerConnection) {
        if let previous = transport.connection, previous != connection {
            programs.revoke()
            Task { await cache.forget(previous) }
        }
        clearMedia(); state = nil; screen = nil; retryAfter = 0; status = "connecting"; detail = "正在验证设备身份…"
        programs.reset(); transport.connect(connection)
        if let cached = programs.restore(connection) { self.state = cached; self.screen = cached.layout.screens.first { $0.id == connection.screenID }; if let screen { onLayout?(cached.layout, screen) } }
        onChange?()
    }
    func disconnect() {
        programs.reset(); transport.disconnect(); clearMedia(); state = nil; screen = nil; connected = false
        status = "idle"; detail = "已断开，可粘贴新的设备链接。"; networkDetail = "尚未连接"; onChange?()
    }
    func shutdown() { disconnect(); tickTimer?.invalidate(); reportTimer?.invalidate() }
    func clearCache() async throws { disconnect(); try await cache.clear(); detail = "本机缓存已清除。"; onChange?() }
    private func clearMedia() {
        loadGeneration += 1; loadTask?.cancel(); loadTask = nil; loadTag = nil
        prepared?.releasePlayback(); prepared = nil
        current?.releasePlayback(); current = nil; activeRevision = nil; seeking = false; drift = nil
        power.setEnabled(false); onMedia?(nil)
    }
    private func receive(_ state: WallState) {
        guard let connection = transport.connection,
              let assigned = state.layout.screens.first(where: { $0.id == connection.screenID }) else { return }
        self.screen = assigned; onLayout?(state.layout, assigned)
        programs.receive(state, connection: connection)
        if state.program != nil || state.pendingProgram != nil {
            if self.state == nil { self.state = state }
            onChange?(); return
        }
        self.state = state
        if let pending = state.pending {
            if prepared?.preparationID == pending.id { transport.send(["type": "ready", "id": pending.id]) }
            else if let media = state.media.first(where: { $0.id == pending.mediaId }) { load(media, tag: "pending:\(pending.id)", preparationID: pending.id) }
        } else {
            if let p = prepared, let preparationID = p.preparationID, preparationID != state.playback.preparationId {
                p.releasePlayback(); prepared = nil
            }
            if let tag = loadTag, tag.hasPrefix("pending:") {
                loadGeneration += 1; loadTask?.cancel(); loadTask = nil; loadTag = nil
            }
            if state.playback.mediaId == nil { clearMedia(); status = "idle"; detail = "设备已连接，等待后台投放内容。" }
            advance()
        }
        onChange?()
    }
    private func load(_ media: MediaAsset, tag: String, preparationID: String?) {
        guard loadTag != tag, let connection = transport.connection, transport.localNow >= retryAfter else { return }
        loadGeneration += 1; let version = loadGeneration
        loadTask?.cancel(); loadTag = tag
        status = "loading"; detail = "正在下载并校验「\(media.name)」…"; onChange?()
        loadTask = Task { @MainActor [weak self] in
            guard let self else { return }
            var localURL: URL?
            do {
                let url = try await self.cache.file(for: media, connection: connection); localURL = url
                try Task.checkCancellation()
                let loaded: LoadedMedia
                if media.type == "video" {
                    let asset = AVURLAsset(url: url)
                    guard try await asset.load(.isPlayable) else { throw PlayerError.invalidMedia }
                    let duration = try await asset.load(.duration)
                    guard duration.seconds.isFinite, duration.seconds > 0 else { throw PlayerError.invalidMedia }
                    let item = AVPlayerItem(asset: asset)
                    let player = AVQueuePlayer(); player.isMuted = true; player.automaticallyWaitsToMinimizeStalling = false
                    let looper = AVPlayerLooper(player: player, templateItem: item)
                    loaded = LoadedMedia(media: media, url: url, player: player, looper: looper)
                    let deadline = CACurrentMediaTime() + 10
                    while player.currentItem?.status != .readyToPlay {
                        try Task.checkCancellation()
                        if player.currentItem?.status == .failed || CACurrentMediaTime() > deadline { loaded.releasePlayback(); throw PlayerError.invalidMedia }
                        try await Task.sleep(nanoseconds: 20_000_000)
                    }
                    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                        player.preroll(atRate: 1) { _ in continuation.resume() }
                    }
                } else {
                    let options: [CFString: Any] = [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: max(media.width, media.height),
                    ]
                    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw PlayerError.invalidMedia }
                    loaded = LoadedMedia(media: media, url: url, image: image)
                }
                guard self.loadGeneration == version, !Task.isCancelled else { loaded.releasePlayback(); return }
                self.prepared?.releasePlayback(); loaded.preparationID = preparationID; self.prepared = loaded
                self.loadTag = nil; self.loadTask = nil; self.retryAfter = 0
                self.status = "ready"; self.detail = "素材已缓存，等待同步开始。"
                await self.cache.prune(keeping: self.programs.protectedURLs.union(Set([url, self.current?.url].compactMap { $0 })))
                guard self.loadGeneration == version else { return }
                if let preparationID, self.state?.pending?.id == preparationID { self.transport.send(["type": "ready", "id": preparationID]) }
                self.advance(); self.onChange?()
            } catch {
                guard self.loadGeneration == version, !Task.isCancelled else { return }
                self.loadTag = nil; self.loadTask = nil; self.retryAfter = self.transport.localNow + 5000
                if let localURL { await self.cache.remove(localURL) }
                self.status = self.current == nil ? "error" : "playing"
                self.detail = "素材准备失败，已保留原内容。\((error as? PlayerError)?.localizedDescription ?? "请检查网络、磁盘空间和视频格式。")"
                if let preparationID { self.transport.send(["type": "failed", "id": preparationID]) }
                self.onChange?()
            }
        }
    }
    private func advance() {
        guard let state, state.pending == nil, let mediaID = state.playback.mediaId else { return }
        if let prepared, prepared.media.id == mediaID {
            guard transport.clockReady || (!connected && programs.manifestID != nil && Date().timeIntervalSince1970 > 1_700_000_000) else { return }
            let playback = state.playback
            if !playback.paused, transport.serverNow < playback.epoch {
                if let player = prepared.player, prepared.scheduledRevision != playback.revision {
                    let delay = (playback.epoch - transport.serverNow) / 1000
                    let host = CMTimeAdd(CMClockGetTime(CMClockGetHostTimeClock()), CMTime(seconds: delay, preferredTimescale: 1_000_000))
                    player.setRate(1, time: .zero, atHostTime: host)
                    prepared.scheduledRevision = playback.revision
                }
                status = "waiting"; detail = "已就绪，等待统一开始时间…"
                return
            }
            current?.releasePlayback(); current = prepared; self.prepared = nil
            seeking = false; activeRevision = prepared.scheduledRevision
            onMedia?(prepared)
        } else if current?.media.id != mediaID, let media = state.media.first(where: { $0.id == mediaID }) {
            load(media, tag: "current:\(mediaID)", preparationID: nil)
        }
    }
    private func tick() {
        if let id = transport.connection?.screenID, let effective = programs.tick(now: transport.serverNow, screenID: id) { self.state = effective }
        // A preparation arriving during the retry cooldown still needs to start
        // once the cooldown expires; there may be no further state broadcasts.
        if let state, let pending = state.pending,
           prepared?.preparationID != pending.id,
           let media = state.media.first(where: { $0.id == pending.mediaId }) {
            load(media, tag: "pending:\(pending.id)", preparationID: pending.id)
        }
        advance()
        guard let state, let current, current.media.id == state.playback.mediaId else { return }
        let playback = state.playback
        guard transport.clockReady || (!connected && programs.manifestID != nil && Date().timeIntervalSince1970 > 1_700_000_000) else { return }
        power.setEnabled(!playback.paused)
        if current.media.type == "image" {
            status = playback.paused ? "paused" : "playing"; drift = nil
            detail = "\(playback.paused ? "已暂停" : "图片显示中") · 本机缓存 · \(current.media.name)"
            return
        }
        guard let player = current.player, let item = player.currentItem else { return }
        let volume = programs.videoVolume(at: transport.serverNow, screenID: screen?.id ?? "")
        player.isMuted = volume == 0; player.volume = volume
        if item.status == .failed { status = "error"; detail = "本机视频解码失败，请检查素材。"; return }
        if item.status != .readyToPlay { status = "loading"; return }
        if !playback.paused, transport.serverNow < playback.epoch { status = "waiting"; return }
        let target = Synchronization.position(playback, now: transport.serverNow, duration: current.media.duration)
        let delta = Synchronization.drift(target: target, actual: player.currentTime().seconds, duration: current.media.duration)
        drift = delta * 1000
        guard !seeking else { return }
        if playback.paused {
            player.pause(); status = "paused"
            if abs(delta) > 0.015 { seek(current, target: target, resume: false) }
            activeRevision = playback.revision
        } else if activeRevision != playback.revision || abs(delta) > 0.18 || player.rate == 0 {
            activeRevision = playback.revision; status = "playing"
            seek(current, target: target, resume: true)
        } else {
            let rate = Synchronization.rate(for: delta)
            if abs(player.rate - rate) > 0.001 { player.rate = rate }
            status = "playing"
        }
        detail = "\(status == "paused" ? "已暂停" : "同步播放中") · 偏差 \(Int(abs(drift ?? 0))) ms · 本机缓存"
    }
    private func seek(_ media: LoadedMedia, target: Double, resume: Bool) {
        guard let player = media.player else { return }
        seeking = true
        Task { @MainActor [weak self, weak media] in
            let finished = await player.seek(to: CMTime(seconds: target, preferredTimescale: 60_000), toleranceBefore: .zero, toleranceAfter: .zero)
            guard let self, let media, self.current === media else { return }
            self.seeking = false
            guard finished, resume, let playback = self.state?.playback, !playback.paused else { return }
            let lead = 0.03
            let next = Synchronization.position(playback, now: self.transport.serverNow + lead * 1000, duration: media.media.duration)
            let host = CMTimeAdd(CMClockGetTime(CMClockGetHostTimeClock()), CMTime(seconds: lead, preferredTimescale: 1_000_000))
            player.setRate(1, time: CMTime(seconds: next, preferredTimescale: 60_000), atHostTime: host)
        }
    }
    private func command(_ command: [String: Any]) {
        guard command["type"] as? String == "screenshot", let id = command["id"] as? String,
              id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
              !screenshotInFlight, let connection = transport.connection else { return }
        screenshotInFlight = true
        let mediaID = current?.media.id ?? "", programID = programs.presentedID ?? ""
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.screenshotInFlight = false }
            let session = URLSession(configuration: .ephemeral, delegate: NoRedirectDelegate(), delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            do {
                guard let captureFrame = self.captureFrame else { throw PlayerError.invalidMedia }
                let capturedAt = self.transport.serverNow
                let data = try await captureFrame()
                guard self.transport.connection == connection, data.count <= 256 * 1024 else { throw PlayerError.invalidMedia }
                var request = connection.request("/api/device/screenshots/\(id)")
                request.httpMethod = "POST"; request.httpBody = data
                request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
                request.setValue(String(Int64(capturedAt)), forHTTPHeaderField: "X-Captured-At")
                request.setValue(mediaID, forHTTPHeaderField: "X-Media-Id")
                request.setValue(programID, forHTTPHeaderField: "X-Program-Id")
                let (_, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw PlayerError.download }
            } catch {
                var request = connection.request("/api/device/commands/\(id)")
                request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try? JSONSerialization.data(withJSONObject: ["status": "failed", "error": "无法采集当前渲染画面"])
                _ = try? await session.data(for: request)
            }
        }
    }
    private func report() {
        let size = displaySize?() ?? .zero
        let rendered = current?.media.id == state?.playback.mediaId && status == "playing" && !seeking &&
            transport.serverNow >= (state?.playback.epoch ?? .infinity) &&
            (current?.image != nil || ((renderInfo?()["videoReady"] as? Bool) == true && current?.player?.timeControlStatus == .playing))
        if rendered {
            programs.presentedID = programs.manifestID
        }
        let report: [String: Any] = ["type": "report", "client": "native-macos", "version": "0.4.0", "capabilities": ["programs", "audio", "screenshot"], "programId": programs.presentedID as Any? ?? NSNull(), "mediaId": current?.media.id as Any? ?? NSNull(), "drift": drift as Any? ?? NSNull(),
                                     "playbackRevision": rendered ? (state?.playback.revision as Any? ?? NSNull()) : NSNull(),
                                     "rtt": transport.latency as Any? ?? NSNull(), "status": status, "width": Int(size.width), "height": Int(size.height)]
        transport.send(report)
        onChange?()
        guard let diagnostics else { return }
        var snapshot = report
        snapshot["connected"] = connected; snapshot["screenId"] = screen?.id ?? ""
        snapshot["mediaId"] = current?.media.id ?? ""; snapshot["mediaType"] = current?.media.type ?? ""
        snapshot["mediaTime"] = current?.player?.currentTime().seconds ?? 0
        snapshot["clockReady"] = transport.clockReady; snapshot["serverTime"] = transport.serverNow
        snapshot["displaySleepPrevented"] = power.isActive; snapshot["cached"] = current != nil
        snapshot["revision"] = state?.playback.revision ?? 0
        snapshot["rendering"] = renderInfo?() ?? [:]
        if let state, let screen {
            let g = CanvasGeometry(layout: state.layout, screen: screen, width: size.width, height: size.height)
            snapshot["crop"] = ["x": g.wall.origin.x, "y": g.wall.origin.y, "width": g.wall.width, "height": g.wall.height]
        }
        if JSONSerialization.isValidJSONObject(snapshot), let data = try? JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: diagnostics, options: .atomic)
        }
    }
}
