// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MosaicNative",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "MosaicPlayer", targets: ["MosaicPlayer"])],
    targets: [
        .target(name: "MosaicCore"),
        .executableTarget(name: "MosaicPlayer", dependencies: ["MosaicCore"],
                          linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("AVFoundation"), .linkedFramework("IOKit"), .linkedFramework("Security")]),
        .executableTarget(name: "MosaicCoreChecks", dependencies: ["MosaicCore"], path: "Tests/MosaicCoreTests")
    ]
)
