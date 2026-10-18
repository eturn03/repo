// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ScheduleTimer",
    platforms: [.macOS(.v13)],
    targets: [
        // 일정 해석·계산 로직 (UI 없음, 테스트 대상)
        .target(name: "ScheduleCore"),
        // 메이플스토리 WZ .img 파일 읽기 (사용자가 넣은 스킨·효과음)
        .target(name: "WZKit"),
        // 상태바 앱
        .executableTarget(name: "ScheduleTimer", dependencies: ["ScheduleCore", "WZKit"]),
        .testTarget(name: "ScheduleCoreTests", dependencies: ["ScheduleCore"]),
        .testTarget(name: "WZKitTests", dependencies: ["WZKit"]),
    ]
)
