import Foundation
import MosaicCore


var failures = 0
func fail(_ text: String, file: StaticString = #filePath, line: UInt = #line) { failures += 1; print("FAIL: \(text) at \(file):\(line)") }
func expectEqual<T: Equatable>(_ lhs: T, _ rhs: T) { if lhs != rhs { fail("expected \(rhs), got \(lhs)") } }
func expectEqual(_ lhs: Double, _ rhs: Double, accuracy: Double) { if abs(lhs-rhs) > accuracy || !lhs.isFinite { fail("expected approximately \(rhs), got \(lhs)") } }
func expectTrue(_ value: Bool) { if !value { fail("expected true") } }
func expectFalse(_ value: Bool) { if value { fail("expected false") } }
func expectNil<T>(_ value: T?) { if value != nil { fail("expected nil") } }
func expectThrows<T>(_ body: @autoclosure () throws -> T) { do { _ = try body(); fail("expected error") } catch {} }

final class CoreChecks {
    func testServerAddressNormalization() throws {
        expectEqual(try ServerAddress(" 10.20.30.20 ").url.absoluteString, "http://10.20.30.20:3210")
        expectEqual(try ServerAddress("mosaic.local:4321").url.absoluteString, "http://mosaic.local:4321")
        expectEqual(try ServerAddress("https://display.example/").url.absoluteString, "https://display.example")
        for value in ["", "file:///tmp", "http://user:pass@host", "http://host/play?key=secret", "http://host/admin", "http://host:99999"] {
            expectThrows(try ServerAddress(value))
        }
    }
    func testDiscoverySubnetIsBoundedAndPrivate() {
        let small = DiscoverySubnet.candidates(address: "192.168.1.5", netmask: "255.255.255.252")
        expectEqual(small, ["192.168.1.6"])
        let wide = DiscoverySubnet.candidates(address: "10.20.30.20", netmask: "255.255.0.0")
        expectEqual(wide.count, 253)
        expectTrue(wide.contains("10.20.30.21"))
        expectFalse(wide.contains("10.20.31.1"))
        expectFalse(wide.contains("10.20.30.20"))
        expectTrue(DiscoverySubnet.candidates(address: "8.8.8.8", netmask: "255.255.255.0").isEmpty)
        expectTrue(DiscoverySubnet.candidates(address: "10.1.1.2", netmask: "255.0.255.0").isEmpty)
    }
    func testDeviceLinkAndNativeDeepLink() throws {
        let link = "http://192.168.1.2:3210/play?screen=screen01&key=test-player-key"
        let connection = try PlayerConnection(link: link)
        expectEqual(connection.origin.absoluteString, "http://192.168.1.2:3210")
        expectEqual(connection.request("/ws", websocket: true).url?.scheme, "ws")
        expectEqual(connection.request("/media/a").value(forHTTPHeaderField: "Authorization"), "Bearer test-player-key")
        expectNil(URLComponents(url: connection.endpoint("/ws", websocket: true), resolvingAgainstBaseURL: false)?.query)
        var wrapped = URLComponents(string: "mosaic-player://connect")!
        wrapped.queryItems = [URLQueryItem(name: "url", value: link)]
        expectEqual(try PlayerConnection(link: wrapped.string!), connection)
    }
    func testRejectMalformedCredentialsAndSchemes() {
        for input in ["file:///play?screen=x&key=abcdefgh", "https://user:pass@host/play?screen=x&key=abcdefgh", "http://host/play?screen=x&key=abcdefgh&key=duplicate", "http://host/play?screen=../a&key=abcdefgh", "http://host/play?screen=x&key=short"] {
            expectThrows(try PlayerConnection(link: input))
        }
    }
    func testClockExcludesHighLatencySamplesAndRequiresWarmup() {
        var clock = ClockEstimator()
        clock.record(sent: 100, received: 102, server: 111)
        expectFalse(clock.ready)
        clock.record(sent: 200, received: 204, server: 213)
        clock.record(sent: 300, received: 306, server: 312)
        clock.record(sent: 400, received: 1400, server: 2000)
        expectTrue(clock.ready)
        expectEqual(clock.offset, 10)
        expectEqual(clock.rtt, 2)
        clock.reset(); expectFalse(clock.ready)
    }
    func testFutureStartLoopAndPausedTimeline() {
        let p = Playback(mediaId: "video", epoch: 10_000, paused: false, position: 0, revision: 1)
        expectEqual(Synchronization.position(p, now: 9000, duration: 7), 0)
        expectEqual(Synchronization.position(p, now: 26300, duration: 7), 2.3, accuracy: 0.00001)
        let paused = Playback(mediaId: "video", epoch: 0, paused: true, position: 4.2, revision: 2)
        expectEqual(Synchronization.position(paused, now: 1e12, duration: 7), 4.2, accuracy: 0.00001)
    }
    func testLoopBoundaryAndSoftCorrection() {
        expectEqual(Synchronization.drift(target: 0.02, actual: 9.98, duration: 10), 0.04, accuracy: 0.00001)
        expectEqual(Synchronization.drift(target: 9.98, actual: 0.02, duration: 10), -0.04, accuracy: 0.00001)
        expectEqual(Synchronization.rate(for: 0.01), 1)
        expectEqual(Synchronization.rate(for: 0.1), 1.03)
        expectEqual(Synchronization.rate(for: -0.1), 0.97)
    }
    func testGeometryLetterboxAndBezel() {
        let screens = (0..<3).map { WallScreen(id: "\($0)", name: "Screen", row: 0, col: $0) }
        let layout = WallLayout(cols: 3, rows: 1, tileWidth: 1920, tileHeight: 1080, gapX: 40, gapY: 0, screens: screens)
        expectTrue(layout.isValid)
        let g = CanvasGeometry(layout: layout, screen: screens[1], width: 1440, height: 900)
        expectEqual(g.scale, 0.75)
        expectEqual(g.viewport.origin.y, 45)
        expectEqual(g.wall.origin.x, -1470)
        expectEqual(g.wall.width, 4380)
    }
    func testGridValidationRejectsDuplicateCoordinates() {
        let screen = WallScreen(id: "a", name: "a", row: 0, col: 0)
        let bad = WallLayout(cols: 2, rows: 1, tileWidth: 1920, tileHeight: 1080, gapX: 0, gapY: 0, screens: [screen, screen])
        expectFalse(bad.isValid)
    }
    func testProgramTimeline() throws {
        let json = """
        {"id":"deployment","versionId":"v1","activateAt":10000,"validUntil":50000,
        "defaultProgram":{"playlist":[{"mediaId":"a","durationMs":3000},{"mediaId":"b","durationMs":2000}],"music":[{"mediaId":"music","durationMs":7000}],"audioMode":"music","volume":0.5},
        "intervals":[{"start":20000,"end":30000,"program":{"playlist":[{"mediaId":"c","durationMs":4000}],"music":[],"audioMode":"muted","volume":0}}]}
        """
        let p = try JSONDecoder().decode(ProgramManifest.self, from: Data(json.utf8))
        expectTrue(p.isValid); expectNil(p.cursor(at: 9999))
        expectEqual(p.cursor(at: 13000)?.mediaId, "b")
        expectEqual(p.cursor(at: 15000)?.mediaId, "a")
        expectEqual(p.cursor(at: 24000)?.position, 0)
        expectEqual(p.cursor(at: 30000)?.mediaId, "a")
        expectEqual(p.cursor(at: 50000)?.mediaId, "a")
        expectEqual(p.cursor(at: 18000, music: true)?.position, 1)
        expectEqual(p.mediaIDs, Set(["a", "b", "c", "music"]))
    }
}

let suite = CoreChecks()
let checks: [(String, () throws -> Void)] = [
    ("manual server normalization and unsafe URL rejection", suite.testServerAddressNormalization),
    ("bounded private subnet discovery", suite.testDiscoverySubnetIsBoundedAndPrivate),
    ("device links, deep links, and header credentials", suite.testDeviceLinkAndNativeDeepLink),
    ("malformed credentials and schemes", suite.testRejectMalformedCredentialsAndSchemes),
    ("clock warmup and latency filtering", suite.testClockExcludesHighLatencySamplesAndRequiresWarmup),
    ("future start, loops, and paused timeline", suite.testFutureStartLoopAndPausedTimeline),
    ("loop boundary and playback rate", suite.testLoopBoundaryAndSoftCorrection),
    ("bezel and aspect-ratio geometry", suite.testGeometryLetterboxAndBezel),
    ("duplicate screen rejection", suite.testGridValidationRejectsDuplicateCoordinates),
    ("program intervals, loops, expiry and independent music", suite.testProgramTimeline),
]
for (name, check) in checks {
    let before = failures
    do { try check() } catch { fail("unexpected error: \(error)") }
    print("\(failures == before ? "PASS" : "FAIL"): \(name)")
}
print("\(checks.count) native checks; \(failures) failures")
if failures > 0 { exit(1) }
