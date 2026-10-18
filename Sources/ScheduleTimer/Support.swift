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

/// 효과음 종류
enum SoundEffect: String {
    case levelUp = "levelup"
    case blockStart = "blockstart"

    /// 게임 파일·직접 넣은 파일이 없을 때 쓰는 macOS 기본음
    var fallbackName: String {
        switch self {
        case .levelUp: return "Hero"
        case .blockStart: return "Glass"
        }
    }
}

/// 효과음 재생 (볼륨 50%). 우선순위: Skin 폴더의 levelup.mp3 등 → Game.img 소리 → macOS 기본음
final class SoundPlayer {
    private var player: AVAudioPlayer?
    private var systemSound: NSSound?

    func play(_ effect: SoundEffect, bank: SoundBank?, bankName: String?) {
        player?.stop()
        systemSound?.stop()
        let audio: AVAudioPlayer?
        if let data = customFile(effect) {
            audio = try? AVAudioPlayer(data: data)
        } else if let name = bankName, let data = bank?.sounds[name]?.data {
            // Game.img 소리는 MP3 스트림 그대로라 형식을 알려줌
            audio = try? AVAudioPlayer(data: data, fileTypeHint: AVFileType.mp3.rawValue)
        } else {
            audio = nil
        }
        if let audio {
            audio.volume = 0.5
            audio.play()
            player = audio
            return
        }
        let sound = NSSound(named: NSSound.Name(effect.fallbackName))
        sound?.volume = 0.5
        sound?.play()
        systemSound = sound
    }

    private func customFile(_ effect: SoundEffect) -> Data? {
        for ext in ["mp3", "wav", "m4a", "aiff", "aif"] {
            let url = AppFolder.skin.appendingPathComponent("\(effect.rawValue).\(ext)")
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
