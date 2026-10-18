import XCTest
@testable import ScheduleCore

final class ScheduleCoreTests: XCTestCase {
    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return c
    }()

    private var day: Date { cal.date(from: DateComponents(year: 2026, month: 10, day: 18))! }

    private func at(_ h: Int, _ m: Int, _ s: Int = 0, dayOffset: Int = 0) -> Date {
        cal.date(from: DateComponents(year: 2026, month: 10, day: 18 + dayOffset, hour: h, minute: m, second: s))!
    }

    private func parse(_ text: String) -> ParseResult {
        ScheduleParser.parse(text, day: day, calendar: cal)
    }

    private func hm(_ d: Date) -> String { Format.hm(d, calendar: cal) }

    // MARK: - 파서

    func testParsesBasicSchedule() {
        let r = parse("""
        09:00-10:30 영어공부
        10:30-10:45 휴식
        10:45-12:00 과제
        """)
        XCTAssertEqual(r.errors, [])
        XCTAssertEqual(r.blocks.map(\.title), ["영어공부", "휴식", "과제"])
        XCTAssertEqual(r.blocks[0].start, at(9, 0))
        XCTAssertEqual(r.blocks[2].end, at(12, 0))
    }

    func testAcceptsVariantsAndSkipsCommentsAndBlankLines() {
        let r = parse("""
        # 오늘 일정

        - 9:00 - 10:00 영어 공부
        10:00~11:00   과제 A
        * 11:00–12:00 점심
        """)
        XCTAssertEqual(r.errors, [])
        XCTAssertEqual(r.blocks.map(\.title), ["영어 공부", "과제 A", "점심"])
        XCTAssertEqual(r.blocks[0].start, at(9, 0))
    }

    func testReportsBadLinesAndKeepsTheRest() {
        let r = parse("""
        09:00-10:00 영어
        영어 10시
        25:00-26:00 이상
        10:30-10:00 거꾸로
        09:30-11:00 겹침
        11:00-12:00 과제
        """)
        XCTAssertEqual(r.blocks.map(\.title), ["영어", "과제"])
        XCTAssertEqual(r.errors.map(\.lineNumber), [2, 3, 4, 5])
        XCTAssertEqual(r.errors[3].reason, "1번째 줄과 시간이 겹침")
    }

    func testMidnightCrossing() {
        let r = parse("""
        22:00-23:30 정리
        23:30-00:30 독서
        00:30-01:00 잠 준비
        """)
        XCTAssertEqual(r.errors, [])
        XCTAssertEqual(r.blocks[1].end, at(0, 30, dayOffset: 1))
        XCTAssertEqual(r.blocks[2].start, at(0, 30, dayOffset: 1))
        XCTAssertEqual(r.blocks[2].end, at(1, 0, dayOffset: 1))
    }

    func testEndAt24() {
        let r = parse("23:00-24:00 마무리")
        XCTAssertEqual(r.errors, [])
        XCTAssertEqual(r.blocks[0].end, at(0, 0, dayOffset: 1))
    }

    // MARK: - 위치

    func testPosition() {
        let s = Schedule(blocks: parse("""
        09:00-10:00 A
        10:30-11:00 B
        """).blocks)
        XCTAssertEqual(s.position(at: at(8, 0)), .gap(nextIndex: 0))
        XCTAssertEqual(s.position(at: at(9, 30)), .inBlock(index: 0))
        XCTAssertEqual(s.position(at: at(10, 0)), .gap(nextIndex: 1))
        XCTAssertEqual(s.position(at: at(11, 0)), .finished)
        XCTAssertEqual(Schedule().position(at: at(9, 0)), .empty)
    }

    // MARK: - 지금 끝내기 / 건너뛰기

    private func sample() -> Schedule {
        Schedule(blocks: parse("""
        09:00-10:00 A
        10:00-10:30 B
        10:45-11:00 C
        """).blocks)
    }

    func testEndNowPullForwardShiftsEverythingAfter() {
        var s = sample()
        s.endCurrent(at: at(9, 40), mode: .pullForward, status: .completed)
        XCTAssertEqual(s.blocks[0].status, .completed)
        XCTAssertEqual(s.blocks[0].end, at(9, 40))
        XCTAssertEqual(s.blocks[1].start, at(9, 40))
        XCTAssertEqual(s.blocks[1].end, at(10, 10))
        // 빈 시간(15분)은 유지
        XCTAssertEqual(s.blocks[2].start, at(10, 25))
        XCTAssertEqual(s.position(at: at(9, 40)), .inBlock(index: 1))
    }

    func testEndNowKeepScheduleLeavesGap() {
        var s = sample()
        s.endCurrent(at: at(9, 40), mode: .keepSchedule, status: .completed)
        XCTAssertEqual(s.blocks[1].start, at(10, 0))
        XCTAssertEqual(s.position(at: at(9, 40)), .gap(nextIndex: 1))
    }

    func testSkipMarksSkipped() {
        var s = sample()
        s.endCurrent(at: at(9, 10), mode: .pullForward, status: .skipped)
        XCTAssertEqual(s.blocks[0].status, .skipped)
        XCTAssertEqual(s.blocks[1].start, at(9, 10))
        XCTAssertTrue(s.blocks[1].isModified)
    }

    // MARK: - 연장

    func testExtendPushLaterOnlyByOverlap() {
        var s = sample()
        // B(10:00-10:30) 진행 중, 10분 연장 → C까지 빈 시간 15분이라 밀 필요 없음
        s.extendCurrent(by: 600, at: at(10, 10), mode: .pushLater)
        XCTAssertEqual(s.blocks[1].end, at(10, 40))
        XCTAssertEqual(s.blocks[2].start, at(10, 45))
        // 다시 10분 연장 → 10:50, C와 5분 겹침 → 5분 밀기
        s.extendCurrent(by: 600, at: at(10, 20), mode: .pushLater)
        XCTAssertEqual(s.blocks[2].start, at(10, 50))
        XCTAssertEqual(s.blocks[2].end, at(11, 5))
    }

    func testExtendShrinkNext() {
        var s = sample()
        s.extendCurrent(by: 600, at: at(9, 30), mode: .shrinkNext)
        XCTAssertEqual(s.blocks[0].end, at(10, 10))
        XCTAssertEqual(s.blocks[1].start, at(10, 10))
        XCTAssertEqual(s.blocks[1].end, at(10, 30))
        XCTAssertEqual(s.blocks[2].start, at(10, 45))
    }

    func testExtendShrinkDropsBlockAndContinues() {
        var s = Schedule(blocks: parse("""
        09:00-10:00 A
        10:00-10:05 B
        10:05-11:00 C
        """).blocks)
        s.extendCurrent(by: 600, at: at(9, 30), mode: .shrinkNext)
        XCTAssertEqual(s.blocks[1].status, .dropped)
        XCTAssertEqual(s.blocks[2].start, at(10, 10))
        // 연장 끝나면 바로 C
        XCTAssertEqual(s.position(at: at(10, 10)), .inBlock(index: 2))
    }

    func testResetToOriginal() {
        var s = sample()
        s.endCurrent(at: at(9, 40), mode: .pullForward, status: .completed)
        XCTAssertTrue(s.hasModifications)
        s.resetToOriginal()
        XCTAssertFalse(s.hasModifications)
        XCTAssertEqual(s.blocks[1].start, at(10, 0))
        XCTAssertEqual(s.blocks[0].status, .scheduled)
    }

    // MARK: - 표시

    func testCountdownFormat() {
        XCTAssertEqual(Format.countdown(23 * 60 + 41), "23:41")
        XCTAssertEqual(Format.countdown(0.3), "00:01")
        XCTAssertEqual(Format.countdown(3600 + 23 * 60 + 41), "1:23:41")
    }

    func testTruncate() {
        XCTAssertEqual(Format.truncate("영어공부", maxChars: 6), "영어공부")
        XCTAssertEqual(Format.truncate("토익 리스닝 파트3", maxChars: 6), "토익 리스닝…")
    }

    func testMenuTitle() {
        let s = sample()
        XCTAssertEqual(Format.menuTitle(s, now: at(9, 36, 19), maxChars: 6), "A · 23:41")
        XCTAssertEqual(Format.menuTitle(s, now: at(10, 40), maxChars: 6), "다음: C까지 05:00")
        XCTAssertEqual(Format.menuTitle(s, now: at(12, 0), maxChars: 6), "일정 끝")
        XCTAssertEqual(Format.menuTitle(Schedule(), now: at(12, 0), maxChars: 6), "일정 없음")
    }
}
