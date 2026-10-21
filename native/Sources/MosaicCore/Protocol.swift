import Foundation

public struct PlayerConnection: Codable, Equatable {
    public let origin: URL
    public let screenID: String
    public let key: String

    public init(link: String) throws {
        var candidate = link.trimmingCharacters(in: .whitespacesAndNewlines)
        if let outer = URLComponents(string: candidate), outer.scheme == "mosaic-player" {
            guard outer.host == "connect", let wrapped = outer.queryItems?.first(where: { $0.name == "url" })?.value else { throw PlayerError.invalidLink }
            candidate = wrapped
        }
        guard var parts = URLComponents(string: candidate),
              ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              ["/play", "/play/"].contains(parts.path),
              let items = parts.queryItems,
              items.filter({ $0.name == "screen" }).count == 1,
              items.filter({ $0.name == "key" }).count == 1,
              let screen = items.first(where: { $0.name == "screen" })?.value,
              let key = items.first(where: { $0.name == "key" })?.value,
              screen.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
              key.range(of: "^[A-Za-z0-9_-]{8,256}$", options: .regularExpression) != nil else { throw PlayerError.invalidLink }
        parts.path = ""; parts.query = nil; parts.fragment = nil
        guard let base = parts.url else { throw PlayerError.invalidLink }
        self.origin = base; self.screenID = screen; self.key = key
    }

    public func endpoint(_ path: String, websocket: Bool = false) -> URL {
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        parts.path = path
        if websocket { parts.scheme = origin.scheme == "https" ? "wss" : "ws" }
        return parts.url!
    }
    public func request(_ path: String, websocket: Bool = false) -> URLRequest {
        var req = URLRequest(url: endpoint(path, websocket: websocket))
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("programs,audio,screenshot", forHTTPHeaderField: "X-Mosaic-Capabilities")
        return req
    }
}

public enum PlayerError: LocalizedError {
    case invalidLink, unauthorized, missingScreen, invalidLayout, invalidMedia, download, cacheFull
    public var errorDescription: String? {
        switch self {
        case .invalidLink: return "设备链接无效，请粘贴后台「设备管理」中的完整播放链接。"
        case .unauthorized: return "设备密钥已失效，请从后台重新获取播放链接。"
        case .missingScreen: return "此屏幕已被后台移除，请重新配对。"
        case .invalidLayout: return "后台下发的画布布局无效。"
        case .invalidMedia: return "素材无法解码，请上传 H.264 MP4 或 JPEG、PNG、静态 WebP。"
        case .download: return "素材下载不完整，请检查网络后重试。"
        case .cacheFull: return "本机磁盘空间不足，请清理缓存后重试。"
        }
    }
}

public struct WallScreen: Codable, Equatable {
    public let id: String
    public let name: String
    public let row: Int
    public let col: Int
    public init(id: String, name: String, row: Int, col: Int) { self.id = id; self.name = name; self.row = row; self.col = col }
}
public struct WallLayout: Codable, Equatable {
    public let cols: Int
    public let rows: Int
    public let tileWidth: Double
    public let tileHeight: Double
    public let gapX: Double
    public let gapY: Double
    public let screens: [WallScreen]
    public init(cols: Int, rows: Int, tileWidth: Double, tileHeight: Double, gapX: Double, gapY: Double, screens: [WallScreen]) {
        self.cols = cols; self.rows = rows; self.tileWidth = tileWidth; self.tileHeight = tileHeight; self.gapX = gapX; self.gapY = gapY; self.screens = screens
    }
    public var isValid: Bool {
        (1...8).contains(cols) && (1...8).contains(rows) && cols * rows <= 16 &&
        tileWidth.isFinite && tileHeight.isFinite && (320...7680).contains(tileWidth) && (240...4320).contains(tileHeight) &&
        gapX.isFinite && gapY.isFinite && (0...500).contains(gapX) && (0...500).contains(gapY) &&
        screens.count == cols * rows && Set(screens.map(\.id)).count == screens.count &&
        Set(screens.map { "\($0.row),\($0.col)" }).count == screens.count &&
        screens.allSatisfy { (0..<rows).contains($0.row) && (0..<cols).contains($0.col) }
    }
}
public struct MediaAsset: Codable, Equatable {
    public let id: String
    public let name: String
    public let type: String
    public let width: Int
    public let height: Int
    public let duration: Double
    public let size: Int64
    public let filename: String
    public let sha256: String?
    public var isValid: Bool {
        id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil &&
        ["video", "image", "audio"].contains(type) && (type == "audio" || (width > 0 && height > 0 && width <= 16384 && height <= 16384)) &&
        duration.isFinite && (type == "image" || duration > 0) && size > 0 && size <= 1_073_741_824 &&
        (sha256 == nil || sha256!.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil)
    }
}
public struct Playback: Codable, Equatable {
    public let mediaId: String?
    public let epoch: Double
    public let paused: Bool
    public let position: Double
    public let revision: Int
    public let preparationId: String?
    public init(mediaId: String?, epoch: Double, paused: Bool, position: Double, revision: Int, preparationId: String? = nil) {
        self.mediaId = mediaId; self.epoch = epoch; self.paused = paused; self.position = position; self.revision = revision; self.preparationId = preparationId
    }
}
public struct Preparation: Codable, Equatable { public let mediaId: String; public let id: String }
public struct WallState: Codable {
    public let layout: WallLayout
    public let media: [MediaAsset]
    public let playback: Playback
    public let pending: Preparation?
    public let program: ProgramManifest?
    public let pendingProgram: PendingProgram?
    public let audioScreenId: String?
    public init(layout: WallLayout, media: [MediaAsset], playback: Playback, pending: Preparation? = nil,
                program: ProgramManifest? = nil, pendingProgram: PendingProgram? = nil, audioScreenId: String? = nil) {
        self.layout = layout; self.media = media; self.playback = playback; self.pending = pending
        self.program = program; self.pendingProgram = pendingProgram; self.audioScreenId = audioScreenId
    }
    public var isValid: Bool {
        layout.isValid && playback.epoch.isFinite && playback.position.isFinite && playback.position >= 0 &&
        media.allSatisfy(\.isValid) && (program?.isValid ?? true) && (pendingProgram?.program.isValid ?? true)
    }
}
public struct ServerMessage: Decodable {
    public let type: String?
    public let state: WallState?
    public let id: Int?
    public let serverTime: Double?
}
