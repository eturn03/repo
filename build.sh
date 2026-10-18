#!/bin/bash
# 일정 타이머 앱을 빌드해서 응용 프로그램 폴더(/Applications)에 설치하고 실행한다.
# 사용법: bash build.sh
# (BUILD_ONLY=1 이면 설치·실행 없이 build/ 에 앱만 만든다)
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ 빌드 중... (처음엔 1~2분 걸릴 수 있음)"
swift build -c release --product ScheduleTimer
BIN_DIR="$(swift build -c release --show-bin-path)"

APP="build/ScheduleTimer.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN_DIR/ScheduleTimer" "$APP/Contents/MacOS/ScheduleTimer"
cp Resources/Info.plist "$APP/Contents/Info.plist"

# 앱 아이콘: 앱이 직접 그린 PNG → .icns
mkdir -p "$APP/Contents/Resources"
ICONSET="build/AppIcon.iconset"
rm -rf "$ICONSET"
if "$APP/Contents/MacOS/ScheduleTimer" --render-icon "$ICONSET" >/dev/null 2>&1 \
    && iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"; then
    echo "▶ 아이콘 생성 완료"
else
    echo "(아이콘 생성 실패 — 기본 아이콘으로 진행)"
fi
codesign --force --sign - "$APP"
echo "▶ 앱 생성 완료: $APP"

if [ "${BUILD_ONLY:-0}" = "1" ]; then
    exit 0
fi

# 맥 기본 '응용 프로그램' 폴더에 설치 (쓸 수 없으면 내 홈의 응용 프로그램 폴더)
if [ -w /Applications ]; then
    DEST="/Applications/ScheduleTimer.app"
    rm -rf "$HOME/Applications/ScheduleTimer.app"   # 예전 위치의 복사본 정리
else
    DEST="$HOME/Applications/ScheduleTimer.app"
    mkdir -p "$HOME/Applications"
fi
pkill -x ScheduleTimer 2>/dev/null || true
sleep 1
rm -rf "$DEST"
cp -R "$APP" "$DEST"
touch "$DEST"   # Finder·Dock이 새 아이콘을 다시 읽게
open "$DEST"
echo "✅ 설치 완료: $DEST"
echo "   화면 아래쪽에 상태바가 뜨면 성공!"
