import Foundation

public struct PlaybackEvidence: Codable, Equatable {
    public var eventId: String
    public var mediaId: String
    public var programId: String?
    public var startAt: Int64
    public var endAt: Int64
    public var durationMs: Int64
}
public struct EvidenceSample {
    public var mediaId: String, programId: String?, control: String
    public var startAt: Int64, durationMs: Int64, now: Double
    public var ready: Bool
    public var video=false, positionMs=0.0, sourceDurationMs=0.0
    public init(mediaId:String, programId:String?, control:String, startAt:Int64, durationMs:Int64, now:Double, ready:Bool) {
        self.mediaId=mediaId;self.programId=programId;self.control=control;self.startAt=startAt;self.durationMs=durationMs;self.now=now;self.ready=ready
    }
}
public struct EvidenceTracker {
    private var candidate: EvidenceSample?
    private var eligible=false
    private var wrapAt = -Double.infinity
    public init() {}
    public mutating func reset() { candidate=nil;eligible=false;wrapAt = -Double.infinity }
    public mutating func observe(_ s:EvidenceSample) -> PlaybackEvidence? {
        let old=candidate,oldEligible=eligible;candidate=nil;eligible=false
        guard s.ready,s.now.isFinite,s.durationMs>=1000,s.durationMs<=3600000,s.now>=Double(s.startAt) else { wrapAt = -Double.infinity;return nil }
        let same=old?.mediaId==s.mediaId && old?.programId==s.programId && old?.control==s.control && old?.startAt==s.startAt && old?.durationMs==s.durationMs
        let continuous=old != nil && s.now>=old!.now && s.now-old!.now<=250 && old!.control==s.control
        if let o=old,continuous,o.mediaId==s.mediaId,s.video,s.sourceDurationMs>0,o.positionMs-s.positionMs>s.sourceDurationMs/2 {wrapAt=s.now}
        let completedVideo=old?.video != true || (old?.mediaId==s.mediaId && s.now-wrapAt<=250 && wrapAt>=Double(old!.startAt+old!.durationMs)-250)
        var event:PlaybackEvidence?
        if continuous,completedVideo,oldEligible,!same,let o=old {
            let end=o.startAt+o.durationMs
            if o.now>=Double(end)-150 && s.now>=Double(end) && s.now<=Double(end)+150 && s.startAt==end {
                event=PlaybackEvidence(eventId:UUID().uuidString,mediaId:o.mediaId,programId:o.programId,startAt:o.startAt,endAt:end,durationMs:o.durationMs)
            }
        }
        let boundary=continuous && old!.startAt+old!.durationMs==s.startAt && old!.now>=Double(s.startAt)-150 && s.now-Double(s.startAt)<=150
        eligible = same && continuous ? oldEligible : boundary || s.now==Double(s.startAt)
        candidate=s
        return event
    }
}
