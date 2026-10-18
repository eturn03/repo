import Foundation

public enum BlockStatus: String, Codable {
    case scheduled   // 예정/진행 중
    case completed   // 일찍 끝냄
    case skipped     // 건너뜀
    case dropped     // 연장 때문에 시간이 0이 되어 없어짐
}

public struct Block: Codable, Identifiable, Equatable {
    public var id: UUID
    public var title: String
    public var originalStart: Date
    public var originalEnd: Date
    public var start: Date
    public var end: Date
    public var status: BlockStatus

    public init(title: String, start: Date, end: Date) {
        self.id = UUID()
        self.title = title
        self.originalStart = start
        self.originalEnd = end
        self.start = start
        self.end = end
        self.status = .scheduled
    }

    /// 원래 일정과 달라졌는지
    public var isModified: Bool {
        status != .scheduled || start != originalStart || end != originalEnd
    }

    /// 아직 진행될 수 있는 블록인지 (끝냄/건너뜀/없어짐 제외)
    var isLive: Bool { status == .scheduled && end > start }
}

public enum Position: Equatable {
    case empty                 // 일정 없음
    case inBlock(index: Int)   // 블록 진행 중
    case gap(nextIndex: Int)   // 빈 시간 (다음 블록 대기)
    case finished              // 오늘 일정 끝
}

public enum EndMode {
    case pullForward   // (a) 다음 블록 바로 시작, 이후 일정 앞당김
    case keepSchedule  // (b) 원래 일정 유지, 다음 블록 전까지 빈 시간
}

public enum ExtendMode {
    case pushLater   // 다음 블록과 겹치는 만큼 이후 일정 뒤로 밀기
    case shrinkNext  // 겹치는 만큼 다음 블록(들) 줄이기
}

public struct Schedule: Codable, Equatable {
    public var blocks: [Block]

    public init(blocks: [Block] = []) {
        self.blocks = blocks
    }

    public var hasModifications: Bool { blocks.contains { $0.isModified } }

    public func position(at now: Date) -> Position {
        if blocks.isEmpty { return .empty }
        if let i = blocks.firstIndex(where: { $0.isLive && $0.start <= now && now < $0.end }) {
            return .inBlock(index: i)
        }
        if let j = blocks.firstIndex(where: { $0.isLive && $0.start > now }) {
            return .gap(nextIndex: j)
        }
        return .finished
    }

    /// 현재 블록을 지금 끝냄. status는 .completed(지금 끝내기) 또는 .skipped(건너뛰기).
    public mutating func endCurrent(at now: Date, mode: EndMode, status: BlockStatus) {
        guard case .inBlock(let i) = position(at: now) else { return }
        blocks[i].end = now
        blocks[i].status = status
        guard mode == .pullForward, let j = nextLiveIndex(after: i) else { return }
        let delta = blocks[j].start.timeIntervalSince(now)
        if delta > 0 { shift(after: i, by: -delta) }
    }

    /// 현재 블록을 seconds만큼 연장
    public mutating func extendCurrent(by seconds: TimeInterval, at now: Date, mode: ExtendMode) {
        guard case .inBlock(let i) = position(at: now) else { return }
        let newEnd = blocks[i].end.addingTimeInterval(seconds)
        blocks[i].end = newEnd
        switch mode {
        case .pushLater:
            // 빈 시간을 먼저 쓰고, 다음 블록과 겹치는 만큼만 밀기
            guard let j = nextLiveIndex(after: i) else { return }
            let overlap = newEnd.timeIntervalSince(blocks[j].start)
            if overlap > 0 { shift(after: i, by: overlap) }
        case .shrinkNext:
            // 겹치는 블록의 시작을 newEnd로 미룸. 길이가 0 이하가 되면 없어짐 처리 후 그다음 블록도 계속 줄임
            for k in blocks.indices where k > i && blocks[k].status == .scheduled {
                if blocks[k].start >= newEnd { break }
                if blocks[k].end <= newEnd {
                    blocks[k].start = blocks[k].end
                    blocks[k].status = .dropped
                } else {
                    blocks[k].start = newEnd
                }
            }
        }
    }

    /// 새 블록들을 기존 일정에 시간 순서대로 끼워 넣음.
    /// 기존 블록과 시간이 겹치는 새 블록은 넣지 않고 오류로 돌려줌.
    public mutating func merge(_ result: ParseResult, calendar: Calendar = .current) -> (added: Int, conflicts: [ParseError]) {
        var conflicts: [ParseError] = []
        var added = 0
        for (index, block) in result.blocks.enumerated() {
            let source = index < result.sources.count ? result.sources[index] : (lineNumber: 0, line: block.title)
            let clash = blocks.first {
                $0.status != .dropped && $0.end > $0.start && block.start < $0.end && $0.start < block.end
            }
            if let clash {
                let range = Format.range(clash.start, clash.end, calendar: calendar)
                conflicts.append(ParseError(lineNumber: source.lineNumber, line: source.line,
                                            reason: "기존 '\(clash.title)'(\(range))과 겹침"))
                continue
            }
            blocks.append(block)
            added += 1
        }
        blocks.sort { $0.start < $1.start }
        return (added, conflicts)
    }

    /// date 이전에 끝난 블록 지우기 (어제 이전 일정 정리용)
    public mutating func removeBlocks(endingBefore date: Date) {
        blocks.removeAll { $0.end <= date }
    }

    /// 블록 하나 삭제 (뒤 일정 시간은 그대로, 지운 자리는 빈 시간)
    public mutating func removeBlock(id: UUID) {
        blocks.removeAll { $0.id == id }
    }

    public mutating func resetToOriginal() {
        for k in blocks.indices {
            blocks[k].start = blocks[k].originalStart
            blocks[k].end = blocks[k].originalEnd
            blocks[k].status = .scheduled
        }
    }

    private func nextLiveIndex(after i: Int) -> Int? {
        blocks.indices.first { $0 > i && blocks[$0].isLive }
    }

    private mutating func shift(after i: Int, by seconds: TimeInterval) {
        for k in blocks.indices where k > i {
            blocks[k].start.addTimeInterval(seconds)
            blocks[k].end.addTimeInterval(seconds)
        }
    }
}
