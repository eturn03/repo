# DD4 전개 도우미

마스터 듀얼 DD 덱("DD4")용 전개 도우미 정적 사이트. 데이터는 `data/dd-guide.md`, `data/dd-routes.md` 두 문서만 쓴다.

## 여는 방법

- `index.html`을 더블클릭하면 브라우저에서 열린다. 서버도 설치도 필요 없다.
- 화면: **패 선택**(패 → 추천 루트) / **루트 진행**(단계 체크리스트, 패트랩 버튼, 최종 필드, 상대 행동 역조회, 출처) / **전체 루트** / **문서·검사**.
- 진행 중인 루트와 체크 상태는 브라우저에 저장된다(저장이 막힌 환경에서도 화면은 동작함).

## md를 고친 뒤 데이터 다시 만들기

파이썬 3만 있으면 된다(추가 설치 없음). 저장소 폴더에서:

```
python3 scripts/build_data.py
```

Windows는 `py scripts\build_data.py`. 실행하면 `data/dd-data.json`, `data/dd-data.js`, `data/validation-report.md`가 새로 만들어지고, 검사 결과(루트 29개, 루트 속 카드가 덱 리스트에 있는지 등)가 화면에 찍힌다. 검사가 실패하면 끝에 실패 개수가 나온다.

- 카드 약칭(예: `코페르` → `DD 마도현자 코페르니쿠스`), 패트랩 버튼, 대응 표를 루트 단계에 맞추는 규칙, 상대 행동 역조회 매핑은 `data/app-config.json`에 있다. 덱에 새 카드를 넣으면 여기에 약칭도 추가해야 한다.
- 파싱하면서 애매했던 곳과 비워 둔 기능은 `NOTES.md`에 정리했다.

## 화면 시나리오 확인(선택)

Node.js + Playwright가 있으면: `NODE_PATH="$(npm root -g)" node tests/scenarios.cjs` → `screenshots/`에 결과 이미지 저장.

## GitHub Pages

저장소 설정 → Pages → 브랜치 루트(`/`)를 고르면 그대로 올라간다(`.nojekyll` 포함).
