import AppKit
import ServiceManagement
import ScheduleCore

/// 앱 데이터 폴더: ~/Library/Application Support/ScheduleTimer
enum AppFolder {
    static let root: URL = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ScheduleTimer", isDirectory: true)

    /// 직접 구한 효과음·이미지를 넣는 폴더 (저장소에는 넣지 않음)
    static let skin = root.appendingPathComponent("Skin", isDirectory: true)

    static func prepareSkinFolder() {
        try? FileManager.default.createDirectory(at: skin, withIntermediateDirectories: true)
        let readme = skin.appendingPathComponent("README.txt")
        guard !FileManager.default.fileExists(atPath: readme.path) else { return }
        let text = """
        이 폴더에 아래 이름으로 파일을 넣으면 기본 소리 대신 사용됨 (앱 재시작 필요 없음)
        확장자는 mp3, wav, m4a, aiff 중 아무거나

        levelup.mp3     블록이 끝날 때 (레벨업)
        blockstart.mp3  빈 시간이 끝나고 블록이 시작될 때
        """
        try? text.write(to: readme, atomically: true, encoding: .utf8)
    }
}

/// 일정을 schedule.json 에 저장
struct Storage {
    private let url = AppFolder.root.appendingPathComponent("schedule.json")

    func load() -> Schedule {
        guard let data = try? Data(contentsOf: url),
              let schedule = try? JSONDecoder().decode(Schedule.self, from: data)
        else { return Schedule() }
        return schedule
    }

    func save(_ schedule: Schedule) {
        do {
            try FileManager.default.createDirectory(at: AppFolder.root, withIntermediateDirectories: true)
            try JSONEncoder().encode(schedule).write(to: url, options: .atomic)
        } catch {
            NSLog("일정 저장 실패: \(error)")
        }
    }
}

/// 효과음. Skin 폴더에 파일이 있으면 그걸, 없으면 시스템 효과음을 50% 볼륨으로 재생.
enum SoundEffect: String {
    case levelUp = "levelup"
    case blockStart = "blockstart"

    private static var playing: NSSound?

    func play() {
        let sound = customSound() ?? NSSound(named: NSSound.Name(fallbackName))
        sound?.volume = 0.5
        Self.playing?.stop()
        Self.playing = sound
        sound?.play()
    }

    private var fallbackName: String {
        switch self {
        case .levelUp: return "Hero"
        case .blockStart: return "Glass"
        }
    }

    private func customSound() -> NSSound? {
        for ext in ["mp3", "wav", "m4a", "aiff", "aif"] {
            let url = AppFolder.skin.appendingPathComponent("\(rawValue).\(ext)")
            if FileManager.default.fileExists(atPath: url.path) {
                return NSSound(contentsOf: url, byReference: true)
            }
        }
        return nil
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
