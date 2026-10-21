import Foundation

public struct ServerAddress: Equatable, Hashable {
    public let url: URL
    public init(_ text: String) throws {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let explicitScheme = raw.contains("://")
        guard !raw.isEmpty, !raw.contains(where: { $0.isWhitespace }),
              var parts = URLComponents(string: explicitScheme ? raw : "http://" + raw),
              ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              ["", "/"].contains(parts.path),
              parts.port == nil || (1...65535).contains(parts.port!) else { throw DiscoveryError.invalidAddress }
        parts.scheme = parts.scheme?.lowercased()
        if !explicitScheme && parts.port == nil { parts.port = 3210 }
        parts.path = ""
        guard let url = parts.url else { throw DiscoveryError.invalidAddress }
        self.url = url
    }
}

public enum DiscoveryError: LocalizedError {
    case invalidAddress, incompatible, unavailable, notPublished, occupied, invalidReply
    public var errorDescription: String? {
        switch self {
        case .invalidAddress: return "请输入服务器 IP 或 HTTP(S) 地址，例如 10.20.30.20:3210。"
        case .incompatible: return "此地址不是兼容的 Mosaic 后台，请检查地址或更新后台。"
        case .unavailable: return "无法访问服务器。请检查地址、网络及系统设置中的「局域网」权限。"
        case .notPublished: return "后台尚未发布屏幕，请在后台「设备管理」中开启发布。"
        case .occupied: return "这块屏幕已被选择。请选择其他屏幕，或等待原设备断开；未完成的连接会在 30 秒后释放。"
        case .invalidReply: return "服务器返回的屏幕信息无效，请刷新后重试。"
        }
    }
}

public struct PublishedScreen: Decodable, Equatable {
    public let id: String
    public let name: String
    public let row: Int
    public let col: Int
    public let online: Bool
    public let reserved: Bool
    enum CodingKeys: String, CodingKey { case id, name, row, col, online, reserved }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id); name = try c.decode(String.self, forKey: .name)
        row = try c.decode(Int.self, forKey: .row); col = try c.decode(Int.self, forKey: .col)
        online = try c.decodeIfPresent(Bool.self, forKey: .online) ?? false
        reserved = try c.decodeIfPresent(Bool.self, forKey: .reserved) ?? false
    }
    public var available: Bool { !online && !reserved }
}
public struct ServerCatalog: Decodable {
    public let service: String
    public let protocolVersion: Int
    public let serverId: String
    public let name: String
    public let published: Bool
    public let cols: Int
    public let rows: Int
    public let screens: [PublishedScreen]
    enum CodingKeys: String, CodingKey { case service, protocolVersion, serverId, name, published, cols, rows, screens }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        service = try c.decode(String.self, forKey: .service); protocolVersion = try c.decode(Int.self, forKey: .protocolVersion)
        serverId = try c.decode(String.self, forKey: .serverId); name = try c.decode(String.self, forKey: .name)
        published = try c.decodeIfPresent(Bool.self, forKey: .published) ?? false
        cols = try c.decodeIfPresent(Int.self, forKey: .cols) ?? 1; rows = try c.decodeIfPresent(Int.self, forKey: .rows) ?? 1
        screens = try c.decodeIfPresent([PublishedScreen].self, forKey: .screens) ?? []
    }
    public var isValid: Bool {
        service == "mosaic-player" && [1, 2].contains(protocolVersion) && !serverId.isEmpty &&
        (1...8).contains(cols) && (1...8).contains(rows) && cols * rows <= 16 &&
        screens.count == (published ? cols * rows : 0) &&
        Set(screens.map(\.id)).count == screens.count &&
        Set(screens.map { "\($0.row),\($0.col)" }).count == screens.count &&
        screens.allSatisfy {
            (0..<rows).contains($0.row) && (0..<cols).contains($0.col) &&
            $0.id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil
        }
    }
}
public enum DiscoverySubnet {
    private static func number(_ text: String) -> UInt32? {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var value: UInt32 = 0
        for part in parts { guard let byte = UInt8(part) else { return nil }; value = (value << 8) | UInt32(byte) }
        return value
    }
    public static func candidates(address: String, netmask: String) -> [String] {
        guard let ip = number(address), let mask = number(netmask) else { return [] }
        let inverse = ~mask
        guard inverse & (inverse &+ 1) == 0,
              (ip >> 24 == 10 || ip >> 20 == 0xAC1 || ip >> 16 == 0xC0A8) else { return [] }
        let network = ip & mask, broadcast = network | inverse
        let start = max(ip & 0xFFFFFF00, network), end = min((ip & 0xFFFFFF00) | 255, broadcast)
        guard start + 1 < end else { return [] }
        return ((start + 1)..<end).filter { $0 != ip }.map {
            "\($0 >> 24).\(($0 >> 16) & 255).\(($0 >> 8) & 255).\($0 & 255)"
        }
    }
}
