import AppKit
import AVFoundation
import CoreText
import ServiceManagement
import ScheduleCore
import WZKit

/// 앱 데이터 폴더: ~/Library/Application Support/ScheduleTimer
enum AppFolder {
    static let root: URL = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ScheduleTimer", isDirectory: true)

    /// 직접 구한 효과음·이미지를 넣는 폴더 (저장소에는 넣지 않음)
    static let skin = root.appendingPathComponent("Skin", isDirectory: true)

    /// 셔플 재생할 BGM (Bgm*.img, mp3 등)
    static let music = root.appendingPathComponent("Music", isDirectory: true)

    static func prepareSkinFolder() {
        try? FileManager.default.createDirectory(at: skin, withIntermediateDirectories: true)
        let readme = skin.appendingPathComponent("README.txt")
        let text = """
        이 폴더에 넣은 파일을 앱이 읽어서 씀 (설정 창의 '스킨 다시 불러오기'로 반영)

        StatusBar.img   UI.wz의 상태바 → 메이플 상태바 모양
        Game.img        Sound.wz의 게임 효과음 → LevelUp 소리 등

        직접 구한 소리 파일을 쓰려면 (mp3, wav, m4a, aiff):
        levelup.mp3     블록이 끝날 때 (레벨업)
        blockstart.mp3  빈 시간이 끝나고 블록이 시작될 때
        """
        try? text.write(to: readme, atomically: true, encoding: .utf8)
    }

    /// Skin 폴더에서 이름으로 파일 찾기 (대소문자 무시, 앞에 다른 글자가 붙어 있어도 됨)
    static func skinFile(named name: String) -> URL? {
        let files = (try? FileManager.default.contentsOfDirectory(at: skin, includingPropertiesForKeys: nil)) ?? []
        return files
            .filter { $0.lastPathComponent.lowercased().hasSuffix(name.lowercased()) }
            .sorted { $0.lastPathComponent.count < $1.lastPathComponent.count }
            .first
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

/// 효과음이 나는 상황. 소리는 설정 창에서 바꿀 수 있고, quiet는 "작은 효과음" 볼륨을 씀.
enum SoundEvent: String, CaseIterable, Identifiable {
    case levelUp, allDone, blockStart, skip, scheduleSaved, scheduleFailed
    case extend, reset, click, openSettings, dragStart, dragEnd

    var id: String { rawValue }

    var title: String {
        switch self {
        case .levelUp: return "블록 끝 (레벨업)"
        case .allDone: return "오늘 일정 모두 끝"
        case .blockStart: return "빈 시간 → 블록 시작"
        case .skip: return "건너뛰기"
        case .scheduleSaved: return "일정 저장 성공"
        case .scheduleFailed: return "일정 저장 실패"
        case .extend: return "연장 (+5/+10분)"
        case .reset: return "원래 일정으로 되돌리기"
        case .click: return "버튼 클릭"
        case .openSettings: return "설정 창 열기"
        case .dragStart: return "상태바 끌기 시작"
        case .dragEnd: return "상태바 놓기"
        }
    }

    /// 기본으로 쓸 소리 ("" = macOS 기본음 또는 무음)
    var defaultSound: String {
        switch self {
        case .levelUp: return "Game/LevelUp"
        case .allDone: return "Game/JobChanged"
        case .blockStart: return ""
        case .skip: return "Game/Tombstone"
        case .scheduleSaved: return "Game/EnchantSuccess"
        case .scheduleFailed: return "Game/EnchantFailure"
        case .extend: return "Game/DropItem"
        case .reset: return "Game/Transform"
        case .click: return "UI/BtMouseClick"
        case .openSettings: return "UI/MenuUp"
        case .dragStart: return "UI/DragStart"
        case .dragEnd: return "UI/DragEnd"
        }
    }

    /// 일반 효과음보다 작게 나는 소리
    var isQuiet: Bool {
        switch self {
        case .levelUp, .allDone, .blockStart: return false
        default: return true
        }
    }

    /// 게임 파일이 없을 때 macOS 기본음 (없으면 무음)
    var systemFallback: String? {
        switch self {
        case .levelUp, .allDone: return "Hero"
        case .blockStart: return "Glass"
        default: return nil
        }
    }

    /// Skin 폴더에 이 이름의 소리 파일이 있으면 최우선 (levelup.mp3, blockstart.mp3)
    var customFileName: String? {
        switch self {
        case .levelUp: return "levelup"
        case .blockStart: return "blockstart"
        default: return nil
        }
    }
}

/// 효과음 재생. 여러 소리가 겹쳐도 서로 끊지 않음.
final class SoundPlayer {
    private var active: [AVAudioPlayer] = []
    private var systemSounds: [NSSound] = []

    func play(data: Data?, isRawMP3: Bool, systemFallback: String?, volume: Double) {
        active.removeAll { !$0.isPlaying }
        systemSounds.removeAll { !$0.isPlaying }
        if let data {
            // .img 소리는 MP3 스트림 그대로라 형식을 알려줌
            let audio = isRawMP3
                ? ((try? AVAudioPlayer(data: data, fileTypeHint: AVFileType.mp3.rawValue)) ?? (try? AVAudioPlayer(data: data)))
                : (try? AVAudioPlayer(data: data))
            if let audio {
                audio.volume = Float(volume)
                audio.play()
                active.append(audio)
                return
            }
        }
        guard let name = systemFallback, let sound = NSSound(named: NSSound.Name(name))?.copy() as? NSSound else { return }
        sound.volume = Float(volume)
        sound.play()
        systemSounds.append(sound)
    }

    static func customFile(named name: String) -> Data? {
        for ext in ["mp3", "wav", "m4a", "aiff", "aif"] {
            let url = AppFolder.skin.appendingPathComponent("\(name).\(ext)")
            if let data = try? Data(contentsOf: url) { return data }
        }
        return nil
    }
}

/// Skin 폴더의 글꼴 파일을 이 앱에서만 쓰도록 등록
enum FontLoader {
    private static var registered: [URL: String] = [:]

    /// 첫 번째 ttf/otf/ttc의 글꼴 이름(PostScript) 반환
    static func registerFirstFont(in folder: URL) -> String? {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        guard let url = files
            .filter({ ["ttf", "otf", "ttc"].contains($0.pathExtension.lowercased()) })
            .sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
            .first
        else { return nil }
        if let name = registered[url] { return name }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
              let first = descriptors.first,
              let name = CTFontDescriptorCopyAttribute(first, kCTFontNameAttribute) as? String
        else { return nil }
        registered[url] = name
        return name
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
