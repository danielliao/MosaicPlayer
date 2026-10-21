import Foundation
public struct ProgramTransition: Codable, Equatable {
    public let type:String
    public let durationMs:Double
    public func isValid(shortest:Double)->Bool { ["cut","fade"].contains(type) && durationMs.isFinite && durationMs.rounded()==durationMs && (0...2000).contains(durationMs) && (type == "cut" ? durationMs==0 : durationMs>=100 && durationMs<=shortest/2) }
}
public enum TransitionMath {
    public static func opacity(type:String,durationMs:Double,epoch:Double,now:Double,ready:Bool)->Double {
        guard ready else{return 1}
        guard type=="fade",durationMs>=100,durationMs<=2000 else{return 0}
        return max(0,min(1,1-(now-epoch)/durationMs))
    }
}
