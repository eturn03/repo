import Foundation

public struct ParseError: Equatable {
    public let lineNumber: Int
    public let line: String
    public let reason: String
}

public struct ParseResult {
    public var blocks: [Block]
    public var errors: [ParseError]
}

/// 한 줄에 한 블록: `09:00-10:30 영어공부`
/// - 허용: `9:00-10:30`, `09:00 - 10:30`, `09:00~10:30`, 앞의 `-`/`*`/`•` 글머리표
/// - 무시: 빈 줄, `#`으로 시작하는 줄
/// - 끝 시간이 시작보다 빠르면 자정을 넘긴 것으로 처리 (최대 12시간)
public enum ScheduleParser {
    private static let maxMidnightCrossing: TimeInterval = 12 * 3600

    private static let pattern = try! NSRegularExpression(
        pattern: #"^\s*(?:[-*•]\s+)?(\d{1,2}):(\d{2})\s*[-~–—]\s*(\d{1,2}):(\d{2})\s+(.+?)\s*$"#
    )

    public static func parse(_ text: String, day: Date, calendar: Calendar = .current) -> ParseResult {
        let dayStart = calendar.startOfDay(for: day)
        var blocks: [Block] = []
        var errors: [ParseError] = []
        var previous: (end: Date, lineNumber: Int)?

        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        for (offset, rawLine) in lines.enumerated() {
            let lineNumber = offset + 1
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }

            func fail(_ reason: String) {
                errors.append(ParseError(lineNumber: lineNumber, line: line, reason: reason))
            }

            let range = NSRange(line.startIndex..., in: line)
            guard let m = pattern.firstMatch(in: line, range: range) else {
                fail("형식이 맞지 않음 (예: 09:00-10:30 영어공부)")
                continue
            }
            func group(_ n: Int) -> String { String(line[Range(m.range(at: n), in: line)!]) }
            let sh = Int(group(1))!, sm = Int(group(2))!, eh = Int(group(3))!, em = Int(group(4))!
            let title = group(5)

            guard sh < 24, sm < 60, em < 60, eh < 24 || (eh == 24 && em == 0) else {
                fail("없는 시각이 있음")
                continue
            }

            var start = calendar.date(byAdding: .minute, value: sh * 60 + sm, to: dayStart)!
            if let prev = previous, start < prev.end {
                if prev.end.timeIntervalSince(start) > maxMidnightCrossing {
                    // 앞 줄보다 한참 이른 시각 → 자정 넘어 다음 날로 봄
                    start = calendar.date(byAdding: .day, value: 1, to: start)!
                } else {
                    fail("\(prev.lineNumber)번째 줄과 시간이 겹침")
                    continue
                }
            }

            let startDay = calendar.startOfDay(for: start)
            var end = calendar.date(byAdding: .minute, value: eh * 60 + em, to: startDay)!
            if end == start {
                fail("시작과 끝 시간이 같음")
                continue
            }
            if end < start {
                end = calendar.date(byAdding: .day, value: 1, to: end)!
                if end.timeIntervalSince(start) > maxMidnightCrossing {
                    fail("끝 시간이 시작 시간보다 빠름")
                    continue
                }
            }

            blocks.append(Block(title: title, start: start, end: end))
            previous = (end, lineNumber)
        }
        return ParseResult(blocks: blocks, errors: errors)
    }
}
