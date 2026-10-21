import AppKit
import AVFoundation
import CryptoKit
import IOKit.pwr_mgt
import Security
import MosaicCore

/// Credentials never go into UserDefaults, diagnostic files, or process arguments.
enum PairingStore {
    static let service = "local.mosaic.player.pairing"
    static func load() -> PlayerConnection? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                   kSecAttrAccount as String: "default", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(PlayerConnection.self, from: data)
    }
    static func save(_ connection: PlayerConnection) throws {
        let data = try JSONEncoder().encode(connection)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "default"]
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query; item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(added)) }
        } else if status != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
    static func clear() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "default"] as CFDictionary)
    }
}

final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // A paired server may not redirect a request carrying its key elsewhere.
        completionHandler(nil)
    }
}

actor MediaCache {
    let directory: URL
    let delegate = NoRedirectDelegate()
    lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 600
        return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }()
    init(directory: URL) { self.directory = directory }
    private func digest(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func file(for media: MediaAsset, connection: PlayerConnection) async throws -> URL {
        guard media.isValid else { throw PlayerError.invalidMedia }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let namespace = SHA256.hash(data: Data((connection.origin.absoluteString + "\n" + connection.key).utf8)).map { String(format: "%02x", $0) }.joined()
        let ext = media.type == "video" ? "mp4" : (["png", "jpg", "jpeg", "webp", "mp3", "m4a", "aac", "wav"].contains((media.filename as NSString).pathExtension.lowercased()) ? (media.filename as NSString).pathExtension.lowercased() : "media")
        let destination = directory.appendingPathComponent("\(namespace)-\(media.id).\(ext)")
        if let values = try? destination.resourceValues(forKeys: [.fileSizeKey]), Int64(values.fileSize ?? 0) == media.size {
            if try media.sha256 == nil || digest(destination) == media.sha256?.lowercased() {
                try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: destination.path)
                return destination
            }
        }
        let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        if let available = values?.volumeAvailableCapacityForImportantUsage, available < media.size + 128_000_000 { throw PlayerError.cacheFull }
        let (temporary, response) = try await session.download(for: connection.request("/media/\(media.id)"))
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw PlayerError.download }
        if http.statusCode == 401 || http.statusCode == 403 { throw PlayerError.unauthorized }
        guard http.statusCode == 200,
              let size = (try? FileManager.default.attributesOfItem(atPath: temporary.path)[.size]) as? NSNumber,
              size.int64Value == media.size else { throw PlayerError.download }
        if let expected = media.sha256, try digest(temporary) != expected.lowercased() { throw PlayerError.download }
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.moveItem(at: temporary, to: destination)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        return destination
    }
    func remove(_ url: URL) { if url.deletingLastPathComponent() == directory { try? FileManager.default.removeItem(at: url) } }
    func forget(_ connection: PlayerConnection) {
        let namespace = SHA256.hash(data: Data((connection.origin.absoluteString + "\n" + connection.key).utf8)).map { String(format: "%02x", $0) }.joined()
        for url in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        where url.lastPathComponent.hasPrefix(namespace + "-") { try? FileManager.default.removeItem(at: url) }
    }
    func prune(keeping protected: Set<URL>, limit: Int = 3 * 1024 * 1024 * 1024) {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey], options: [.skipsHiddenFiles])) ?? []
        let entries = urls.compactMap { url -> (URL, Int, Date)? in
            guard let v = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]) else { return nil }
            return (url, v.fileSize ?? 0, v.contentModificationDate ?? .distantPast)
        }.sorted { $0.2 < $1.2 }
        var total = entries.reduce(0) { $0 + $1.1 }
        for (url, size, _) in entries where total > limit && !protected.contains(url) {
            if (try? FileManager.default.removeItem(at: url)) != nil { total -= size }
        }
    }
    func clear() throws {
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: url) }
    }
}

@MainActor final class PowerGuard {
    private var assertion: IOPMAssertionID = 0
    private var activity: NSObjectProtocol?
    private(set) var isActive = false
    func setEnabled(_ enabled: Bool) {
        guard enabled != isActive else { return }
        if enabled {
            let result = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                                                    IOPMAssertionLevel(kIOPMAssertionLevelOn), "Mosaic 多屏同步播放" as CFString, &assertion)
            isActive = result == kIOReturnSuccess
            if activity == nil { activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled], reason: "Mosaic synchronized playback") }
        } else {
            if isActive { IOPMAssertionRelease(assertion) }
            if let activity { ProcessInfo.processInfo.endActivity(activity) }
            activity = nil; assertion = 0; isActive = false
        }
    }
}
