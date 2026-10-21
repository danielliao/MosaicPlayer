import Foundation
import CoreGraphics

public enum Synchronization {
    public static func position(_ playback: Playback, now: Double, duration: Double) -> Double {
        let elapsed = playback.paused ? playback.position : max(0, (now - playback.epoch) / 1000)
        return duration > 0 ? modulo(elapsed, duration) : elapsed
    }
    public static func drift(target: Double, actual: Double, duration: Double) -> Double {
        guard target.isFinite, actual.isFinite else { return 0 }
        let delta = target - actual
        return duration > 0 ? modulo(delta + duration / 2, duration) - duration / 2 : delta
    }
    public static func rate(for drift: Double) -> Float { abs(drift) < 0.025 ? 1 : drift > 0 ? 1.03 : 0.97 }
    private static func modulo(_ x: Double, _ y: Double) -> Double { (x.truncatingRemainder(dividingBy: y) + y).truncatingRemainder(dividingBy: y) }
}

public struct ClockSample { public let rtt: Double; public let offset: Double }
public struct ClockEstimator {
    public private(set) var samples: [ClockSample] = []
    public init() {}
    public mutating func reset() { samples.removeAll() }
    public mutating func record(sent: Double, received: Double, server: Double) {
        let rtt = received - sent
        guard rtt >= 0, rtt < 10_000, rtt.isFinite, server.isFinite else { return }
        samples.append(ClockSample(rtt: rtt, offset: server - (sent + received) / 2))
        samples = Array(samples.suffix(24))
    }
    public var ready: Bool { samples.count >= 3 }
    public var offset: Double {
        let best = samples.sorted { $0.rtt < $1.rtt }.prefix(3).map(\.offset).sorted()
        return best.isEmpty ? 0 : best[best.count / 2]
    }
    public var rtt: Double? { samples.map(\.rtt).min() }
}

public struct CanvasGeometry: Equatable {
    public let viewport: CGRect
    public let wall: CGRect
    public let scale: Double
    public init(layout: WallLayout, screen: WallScreen, width: Double, height: Double) {
        let free = layout.mode == "freeform"
        let tileW = free ? screen.width! : layout.tileWidth, tileH = free ? screen.height! : layout.tileHeight
        let swap = free && (screen.rotation ?? 0) % 180 != 0
        let scale = min(width / (swap ? tileH : tileW), height / (swap ? tileW : tileH))
        self.scale = scale
        viewport = CGRect(x:(width-tileW*scale)/2,y:(height-tileH*scale)/2,width:tileW*scale,height:tileH*scale)
        wall = CGRect(x: -(free ? screen.x! : Double(screen.col)*(layout.tileWidth+layout.gapX))*scale,
                      y: -(free ? screen.y! : Double(screen.row)*(layout.tileHeight+layout.gapY))*scale,
                      width:(free ? layout.canvasWidth! : Double(layout.cols)*layout.tileWidth+Double(layout.cols-1)*layout.gapX)*scale,
                      height:(free ? layout.canvasHeight! : Double(layout.rows)*layout.tileHeight+Double(layout.rows-1)*layout.gapY)*scale)
    }
}
