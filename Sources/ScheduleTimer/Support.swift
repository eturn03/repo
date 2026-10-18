import Foundation
import ServiceManagement
import UserNotifications
import ScheduleCore

/// 일정을 ~/Library/Application Support/ScheduleTimer/schedule.json 에 저장
struct Storage {
    private let url: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("ScheduleTimer", isDirectory: true)
            .appendingPathComponent("schedule.json")
    }()

    func load() -> Schedule {
        guard let data = try? Data(contentsOf: url),
              let schedule = try? JSONDecoder().decode(Schedule.self, from: data)
        else { return Schedule() }
        return schedule
    }

    func save(_ schedule: Schedule) {
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            try JSONEncoder().encode(schedule).write(to: url, options: .atomic)
        } catch {
            NSLog("일정 저장 실패: \(error)")
        }
    }
}

/// macOS 알림 센터로 "지금 할 일" 알림 표시 (소리는 Chime이 따로 냄)
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()

    override init() {
        super.init()
        center.delegate = self
    }

    func requestPermission() {
        center.requestAuthorization(options: [.alert]) { _, error in
            if let error { NSLog("알림 권한 요청 실패: \(error)") }
        }
    }

    func post(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        center.add(request)
    }

    // 메뉴 막대 창이 열려 있어도 배너가 보이게 함
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }
}

/// 로그인 시 자동 실행
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }
    static var needsApproval: Bool { SMAppService.mainApp.status == .requiresApproval }

    static func set(_ on: Bool) throws {
        if on {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }
}
