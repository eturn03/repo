import Foundation

/// 상태바(LV / 이름 / HP / MP / EXP)에 보여줄 값
public struct StatusSnapshot: Equatable {
    public enum Phase: Equatable { case empty, inBlock, gap, finished }

    public var phase: Phase
    /// 오늘 끝낸 블록 수 (건너뜀·없어짐 제외)
    public var level: Int
    /// 지금 할 일 (빈 시간이면 다음 할 일 안내)
    public var title: String
    /// EXP: 지금 블록(또는 빈 시간) 진행률 0...1, 남은 초
    public var expProgress: Double
    public var expRemaining: TimeInterval?
    /// HP: 오늘 일정 전체(첫 블록 시작~마지막 블록 끝) 중 남은 시간
    public var hpRemaining: TimeInterval
    public var hpTotal: TimeInterval
    /// MP: 남은 블록 수 / 전체 블록 수
    public var mpRemaining: Int
    public var mpTotal: Int

    public init(schedule: Schedule, now: Date) {
        let blocks = schedule.blocks
        let live = blocks.filter { $0.isLive }

        level = blocks.filter { Self.countsAsDone($0, now: now) }.count
        mpTotal = blocks.count
        mpRemaining = live.filter { $0.end > now }.count

        if let first = live.map(\.start).min(), let last = live.map(\.end).max() {
            hpTotal = last.timeIntervalSince(first)
            hpRemaining = min(hpTotal, max(0, last.timeIntervalSince(max(now, first))))
        } else {
            hpTotal = 0
            hpRemaining = 0
        }

        switch schedule.position(at: now) {
        case .empty:
            phase = .empty
            title = "일정 없음"
            expProgress = 0
            expRemaining = nil
        case .finished:
            phase = .finished
            title = "오늘 일정 끝"
            expProgress = 0
            expRemaining = nil
        case .inBlock(let i):
            let b = blocks[i]
            phase = .inBlock
            title = b.title
            expProgress = Self.progress(from: b.start, to: b.end, now: now)
            expRemaining = b.end.timeIntervalSince(now)
        case .gap(let j):
            let next = blocks[j]
            phase = .gap
            title = "다음: \(next.title)"
            // 빈 시간 시작 = 지금 이전에 끝난 블록 중 가장 늦은 끝 시각
            let gapStart = blocks.filter { $0.end <= now && $0.end > $0.start }.map(\.end).max()
            expProgress = gapStart.map { Self.progress(from: $0, to: next.start, now: now) } ?? 0
            expRemaining = next.start.timeIntervalSince(now)
        }
    }

    // MARK: - 게이지 표시용

    public var hpFraction: Double { hpTotal > 0 ? hpRemaining / hpTotal : 0 }
    public var mpFraction: Double { mpTotal > 0 ? Double(mpRemaining) / Double(mpTotal) : 0 }
    public var hpText: String { "[\(Format.hoursMinutes(hpRemaining))/\(Format.hoursMinutes(hpTotal))]" }
    public var mpText: String { "[\(mpRemaining)/\(mpTotal)]" }
    /// `남은시간[퍼센트]`, 진행 중인 게 없으면 빈 문자열
    public var expText: String {
        expRemaining.map { "\(Format.countdown($0))[\(Format.percent(expProgress))]" } ?? ""
    }

    /// 레벨에 포함되는 블록: 일찍 완료했거나 끝까지 진행한 블록
    public static func countsAsDone(_ block: Block, now: Date) -> Bool {
        switch block.status {
        case .completed: return true
        case .scheduled: return block.end > block.start && block.end <= now
        case .skipped, .dropped: return false
        }
    }

    private static func progress(from start: Date, to end: Date, now: Date) -> Double {
        let total = end.timeIntervalSince(start)
        guard total > 0 else { return 0 }
        return min(1, max(0, now.timeIntervalSince(start) / total))
    }
}

extension Format {
    /// 초 → `H:MM` (HP 표시용, 내림)
    public static func hoursMinutes(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds)) / 60
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    /// 0...1 → `43.77%` (내림)
    public static func percent(_ value: Double) -> String {
        let floored = (value * 10000).rounded(.down) / 100
        return String(format: "%.2f%%", floored)
    }
}
