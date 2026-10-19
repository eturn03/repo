import AVFoundation
import CryptoKit
import Foundation
import WZKit

/// Music 폴더의 BGM을 셔플 재생. Bgm*.img(Sound.wz) 안의 곡과 mp3/m4a/wav/aiff 파일을 모두 모음.
/// .img 안의 30초 미만 소리(로고음 등)는 뺌.
/// 일반 음악 파일이 .img 곡과 겹치면(이름이나 내용이 같으면) .img 곡을 우선하고 파일은 뺌.
@MainActor
final class MusicPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    struct Track: Hashable {
        let url: URL
        /// .img 안의 소리 경로. nil이면 일반 음악 파일.
        let soundPath: String?

        var title: String {
            let file = url.deletingPathExtension().lastPathComponent
            return soundPath.map { "\(file)/\($0)" } ?? file
        }

        /// 저장용 이름 (파일 이름 + .img 안 경로)
        var key: String { "\(url.lastPathComponent)#\(soundPath ?? "")" }

        /// 처음 뽑은 옛날 메이플 곡(.img)인지
        var isOldMaple: Bool { soundPath != nil }
    }

    /// 옛날 메이플만 듣기: .img에서 뽑은 곡만 (mp3 등은 뺌)
    @Published var oldMapleOnly: Bool {
        didSet {
            UserDefaults.standard.set(oldMapleOnly, forKey: Self.oldMapleKey)
            playlistChanged()
        }
    }
    /// 숨긴 .img 곡 (지금 곡 삭제로 뺀 것)
    @Published private(set) var hiddenKeys: Set<String> {
        didSet { UserDefaults.standard.set(Array(hiddenKeys), forKey: Self.hiddenKey) }
    }

    /// 실제로 셔플할 곡: 숨긴 곡 빼고, 옛날 메이플만 듣기면 .img 곡만
    var playlist: [Track] {
        tracks.filter { !hiddenKeys.contains($0.key) && (!oldMapleOnly || $0.isOldMaple) }
    }

    @Published private(set) var tracks: [Track] = []
    @Published private(set) var current: Track?
    @Published private(set) var isPlaying = false
    @Published private(set) var message = ""
    /// 추출 곡과 겹쳐서 뺀 음악 파일 (설정 창에서 확인·휴지통으로 보내기)
    struct SkippedFile {
        let url: URL
        let matched: String
        var file: String { url.lastPathComponent }
    }
    @Published private(set) var skippedDuplicates: [SkippedFile] = []

    /// 겹친 파일들의 전체 크기 (바이트)
    var skippedBytes: Int {
        skippedDuplicates.reduce(0) { total, item in
            total + ((try? item.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
    }

    /// 겹친 파일을 휴지통으로 (되살릴 수 있음). 옮긴 개수 반환.
    @discardableResult
    func trashDuplicates() -> Int {
        var moved = 0
        for item in skippedDuplicates where (try? FileManager.default.trashItem(at: item.url, resultingItemURL: nil)) != nil {
            moved += 1
        }
        reload()
        return moved
    }
    @Published var volume: Double {
        didSet {
            player?.volume = Float(volume)
            UserDefaults.standard.set(volume, forKey: Self.volumeKey)
        }
    }

    private static let volumeKey = "musicVolume"
    private static let oldMapleKey = "musicOldMapleOnly"
    private static let hiddenKey = "musicHidden"
    private static let queueKey = "musicQueue"
    nonisolated static let audioExtensions = ["mp3", "m4a", "wav", "aiff", "aif", "flac"]
    nonisolated private static let minimumBgmMs = 30_000
    private var player: AVAudioPlayer?
    private var queue: [Track] = []
    /// 지금까지 들은 곡 (이전 곡 버튼용, 최근 것이 끝)
    private var history: [Track] = []

    private var restoredQueue = false

    override init() {
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: Self.volumeKey) as? Double
        volume = saved ?? 0.3
        oldMapleOnly = defaults.bool(forKey: Self.oldMapleKey)
        hiddenKeys = Set(defaults.stringArray(forKey: Self.hiddenKey) ?? [])
        super.init()
        reload()
    }

    /// 셔플 순서(이번 바퀴에 남은 곡)를 저장 → 앱을 다시 켜도 이어서, 한 바퀴 안에 중복 없음
    private func saveQueue() {
        UserDefaults.standard.set(queue.map(\.key), forKey: Self.queueKey)
    }

    /// 듣는 곡 범위가 바뀌면 이번 바퀴를 새로 섞음 (지금 곡이 빠졌으면 다음 곡으로)
    private func playlistChanged() {
        let list = Set(playlist)
        queue = queue.filter { list.contains($0) }
        saveQueue()
        if isPlaying, let current, !list.contains(current) { next() }
    }

    /// 지금 곡 삭제: mp3 등은 휴지통으로, .img 곡은 파일 하나에 여러 곡이라 목록에서 숨김. 다음 곡 재생.
    @discardableResult
    func deleteCurrent() -> String? {
        guard let track = current else { return nil }
        let text: String
        if track.isOldMaple {
            hiddenKeys.insert(track.key)
            text = "숨김: \(track.title) (설정에서 되돌릴 수 있음)"
        } else {
            guard (try? FileManager.default.trashItem(at: track.url, resultingItemURL: nil)) != nil else {
                message = "삭제 실패: \(track.title)"
                return message
            }
            tracks.removeAll { $0 == track }
            text = "휴지통으로: \(track.title)"
        }
        queue.removeAll { $0 == track }
        history.removeAll { $0 == track }
        let wasPlaying = isPlaying
        player?.stop()
        player = nil
        current = nil
        isPlaying = false
        if wasPlaying { next() } else { saveQueue() }
        message = text
        return text
    }

    /// 숨긴 곡 모두 되살리기
    func unhideAll() {
        hiddenKeys = []
        message = "숨긴 곡을 모두 되살림"
    }

    /// Music 폴더 다시 읽기 (파일이 커서 백그라운드에서)
    func reload() {
        message = "곡 목록 읽는 중…"
        Task.detached(priority: .utility) {
            let result = MusicPlayer.scan()
            let found = result.tracks
            await MainActor.run {
                self.tracks = found
                self.skippedDuplicates = result.skipped
                if !self.restoredQueue {
                    // 지난번에 듣던 바퀴 이어서
                    self.restoredQueue = true
                    let byKey = Dictionary(found.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
                    self.queue = (UserDefaults.standard.stringArray(forKey: Self.queueKey) ?? []).compactMap { byKey[$0] }
                }
                let list = Set(self.playlist)
                self.queue = self.queue.filter { list.contains($0) }
                self.history = self.history.filter { found.contains($0) }
                self.saveQueue()
                var text = found.isEmpty
                    ? "곡 없음 — Music 폴더에 Bgm*.img나 mp3를 넣어줘"
                    : "곡 \(found.count)개 (추출 \(result.fromImages) + 추가 \(result.fromFiles)"
                        + (result.skipped.isEmpty ? "" : ", 겹쳐서 뺀 \(result.skipped.count)") + ")"
                if !result.failed.isEmpty { text += " · 읽기 실패: \(result.failed.joined(separator: ", "))" }
                self.message = text
            }
        }
    }

    /// 같은 음원인지 비교: 앞뒤 제목 정보(ID3 태그)를 뗀 순수 음원 부분의 SHA-256.
    /// 파일 이름을 바꾸고 태그를 붙여도 원본 데이터가 같으면 같은 값.
    nonisolated static func audioSignature(_ data: Data) -> Data {
        let bytes = [UInt8](data)
        var start = 0, end = bytes.count
        // 앞: ID3v2 (크기는 7비트씩 4바이트, 꼬리표 플래그면 +10)
        while end - start >= 10, bytes[start] == 0x49, bytes[start + 1] == 0x44, bytes[start + 2] == 0x33 {
            let size = Int(bytes[start + 6] & 0x7f) << 21 | Int(bytes[start + 7] & 0x7f) << 14
                | Int(bytes[start + 8] & 0x7f) << 7 | Int(bytes[start + 9] & 0x7f)
            start += 10 + size + (bytes[start + 5] & 0x10 != 0 ? 10 : 0)
        }
        // 뒤: ID3v1 ("TAG" 128바이트)
        if end - start >= 128, bytes[end - 128] == 0x54, bytes[end - 127] == 0x41, bytes[end - 126] == 0x47 {
            end -= 128
        }
        // 첫 MP3 프레임 시작(0xFFE…)까지 건너뜀
        while start + 1 < end, !(bytes[start] == 0xff && bytes[start + 1] & 0xe0 == 0xe0) { start += 1 }
        guard start < end else { return Data() }
        return Data(SHA256.hash(data: bytes[start..<end]))
    }

    /// 이름 비교용: 소문자, 글자·숫자만, 앞 번호 제거 ("01. Sleepy Wood" → "sleepywood")
    nonisolated static func normalizedName(_ name: String) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in name.lowercased().unicodeScalars where CharacterSet.alphanumerics.contains(scalar) {
            scalars.append(scalar)
        }
        var text = String(scalars)
        while let first = text.first, first.isNumber { text.removeFirst() }
        return text
    }

    nonisolated private static func scan() -> (tracks: [Track], failed: [String], fromImages: Int, fromFiles: Int,
                                               skipped: [SkippedFile]) {
        let fm = FileManager.default
        try? fm.createDirectory(at: AppFolder.music, withIntermediateDirectories: true)
        // 하위 폴더까지 (음원 묶음을 폴더째 넣어도 됨)
        var files: [URL] = []
        if let walker = fm.enumerator(at: AppFolder.music, includingPropertiesForKeys: nil) {
            for case let url as URL in walker { files.append(url) }
        }
        files.sort { $0.path < $1.path }

        var imageTracks: [Track] = []
        var names: [String: String] = [:]        // 정규화한 이름 → 곡 제목
        var signatures: [Data: String] = [:]     // 음원 서명 → 곡 제목
        var failed: [String] = []
        // 1) 추출한 .img 곡 먼저
        for url in files where url.pathExtension.lowercased() == "img" {
            do {
                let root = try WZImage.load(contentsOf: url)
                for path in root.soundPaths {
                    guard let sound = root[path]?.sound, sound.durationMs >= minimumBgmMs else { continue }
                    let track = Track(url: url, soundPath: path)
                    imageTracks.append(track)
                    names[normalizedName(String(path.split(separator: "/").last ?? ""))] = track.title
                    signatures[audioSignature(sound.data)] = track.title
                }
            } catch {
                failed.append(url.lastPathComponent)
            }
        }
        // 2) 일반 음악 파일: 추출 곡(또는 먼저 넣은 파일)과 이름이나 음원 데이터가 같으면 뺌
        var fileTracks: [Track] = []
        var skipped: [SkippedFile] = []
        for url in files where audioExtensions.contains(url.pathExtension.lowercased()) {
            let track = Track(url: url, soundPath: nil)
            let name = normalizedName(url.deletingPathExtension().lastPathComponent)
            let signature = (try? Data(contentsOf: url)).map(audioSignature) ?? Data()
            if let matched = (signature.isEmpty ? nil : signatures[signature]) ?? (name.isEmpty ? nil : names[name]) {
                skipped.append(SkippedFile(url: url, matched: matched))
                continue
            }
            if !name.isEmpty { names[name] = track.title }
            if !signature.isEmpty { signatures[signature] = track.title }
            fileTracks.append(track)
        }
        return (imageTracks + fileTracks, failed, imageTracks.count, fileTracks.count, skipped)
    }

    func togglePlay() {
        isPlaying ? pause() : play()
    }

    func play() {
        if let player, current != nil, !player.isPlaying {
            player.play()
            isPlaying = true
        } else if !isPlaying {
            next()
        }
    }

    func pause() {
        player?.pause()
        isPlaying = false
    }

    /// 셔플 순서의 다음 곡. 한 바퀴 돌면 다시 섞음.
    func next() {
        let list = playlist
        guard !list.isEmpty else {
            message = tracks.isEmpty ? "곡 없음 — Music 폴더에 Bgm*.img나 mp3를 넣어줘" : "들을 곡 없음 (숨김·옛날 메이플만 듣기 확인)"
            return
        }
        defer { saveQueue() }
        // 재생 실패한 곡은 건너뜀 (전부 실패하면 멈춤)
        for _ in 0..<list.count {
            if queue.isEmpty {
                queue = list.shuffled()
                if queue.count > 1, queue.first == current { queue.swapAt(0, 1) }
            }
            let track = queue.removeFirst()
            if start(track) { return }
        }
        isPlaying = false
        message = "재생할 수 있는 곡이 없음"
    }

    /// 이전에 들은 곡으로. 지금 곡은 다음 곡 순서 맨 앞으로 돌려놓음. 들은 곡이 없으면 지금 곡을 처음부터.
    func previous() {
        while let track = history.popLast() {
            let now = current
            if start(track, remember: false) {
                if let now { queue.insert(now, at: 0) }
                saveQueue()
                return
            }
        }
        if let player, current != nil {
            player.currentTime = 0
            if !isPlaying { player.play(); isPlaying = true }
        } else {
            next()
        }
    }

    private func start(_ track: Track, remember: Bool = true) -> Bool {
        player?.stop()
        guard let audio = makePlayer(track) else { return false }
        if remember, let current {
            history.append(current)
            if history.count > 100 { history.removeFirst() }
        }
        audio.delegate = self
        audio.volume = Float(volume)
        audio.play()
        player = audio
        current = track
        isPlaying = true
        return true
    }

    private func makePlayer(_ track: Track) -> AVAudioPlayer? {
        guard let path = track.soundPath else {
            return try? AVAudioPlayer(contentsOf: track.url)
        }
        guard let data = (try? WZImage.load(contentsOf: track.url))?[path]?.sound?.data else { return nil }
        return (try? AVAudioPlayer(data: data, fileTypeHint: AVFileType.mp3.rawValue))
            ?? (try? AVAudioPlayer(data: data))
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            if self.isPlaying { self.next() }
        }
    }
}
