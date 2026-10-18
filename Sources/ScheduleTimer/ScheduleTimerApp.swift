import SwiftUI

@main
struct ScheduleTimerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    init() {
        // CI에서 화면 미리보기 PNG만 만들고 끝내는 모드
        if let index = CommandLine.arguments.firstIndex(of: "--render-preview"),
           index + 1 < CommandLine.arguments.count {
            PreviewRenderer.render(to: CommandLine.arguments[index + 1])
            exit(0)
        }
    }

    var body: some Scene {
        // 메뉴 막대에는 작은 아이콘만 (상태바를 숨겼을 때 다시 여는 용도)
        MenuBarExtra {
            Button("설정 열기") { delegate.windows?.showSettings() }
            Button("상태바 보이기/숨기기") {
                delegate.store.showStatusBar.toggle()
            }
            Divider()
            Button("종료") { NSApplication.shared.terminate(nil) }
        } label: {
            Image(systemName: "hourglass")
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private(set) lazy var store = AppStore()
    private(set) var windows: WindowManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        windows = WindowManager(store: store)
        if store.schedule.blocks.isEmpty {
            windows?.showSettings()
        }
    }
}
