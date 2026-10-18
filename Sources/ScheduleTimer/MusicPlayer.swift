import AVFoundation
import Foundation
import WZKit

/// Music 폴더의 BGM을 셔플 재생. Bgm*.img(Sound.wz) 안의 곡과 mp3/m4a/wav/aiff 파일을 모두 모음.
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
    private static let audioExtensions = ["mp3", "m4a", "wav", "aiff", "aif"]
    private var player: AVAudioPlayer?
    private var queue: [Track] = []

    override init() {
        let saved = UserDefaults.standard.object(forKey: Self.volumeKey) as? Double
        volume = saved ?? 0.3
        super.init()
        reload()
    }

    /// Music 폴더 다시 읽기
    func reload() {
        try? FileManager.default.createDirectory(at: AppFolder.music, withIntermediateDirectories: true)
        let files = ((try? FileManager.default.contentsOfDirectory(at: AppFolder.music, includingPropertiesForKeys: nil)) ?? [])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        var found: [Track] = []
        var failed: [String] = []
        for url in files {
            let ext = url.pathExtension.lowercased()
            if ext == "img" {
                do {
                    let root = try WZImage.load(contentsOf: url)
                    found += root.soundPaths.map { Track(url: url, soundPath: $0) }
                } catch {
                    failed.append(url.lastPathComponent)
                }
            } else if Self.audioExtensions.contains(ext) {
                found.append(Track(url: url, soundPath: nil))
            }
        }
        tracks = found
        queue = queue.filter { found.contains($0) }
        message = found.isEmpty
            ? "곡 없음 — Music 폴더에 Bgm*.img나 mp3를 넣어줘"
            : "곡 \(found.count)개" + (failed.isEmpty ? "" : " (읽기 실패: \(failed.joined(separator: ", ")))")
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
