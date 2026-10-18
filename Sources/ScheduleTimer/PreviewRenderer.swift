import AppKit
import SwiftUI
import ScheduleCore

/// `ScheduleTimer --render-preview <폴더>`: 예시 일정으로 상태바·레벨업 화면을 PNG로 저장 (확인용)
@MainActor
enum PreviewRenderer {
    static func render(to directory: String) {
        let folder = URL(fileURLWithPath: directory, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let text = """
        17:30-17:50 범위훑기·우선순위
        17:50-19:10 경컴1 핵심개념
        19:10-19:50 저녁
        19:50-21:00 경컴2 문제풀이·요약
        21:00-21:10 휴식
        21:10-22:30 물류1 핵심개념
        22:30-22:40 휴식
        22:40-23:40 물류2 문제풀이
        23:40-00:00 물류 요약·암기점검
        00:00-00:20 씻고 정리
        """
        var schedule = Schedule(blocks: ScheduleParser.parse(text, day: today).blocks)
        func at(_ h: Int, _ m: Int, _ s: Int = 0) -> Date {
            calendar.date(byAdding: .second, value: h * 3600 + m * 60 + s, to: today)!
        }
        let now = at(18, 5, 49)
        // 첫 블록은 끝까지 진행한 상태
        let inBlock = StatusSnapshot(schedule: schedule, now: now)

        schedule.endCurrent(at: now, mode: .keepSchedule, status: .completed)
        let inGap = StatusSnapshot(schedule: schedule, now: at(18, 30))

        for (name, snapshot) in [("statusbar-block", inBlock), ("statusbar-gap", inGap)] {
            save(
                StatusBarView(snapshot: snapshot, nickname: "임진택", scale: 1.5)
                    .padding(20)
                    .background(Color(white: 0.92)),
                to: folder.appendingPathComponent("\(name).png")
            )
        }

        save(
            VStack(spacing: -20) {
                LevelUpView(scale: 1, fixedElapsed: 0.7)
                StatusBarView(snapshot: inBlock, nickname: "임진택", scale: 1)
            }
            .padding(20)
            .background(Color(white: 0.25)),
            to: folder.appendingPathComponent("levelup.png")
        )
    }

    private static func save<V: View>(_ view: V, to url: URL) {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:])
        else {
            print("렌더링 실패: \(url.lastPathComponent)")
            return
        }
        try? png.write(to: url)
        print("저장: \(url.path)")
    }
}
