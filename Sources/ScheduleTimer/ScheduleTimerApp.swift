import SwiftUI

@main
struct ScheduleTimerApp: App {
    @StateObject private var store = AppStore()

    var body: some Scene {
        MenuBarExtra {
            ContentView()
                .environmentObject(store)
        } label: {
            Text(store.menuTitle)
        }
        .menuBarExtraStyle(.window)
    }
}
