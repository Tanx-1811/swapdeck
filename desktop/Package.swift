// swift-tools-version: 6.0
import PackageDescription

// Swapdeck Desktop: a menu bar app that keeps each workspace ("bên") in its own
// Chrome profile and opens it in one click. SwapdeckCore holds the logic (no
// AppKit), SwapdeckDesktop the app itself. Build the .app with scripts/build-app.sh.
let package = Package(
    name: "SwapdeckDesktop",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "SwapdeckDesktop", targets: ["SwapdeckDesktop"]),
    ],
    targets: [
        .target(name: "SwapdeckCore"),
        .executableTarget(name: "SwapdeckDesktop", dependencies: ["SwapdeckCore"]),
        .testTarget(
            name: "SwapdeckCoreTests",
            dependencies: ["SwapdeckCore"],
            resources: [.copy("Fixtures/encrypted-backup.json")]
        ),
    ]
)
