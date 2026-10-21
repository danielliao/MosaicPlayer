import Foundation

public struct ProgramEntry: Codable, Equatable {
    public let mediaId: String
    public let durationMs: Double
}
public struct ProgramContent: Codable, Equatable {
    public let playlist: [ProgramEntry]
    public let music: [ProgramEntry]
    public let audioMode: String
    public let volume: Double
    public var isValid: Bool {
        !playlist.isEmpty && playlist.count <= 1000 && music.count <= 1000 &&
        (playlist + music).allSatisfy { !$0.mediaId.isEmpty && $0.durationMs.isFinite && $0.durationMs > 0 } &&
        ["muted", "music", "video"].contains(audioMode) && volume.isFinite && (0...1).contains(volume)
    }
}
public struct ProgramInterval: Codable, Equatable {
    public let start: Double
    public let end: Double
    public let program: ProgramContent
}
public struct ProgramCursor: Equatable {
    public let mediaId: String
    public let position: Double
    public let epoch: Double
    public let duration: Double
}
public struct ProgramManifest: Codable, Equatable {
    public let id: String
    public let versionId: String
    public let activateAt: Double
    public let validUntil: Double
    public let defaultProgram: ProgramContent
    public let intervals: [ProgramInterval]
    public let isValid: Bool
    private enum CodingKeys: String, CodingKey { case id, versionId, activateAt, validUntil, defaultProgram, intervals }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        versionId = try values.decode(String.self, forKey: .versionId)
        activateAt = try values.decode(Double.self, forKey: .activateAt)
        validUntil = try values.decode(Double.self, forKey: .validUntil)
        defaultProgram = try values.decode(ProgramContent.self, forKey: .defaultProgram)
        let decodedIntervals = try values.decode([ProgramInterval].self, forKey: .intervals)
        intervals = decodedIntervals
        isValid = !id.isEmpty && activateAt.isFinite && validUntil.isFinite && validUntil > activateAt &&
        defaultProgram.isValid && decodedIntervals.count <= 10000 &&
        decodedIntervals.enumerated().allSatisfy { index, interval in
            interval.start.isFinite && interval.end.isFinite && interval.end > interval.start &&
            interval.program.isValid && (index == 0 || decodedIntervals[index - 1].end <= interval.start)
        }
    }
    public var mediaIDs: Set<String> {
        Set(([defaultProgram] + intervals.map(\.program)).flatMap { $0.playlist + $0.music }.map(\.mediaId))
    }
    public func content(at time: Double) -> (ProgramContent, Double) {
        if time < validUntil {
            var low = 0, high = intervals.count
            while low < high {
                let middle = (low + high) / 2
                if intervals[middle].start <= time { low = middle + 1 } else { high = middle }
            }
            if low > 0 {
                let interval = intervals[low - 1]
                if time < interval.end { return (interval.program, interval.start) }
            }
        }
        return (defaultProgram, activateAt)
    }
    public func cursor(at time: Double, music: Bool = false) -> ProgramCursor? {
        guard time.isFinite, time >= activateAt, isValid else { return nil }
        let (content, anchor) = content(at: time)
        let entries = music ? content.music : content.playlist
        let duration = entries.reduce(0) { $0 + $1.durationMs }
        guard duration > 0, duration.isFinite else { return nil }
        var offset = max(0, time - anchor).truncatingRemainder(dividingBy: duration)
        for entry in entries {
            if offset < entry.durationMs {
                return ProgramCursor(mediaId: entry.mediaId, position: offset / 1000, epoch: time - offset, duration: entry.durationMs / 1000)
            }
            offset -= entry.durationMs
        }
        return nil
    }
}
public struct PendingProgram: Codable {
    public let id: String
    public let program: ProgramManifest
}
