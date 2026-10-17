# DD4 전개 도우미

마스터 듀얼 DD 덱("DD4")용 전개 도우미 정적 사이트. 데이터는 `data/dd-guide.md`, `data/dd-routes.md`, 패트랩 대응 `data/dd-handtraps.json`·`data/dd-handtraps.md`, 수순 모음 `data/dd-planlib.json`만 쓴다.

## 여는 방법

- `index.html`을 더블클릭하면 브라우저에서 열린다. 서버도 설치도 필요 없다.
- 화면: **패 선택**(패 → 추천 루트) / **루트 진행**(단계 체크리스트, 단계별 패트랩 대응, 니비루, 최종 필드, 상대 행동 역조회, 출처) / **전체 루트** / **패트랩 요약** / **문서·검사**.
- 진행 중인 루트와 체크 상태는 브라우저에 저장된다(저장이 막힌 환경에서도 화면은 동작함).
- 기본은 다크 테마. 오른쪽 위 "다크/라이트"로 바꾼다(선택은 브라우저에 저장).
- **계산기**: 패를 고르면 그 자리에서 수순을 계산하고(패 선택 화면 "이 패로 계산한 수순"), 패트랩 버튼도 그 자리에서 계산한다. 계산은 `assets/calc/engine.js`(Python 계산기를 옮긴 것)를 Web Worker로 돌린다. 1초를 넘거나 실패하면 미리 만든 데이터(`dd-handtraps.json`, `dd-planlib.json`)를 먼저 보여주고, 계산이 끝나면 바꾼다.
- 패트랩 대응은 루트를 열 때 그 루트 파일만 불러온다. 화면에 나오는 계산 결과는 "최소 이만큼은 된다"는 하한이고 MD 실기로 확인하지 않았다(dd-handtraps.md 6장).
- **폰에서 열 때**: `index.html`은 옆에 있는 `assets/`·`data/` 폴더가 같이 있어야 동작한다. 폰으로는 폴더째 옮기기 어려우니 파일 하나로 합친 `dd4-helper.html`(약 11.6MB, 패트랩 데이터·계산기·수순 모음 포함)을 쓴다. GitHub 앱이나 웹에서 html 파일을 누르면 페이지가 실행되지 않고 코드만 보인다. 그러니 파일을 기기에 받은 뒤 브라우저로 열거나, GitHub Pages 주소로 연다.

## md를 고친 뒤 데이터 다시 만들기

파이썬 3만 있으면 된다(추가 설치 없음). 저장소 폴더에서:

```
python3 scripts/build_data.py
```

패트랩 데이터(`data/dd-handtraps.json`·`.md`)를 바꿨으면 `python3 scripts/build_handtraps.py`도 돌린다(루트별 파일 `data/handtraps/A1.js` 등, 수순 모음 `data/planlib.js`, `data/handtraps-report.md`가 새로 생김). 그다음 `python3 scripts/build_single.py`를 돌리면 `dd4-helper.html`(한 파일 버전)도 새로 만들어진다. Windows는 `py scripts\build_data.py`. 실행하면 `data/dd-data.json`, `data/dd-data.js`, `data/validation-report.md`가 새로 만들어지고, 검사 결과(루트 29개, 루트 속 카드가 덱 리스트에 있는지 등)가 화면에 찍힌다. 검사가 실패하면 끝에 실패 개수가 나온다.

- 카드 약칭(예: `코페르` → `DD 마도현자 코페르니쿠스`), 추천 순서용 루트 묶음, 상대 행동 역조회 매핑은 `data/app-config.json`에 있다. 덱에 새 카드를 넣으면 여기에 약칭도 추가해야 한다.
- 파싱하면서 애매했던 곳과 비워 둔 기능은 `NOTES.md`에 정리했다.

## 화면 시나리오 확인(선택)

Node.js + Playwright가 있으면: `NODE_PATH="$(npm root -g)" node tests/scenarios.cjs` → `screenshots/`에 결과 이미지 저장.

계산기와 Python fixtures 비교: `node tests/calc_fixtures.cjs` (결과 설명은 `tests/calc-fixtures-report.md`).

## GitHub Pages

저장소 설정 → Pages → 브랜치 루트(`/`)를 고르면 그대로 올라간다(`.nojekyll` 포함).
