import Foundation
import AVFoundation
import CryptoKit
import ImageIO
import MosaicCore

/// Downloads and validates an entire immutable version before acknowledging it.
/// The existing renderer continues playing the previous version during preparation.
@MainActor final class ProgramPlayback {
    let cache: MediaCache
    let snapshotDirectory: URL
    var send: (([String: Any]) -> Void)?
    var onError: ((String) -> Void)?
    var canPresent: ((String, [MediaAsset]) -> Bool)?
    var presentedID: String?
    private(set) var active: WallState?
    private(set) var protectedURLs = Set<URL>()
    private var incoming: WallState?
    private var connection: PlayerConnection?
    private var tasks: [String: Task<Void, Never>] = [:]
    private var ready = Set<String>()
    private var urls: [String: URL] = [:]
    private var generation = 0
    private var revision = 1_000_000
    private var cursorKey = ""
    private var savedData: Data?
    private var incomingSnapshot: Data?
    private var lastSaveAttempt = 0.0
    private var music: AVQueuePlayer?
    private var musicLooper: AVPlayerLooper?
    private var musicID: String?
    private var musicSeek = false
    private var lastMusicSeek = 0.0
    private var lastReadyReport = 0.0
    init(cache: MediaCache, directory: URL) { self.cache = cache; snapshotDirectory = directory }
    private func snapshotURL(_ connection: PlayerConnection) -> URL {
        let hash = SHA256.hash(data: Data((connection.origin.absoluteString + connection.key).utf8)).map { String(format: "%02x", $0) }.joined()
        return snapshotDirectory.appendingPathComponent(".program-\(hash).json")
    }
    func reset() {
        generation += 1; tasks.values.forEach { $0.cancel() }; tasks.removeAll(); ready.removeAll()
        active = nil; incoming = nil; connection = nil; urls.removeAll(); protectedURLs.removeAll()
        cursorKey = ""; savedData = nil; incomingSnapshot = nil; lastSaveAttempt = 0
        presentedID = nil; stopMusic()
    }
    func restore(_ connection: PlayerConnection) -> WallState? {
        self.connection = connection
        guard let data = try? Data(contentsOf: snapshotURL(connection)),
              let state = try? JSONDecoder().decode(WallState.self, from: data), state.isValid, state.program != nil else { return nil }
        receive(state, connection: connection)
        return state
    }
    func revoke() {
        if let connection {
            try? FileManager.default.removeItem(at: snapshotURL(connection))
            Task { await cache.forget(connection) }
        }
        reset()
    }
    func receive(_ state: WallState, connection: PlayerConnection) {
        self.connection = connection; incoming = state
        if let manifest = state.program {
            let snapshot = WallState(layout: state.layout, media: state.media, playback: state.playback, program: manifest, audioScreenId: state.audioScreenId)
            let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
            incomingSnapshot = try? encoder.encode(snapshot)
        } else { incomingSnapshot = nil }
        if let manifest = state.program { prepare(manifest, media: state.media) }
        if let pending = state.pendingProgram { prepare(pending.program, media: state.media) }
        if state.program == nil && state.pendingProgram == nil {
            reset()
        }
    }
    private func prepare(_ manifest: ProgramManifest, media: [MediaAsset]) {
        guard !ready.contains(manifest.id), tasks[manifest.id] == nil, let connection else { return }
        let version = generation
        tasks[manifest.id] = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let assets = media.filter { manifest.mediaIDs.contains($0.id) }
                guard assets.count == manifest.mediaIDs.count,
                      assets.reduce(Int64(0), { $0 + $1.size }) <= 3 * 1024 * 1024 * 1024 else { throw PlayerError.cacheFull }
                var loaded: [String: URL] = [:]
                for asset in assets {
                    try Task.checkCancellation()
                    let url = try await self.cache.file(for: asset, connection: connection)
                    if asset.type != "image" {
                        guard try await AVURLAsset(url: url).load(.isPlayable) else { throw PlayerError.invalidMedia }
                    } else {
                        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                              CGImageSourceCreateThumbnailAtIndex(source, 0, [
                                kCGImageSourceCreateThumbnailFromImageAlways: true,
                                kCGImageSourceThumbnailMaxPixelSize: 64,
                              ] as CFDictionary) != nil else { throw PlayerError.invalidMedia }
                    }
                    loaded[asset.id] = url
                    guard self.generation == version else { return }
                    self.protectedURLs.insert(url)
                }
                guard self.generation == version else { return }
                self.urls.merge(loaded) { _, new in new }; self.ready.insert(manifest.id); self.tasks.removeValue(forKey: manifest.id)
            } catch {
                guard !Task.isCancelled, self.generation == version else { return }
                self.tasks.removeValue(forKey: manifest.id)
                if let pending = self.incoming?.pendingProgram, pending.program.id == manifest.id {
                    self.send?(["type": "failed", "id": pending.id, "error": "节目资源下载或校验失败"])
                }
                self.onError?("节目资源准备失败，继续播放上一版本。")
            }
        }
    }
    func tick(now: Double, screenID: String) -> WallState? {
        if let pending = incoming?.pendingProgram, ready.contains(pending.program.id),
           let first = pending.program.cursor(at: pending.program.activateAt),
           canPresent?(first.mediaId, incoming?.media ?? []) == true, now - lastReadyReport > 1000 {
            send?(["type": "ready", "id": pending.id]); lastReadyReport = now
        }
        if let source = incoming, let manifest = source.program, ready.contains(manifest.id), now >= manifest.activateAt {
            active = source
            if now - lastSaveAttempt > 5000, let connection, let data = incomingSnapshot, data != savedData {
                lastSaveAttempt = now
                do {
                    try FileManager.default.createDirectory(at: snapshotDirectory, withIntermediateDirectories: true)
                    try data.write(to: snapshotURL(connection), options: .atomic)
                    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: snapshotURL(connection).path)
                    savedData = data
                } catch { onError?("离线节目保存失败，正在重试；请检查磁盘空间。") }
                // Retain only active and preparing version resources after a commit.
                let ids = manifest.mediaIDs.union(source.pendingProgram?.program.mediaIDs ?? [])
                protectedURLs = Set(urls.filter { ids.contains($0.key) }.map(\.value))
            }
        }
        guard let active, let manifest = active.program, let cursor = manifest.cursor(at: now) else { return nil }
        let key = "\(manifest.id)/\(cursor.mediaId)/\(Int64(cursor.epoch.rounded()))"
        if key != cursorKey { revision += 1; cursorKey = key }
        if presentedID == manifest.id { updateMusic(manifest: manifest, now: now, enabled: active.audioScreenId == screenID) }
        return WallState(layout: active.layout, media: active.media,
                         playback: Playback(mediaId: cursor.mediaId, epoch: cursor.epoch, paused: false, position: 0, revision: revision),
                         program: manifest, audioScreenId: active.audioScreenId)
    }
    var manifestID: String? { active?.program?.id }
    func videoVolume(at now: Double, screenID: String) -> Float {
        guard let active, active.audioScreenId == screenID, let manifest = active.program else { return 0 }
        let content = manifest.content(at: now).0
        return content.audioMode == "video" ? Float(content.volume) : 0
    }
    private func stopMusic() {
        music?.pause(); musicLooper?.disableLooping(); music?.removeAllItems()
        music = nil; musicLooper = nil; musicID = nil; musicSeek = false
    }
    private func updateMusic(manifest: ProgramManifest, now: Double, enabled: Bool) {
        let content = manifest.content(at: now).0
        guard enabled, content.audioMode == "music", let cursor = manifest.cursor(at: now, music: true),
              let url = urls[cursor.mediaId] else { stopMusic(); return }
        if musicID != cursor.mediaId {
            stopMusic(); musicID = cursor.mediaId
            let player = AVQueuePlayer()
            musicLooper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url)); music = player
            lastMusicSeek = 0
        }
        guard let player = music, player.currentItem?.status == .readyToPlay, !musicSeek else { return }
        player.volume = Float(content.volume)
        let delta = Synchronization.drift(target: cursor.position, actual: player.currentTime().seconds, duration: cursor.duration)
        if (abs(delta) > 1 || player.rate == 0), now - lastMusicSeek > 5000 {
            musicSeek = true; lastMusicSeek = now
            player.seek(to: CMTime(seconds: cursor.position, preferredTimescale: 60000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak player] finished in
                Task { @MainActor in
                    guard let self, self.music === player else { return }
                    self.musicSeek = false; if finished { player?.play() }
                }
            }
        } else { player.rate = Synchronization.rate(for: delta) }
    }
}
