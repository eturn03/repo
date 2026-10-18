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
    case levelUp, jobChange, allDone, blockStart, skip, scheduleSaved, scheduleFailed
    case extend, reset, delete, click, openSettings, dragStart, dragEnd

    var id: String { rawValue }

    var title: String {
        switch self {
        case .levelUp: return "블록 끝 (레벨업)"
        case .jobChange: return "직업이 바뀔 때 (전직)"
        case .allDone: return "오늘 일정 모두 끝"
        case .blockStart: return "빈 시간 → 블록 시작"
        case .skip: return "건너뛰기"
        case .scheduleSaved: return "일정 저장 성공"
        case .scheduleFailed: return "일정 저장 실패"
        case .extend: return "연장 (+5/+10분)"
        case .reset: return "원래 일정으로 되돌리기"
        case .delete: return "일정 삭제"
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
        case .jobChange: return "Game/JobChanged"
        case .allDone: return "Game/QuestClear"
        case .blockStart: return ""
        case .skip: return "Game/Tombstone"
        case .scheduleSaved: return "Game/EnchantSuccess"
        case .scheduleFailed: return "Game/EnchantFailure"
        case .extend: return "Game/DropItem"
        case .reset: return "Game/Transform"
        case .delete: return "UI/MenuDown"
        case .click: return "UI/BtMouseClick"
        case .openSettings: return "UI/MenuUp"
        case .dragStart: return "UI/DragStart"
        case .dragEnd: return "UI/DragEnd"
        }
    }

    /// 일반 효과음보다 작게 나는 소리
    var isQuiet: Bool {
        switch self {
        case .levelUp, .jobChange, .allDone, .blockStart: return false
        default: return true
        }
    }

    /// 게임 파일이 없을 때 macOS 기본음 (없으면 무음)
    var systemFallback: String? {
        switch self {
        case .levelUp, .jobChange, .allDone: return "Hero"
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

/// 고른 파일·폴더에서 메이플 .img를 찾아 이름에 맞는 폴더로 복사
enum MapleFileImporter {
    static let skinFiles = ["statusbar.img", "basic.img", "game.img", "ui.img", "uiwindow.img", "basiceff.img"]
    static let fontExtensions = ["ttf", "otf", "ttc"]

    static func importFiles(_ urls: [URL]) -> String {
        let fm = FileManager.default
        try? fm.createDirectory(at: AppFolder.skin, withIntermediateDirectories: true)
        try? fm.createDirectory(at: AppFolder.music, withIntermediateDirectories: true)

        // 폴더를 고르면 안에 있는 파일 전부 (하위 폴더 포함)
        var files: [URL] = []
        for url in urls {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue,
               let walker = fm.enumerator(at: url, includingPropertiesForKeys: nil) {
                for case let file as URL in walker { files.append(file) }
            } else {
                files.append(url)
            }
        }

        var skin: [String] = [], music: [String] = [], skipped = 0
        for file in files {
            let name = file.lastPathComponent
            let lower = name.lowercased()
            let destFolder: URL
            if (lower.hasPrefix("bgm") && lower.hasSuffix(".img"))
                || MusicPlayer.audioExtensions.contains(file.pathExtension.lowercased()) {
                destFolder = AppFolder.music
            } else if skinFiles.contains(lower) || fontExtensions.contains(file.pathExtension.lowercased()) {
                destFolder = AppFolder.skin
            } else {
                skipped += 1
                continue
            }
            var dest = destFolder.appendingPathComponent(name)
            if destFolder == AppFolder.music, !lower.hasSuffix(".img"), fm.fileExists(atPath: dest.path),
               (try? Data(contentsOf: dest)) != (try? Data(contentsOf: file)) {
                // 이름만 같고 다른 음악 파일이면 덮어쓰지 않고 번호 붙임
                let base = file.deletingPathExtension().lastPathComponent, ext = file.pathExtension
                var n = 2
                while fm.fileExists(atPath: destFolder.appendingPathComponent("\(base) (\(n)).\(ext)").path) { n += 1 }
                dest = destFolder.appendingPathComponent("\(base) (\(n)).\(ext)")
            }
            try? fm.removeItem(at: dest)
            do {
                try fm.copyItem(at: file, to: dest)
                if destFolder == AppFolder.music { music.append(name) } else { skin.append(name) }
            } catch {
                NSLog("가져오기 실패 \(name): \(error)")
            }
        }
        var lines: [String] = []
        if !skin.isEmpty { lines.append("스킨: " + skin.sorted().joined(separator: ", ")) }
        if !music.isEmpty { lines.append("음악: \(music.count)개 파일") }
        if skipped > 0 { lines.append("관계없는 파일 \(skipped)개는 건너뜀") }
        return lines.isEmpty ? "가져온 파일 없음" : lines.joined(separator: "\n")
    }
}

/// Skin 폴더의 글꼴 파일(ttf/otf/ttc)을 이 앱에서만 쓰도록 등록
enum FontLoader {
    struct Face: Hashable {
        let postScriptName: String
        let displayName: String
    }

    private static var registered: Set<URL> = []

    /// 폴더 안 모든 글꼴 파일의 모든 글꼴 (ttc는 여러 개)
    static func registerAll(in folder: URL) -> [Face] {
        let files = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
            .filter { ["ttf", "otf", "ttc"].contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        var faces: [Face] = []
        for url in files {
            if !registered.contains(url) {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
                registered.insert(url)
            }
            let descriptors = (CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor]) ?? []
            for descriptor in descriptors {
                guard let name = CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String,
                      !faces.contains(where: { $0.postScriptName == name })   // 같은 글꼴 파일이 여러 개여도 한 번만
                else { continue }
                let display = (CTFontDescriptorCopyAttribute(descriptor, kCTFontDisplayNameAttribute) as? String) ?? name
                faces.append(Face(postScriptName: name, displayName: display))
            }
        }
        return faces
    }

    /// 기본 선택: 돋움 → 굴림 → 첫 번째
    static func preferred(in faces: [Face]) -> Face? {
        for key in ["dotum", "돋움", "gulim", "굴림"] {
            if let face = faces.first(where: {
                ($0.postScriptName + $0.displayName).lowercased().contains(key) && !$0.displayName.contains("체")
            }) { return face }
        }
        return faces.first
    }
}

/// Skin 폴더 글꼴 중 12px 비트맵 글자(옛 윈도우 굴림·돋움)가 제대로 들어 있는 것 찾기
enum PixelFontLoader {
    static func load(folder: URL, preferred: String?) -> (font: BitmapFont, label: String)? {
        let files = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
            .filter { ["ttf", "otf", "ttc"].contains($0.pathExtension.lowercased()) }
        var candidates: [(rank: Int, data: [UInt8], face: BitmapFont.Face, file: String)] = []
        for url in files {
            guard let data = try? [UInt8](Data(contentsOf: url)) else { continue }
            for face in BitmapFont.faces(in: data) {
                let family = face.family.lowercased()
                let rank: Int
                if let preferred, face.postScriptName == preferred { rank = 0 }
                else if family.contains("dotum"), !family.contains("che") { rank = 1 }
                else if family.contains("gulim"), !family.contains("che") { rank = 2 }
                else { rank = 3 }
                candidates.append((rank, data, face, url.lastPathComponent))
            }
        }
        // 낱개로 변환된 파일은 한글 조각 연결이 깨진 경우가 있어서 실제로 그려지는지 확인
        for c in candidates.sorted(by: { ($0.rank, $0.file) < ($1.rank, $1.file) }) {
            if let font = BitmapFont(data: c.data, face: c.face, ppem: 12), font.canDraw("가나다경임택ABC12[]") {
                return (font, "\(c.face.family) 12px (\(c.file))")
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
