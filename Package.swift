// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ScheduleTimer",
    platforms: [.macOS(.v13)],
    targets: [
        // 일정 해석·계산 로직 (UI 없음, 테스트 대상)
        .target(name: "ScheduleCore"),
        // 메뉴 막대 앱
        .executableTarget(name: "ScheduleTimer", dependencies: ["ScheduleCore"]),
        .testTarget(name: "ScheduleCoreTests", dependencies: ["ScheduleCore"]),
    ]
)
