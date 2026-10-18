import Foundation

public enum Format {
    /// 남은 초 → `MM:SS`, 1시간 이상이면 `H:MM:SS` (올림)
    public static func countdown(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded(.up)))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%02d:%02d", m, s)
    }

    /// maxChars 글자를 넘으면 자르고 `…` 붙임
    public static func truncate(_ text: String, maxChars: Int) -> String {
        text.count > maxChars ? String(text.prefix(maxChars)) + "…" : text
    }

    public static func hm(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    public static func range(_ start: Date, _ end: Date, calendar: Calendar = .current) -> String {
        "\(hm(start, calendar: calendar))–\(hm(end, calendar: calendar))"
    }

    /// 메뉴 막대 표시 문구
    public static func menuTitle(_ schedule: Schedule, now: Date, maxChars: Int) -> String {
        switch schedule.position(at: now) {
        case .empty:
            return "일정 없음"
        case .finished:
            return "일정 끝"
        case .inBlock(let i):
            let b = schedule.blocks[i]
            return "\(truncate(b.title, maxChars: maxChars)) · \(countdown(b.end.timeIntervalSince(now)))"
        case .gap(let j):
            let b = schedule.blocks[j]
            return "다음: \(truncate(b.title, maxChars: maxChars))까지 \(countdown(b.start.timeIntervalSince(now)))"
        }
    }
}
