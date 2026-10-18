import AVFoundation
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
    }

    @Published private(set) var tracks: [Track] = []
    @Published private(set) var current: Track?
    @Published private(set) var isPlaying = false
    @Published private(set) var message = ""
    @Published var volume: Double {
        didSet {
            player?.volume = Float(volume)
            UserDefaults.standard.set(volume, forKey: Self.volumeKey)
        }
    }

    private static let volumeKey = "musicVolume"
    nonisolated static let audioExtensions = ["mp3", "m4a", "wav", "aiff", "aif", "flac"]
    nonisolated private static let minimumBgmMs = 30_000
    private var player: AVAudioPlayer?
    private var queue: [Track] = []

    override init() {
        let saved = UserDefaults.standard.object(forKey: Self.volumeKey) as? Double
        volume = saved ?? 0.3
        super.init()
        reload()
    }

    /// Music 폴더 다시 읽기 (파일이 커서 백그라운드에서)
    func reload() {
        message = "곡 목록 읽는 중…"
        Task.detached(priority: .utility) {
            let result = MusicPlayer.scan()
            let found = result.tracks
            await MainActor.run {
                self.tracks = found
                self.queue = self.queue.filter { found.contains($0) }
                var text = found.isEmpty
                    ? "곡 없음 — Music 폴더에 Bgm*.img나 mp3를 넣어줘"
                    : "곡 \(found.count)개 (추출 \(result.fromImages) + 추가 \(result.fromFiles)"
                        + (result.duplicates > 0 ? ", 겹쳐서 뺀 \(result.duplicates)" : "") + ")"
                if !result.failed.isEmpty { text += " · 읽기 실패: \(result.failed.joined(separator: ", "))" }
                self.message = text
            }
        }
    }

    /// 같은 곡인지 비교용: 크기 + 앞부분 4KB
    private struct Fingerprint: Hashable {
        let size: Int
        let head: Data
    }

    nonisolated private static func fingerprint(_ data: Data) -> Fingerprint {
        Fingerprint(size: data.count, head: data.prefix(4096))
    }

    nonisolated private static func fingerprint(file url: URL) -> Fingerprint? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()).map(Int.init) ?? 0
        try? handle.seek(toOffset: 0)
        let head = (try? handle.read(upToCount: 4096)) ?? Data()
        return Fingerprint(size: size, head: head)
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

    nonisolated private static func scan() -> (tracks: [Track], failed: [String], fromImages: Int, fromFiles: Int, duplicates: Int) {
        let fm = FileManager.default
        try? fm.createDirectory(at: AppFolder.music, withIntermediateDirectories: true)
        // 하위 폴더까지 (음원 묶음을 폴더째 넣어도 됨)
        var files: [URL] = []
        if let walker = fm.enumerator(at: AppFolder.music, includingPropertiesForKeys: nil) {
            for case let url as URL in walker { files.append(url) }
        }
        files.sort { $0.path < $1.path }

        var imageTracks: [Track] = []
        var names = Set<String>()
        var prints = Set<Fingerprint>()
        var failed: [String] = []
        // 1) 추출한 .img 곡 먼저
        for url in files where url.pathExtension.lowercased() == "img" {
            do {
                let root = try WZImage.load(contentsOf: url)
                for path in root.soundPaths {
                    guard let sound = root[path]?.sound, sound.durationMs >= minimumBgmMs else { continue }
                    imageTracks.append(Track(url: url, soundPath: path))
                    names.insert(normalizedName(String(path.split(separator: "/").last ?? "")))
                    prints.insert(fingerprint(sound.data))
                }
            } catch {
                failed.append(url.lastPathComponent)
            }
        }
        // 2) 일반 음악 파일: .img 곡과 이름이나 내용이 같으면 뺌
        var fileTracks: [Track] = []
        var duplicates = 0
        for url in files where audioExtensions.contains(url.pathExtension.lowercased()) {
            let name = normalizedName(url.deletingPathExtension().lastPathComponent)
            let filePrint = fingerprint(file: url)
            if (!name.isEmpty && names.contains(name)) || (filePrint.map { prints.contains($0) } ?? false) {
                duplicates += 1
                continue
            }
            if !name.isEmpty { names.insert(name) }   // 파일끼리 같은 이름도 하나만
            if let filePrint { prints.insert(filePrint) }
            fileTracks.append(Track(url: url, soundPath: nil))
        }
        return (imageTracks + fileTracks, failed, imageTracks.count, fileTracks.count, duplicates)
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
        guard !tracks.isEmpty else {
            message = "곡 없음 — Music 폴더에 Bgm*.img나 mp3를 넣어줘"
            return
        }
        // 재생 실패한 곡은 건너뜀 (전부 실패하면 멈춤)
        for _ in 0..<tracks.count {
            if queue.isEmpty {
                queue = tracks.shuffled()
                if queue.count > 1, queue.first == current { queue.swapAt(0, 1) }
            }
            let track = queue.removeFirst()
            if start(track) { return }
        }
        isPlaying = false
        message = "재생할 수 있는 곡이 없음"
    }

    private func start(_ track: Track) -> Bool {
        player?.stop()
        guard let audio = makePlayer(track) else { return false }
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
