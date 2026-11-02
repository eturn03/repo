# DD4 전개 도우미 — 다른 세션 인수인계 (2026-11-02 기준)

## 1. 한 줄 요약

마스터 듀얼 DD 덱("DD4")용 한국어 정적 사이트. 패를 고르면 루트 추천, 단계 체크리스트, 패트랩 대응을 보여준다.
Python 계산기를 JavaScript(Web Worker)로 옮겨서 **패와 패트랩 대응을 그 자리에서 계산**한다.
저장소 `https://github.com/eturn03/repo`, 브랜치 **`claude/kind-darwin-quk272`** (최신 커밋 `0adbf14`). PR은 만들지 않았다.
웹 버전(Claude 아티팩트, 비공개): https://claude.ai/artifact/CYhkBeFbNX1v7Bp6QMs3QN (Version 13)

## 2. 절대 규칙 (처음부터 사용자가 정한 것)

- 데이터는 `data/` 안의 파일만 쓴다. **파일에 없는 전개·대응·룰을 지어내지 않는다. 유희왕 지식으로 빈칸을 채우지 않는다.**
- 데이터에 붙은 "(추정)", "(해석)", "(미검증)", "(원문 생략, 보완)" 표시는 화면에 그대로 보인다.
- **데이터 내용은 고치지 않는다. 표시만 한다.** 이상해 보이는 건 고치지 말고 목록으로 사용자에게 알린다.
- 정적 HTML+CSS+바닐라 JS, `file://`로 열려야 한다(데이터는 JS 파일). 한국어 UI, 가로 스크롤 없음, 다크 테마 기본(라이트 선택 가능), localStorage는 항상 try/catch, GitHub Pages 가능(`.nojekyll`).
- 다크 테마: 버튼 높이 44px 이상, 글자 16px 이상, 버튼 간격 8px 이상, 선택 = 채움 + ✓, 포커스 `#7cc4cc`, 모션 줄이기 존중. 색상 대비 기준(텍스트 4.5:1, 버튼 테두리 3:1)과 측정값은 `NOTES.md`에 있다.
- 사용자는 코드 비전문가다. 설명은 짧게, 한국어 반말, 결과·한계를 솔직하게(안 한 건 "안 했다"고 쓴다).

## 3. 저장소 구조

| 경로 | 내용 |
|---|---|
| `index.html`, `assets/style.css`, `assets/app.js` | 화면과 로직 |
| `assets/calc/engine.js` | Python 계산기를 줄 단위로 옮긴 것. `DD_CALC_FACTORY(routes)`, Node에서도 `require` 가능 |
| `data/dd-guide.md`, `dd-routes.md`, `dd-handtraps.md` | 원문(사용자가 준 것) |
| `data/dd-handtraps.json`(3,138건), `dd-planlib.json`(770수순), `dd-smallworld.json`(92경로) | 미리 만든 데이터(사용자가 준 것, 수정 금지) |
| `data/app-config.json` | 카드 약칭, 추천 순서용 루트 묶음, 역조회 매핑 |
| `data/dd-data.json/.js`, `data/handtraps/*.js`, `data/planlib.js`, `data/smallworld.js` | **빌드 산출물** |
| `scripts/build_data.py` → `build_handtraps.py` → `build_single.py` | 이 순서로 실행. 마지막이 `dd4-helper.html`(한 파일 버전, 약 11.6MB) |
| `tests/scenarios.cjs` | Playwright 화면 시험 142개 |
| `tests/calc_fixtures.cjs` | JS 계산기 ↔ Python fixtures 비교 |
| `tests/deck_pulls_check.cjs`, `tests/site_pick.cjs` | 추천 1순위가 덱에 없는 카드를 꺼내지 않는지 무작위 패 600개로 검사(약 8분) |
| `calculator-python/` | 원본 Python 계산기(변경 없음) |
| `NOTES.md`, `README.md` | 파싱 애매한 곳, 계산기 이식 메모, 대비 측정값, 사용법 |

## 4. 실행·시험 방법

```
python3 scripts/build_data.py && python3 scripts/build_handtraps.py && python3 scripts/build_single.py
NODE_PATH="$(npm root -g)" node tests/scenarios.cjs                      # index.html, 142개 전부 통과해야 함
SITE_FILE=dd4-helper.html NODE_PATH="$(npm root -g)" node tests/scenarios.cjs   # 한 파일 버전
node tests/calc_fixtures.cjs                                             # routes 29/29, hands 40/40, handtraps 187/200(+고정판 Python 200/200)
node tests/deck_pulls_check.cjs                                          # 위반 0건이어야 함(종료 코드 0)
```

웹 버전 갱신(아티팩트)은 클라우드 세션 전용이라 로컬 세션에서는 필요 없다. 로컬에서는 `dd4-helper.html`을 브라우저로 열면 된다.

## 5. 지금까지 구현된 것

- **패 선택**: 패 최대 6장. 추천 루트, 상대 유발 예상(니비루/무한포영), "이 패로 계산한 수순".
  - 순서: dd-planlib.json 장수 검사 결과를 **즉시** 보여주고, 계산기 결과가 점수가 더 높을 때만 바꾼다.
  - 스몰 월드: 갈 수 있는 경로를 전부 계산기로 확인(바뀐 패·제외 카드가 같은 경로는 하나로). **보여준 카드(reveal)와 다리(bridge)는 둘 다 덱 장수에서 1장씩 뺀다**(2026-10-18 정정본 규칙).
  - 다크 오컬티즘: 조회표대로 1장 버리고 제로마키나를 서치한 패로 계산. 점수가 같으면 우라라는 버리지 않는다(사용자 지시).
  - 이니시도 스몰 월드도 없는 패: 29개 루트 전부 시도, 몬스터가 안 남으면 "수순 없음".
- **패트랩**: 루트 진행에서 단계를 고르고 패트랩 버튼을 누르면 그 자리에서 계산(Web Worker). 1초 넘으면 미리 만든 데이터를 먼저 보여주고 계산이 끝나면 바꾼다. Worker를 못 쓰면 미리 만든 데이터로 대신한다. "미리 만든 데이터로 보기" 토글, "패에 ○○ 있으면" 탭은 미리 만든 데이터에만 있다.
- **표기**: 단계 문장은 데이터에서 "하는 일(누구 효과)" 순서이고, 화면에는 `fmtStep()`이 **"누구 효과 → 하는 일"**로 바꿔 보인다(데이터·계산기는 원문 그대로). 문서 인용(md에서 옮긴 문장)은 원문 그대로.
- "(대체)"는 주황 배지, "(추가)"는 파란 배지.

## 6. 계산기에 대해 알아야 할 것

- 원본 Python 계산기(`calculator.zip`: checker.py, engine.py, hits.py 등)는 저장소의 `calculator-python/` 폴더에 그대로 들어 있다(수정 없음, 동점 고정 패치는 `tests/fixtures/python-pinned.patch`). 그 안의 `PORTING.md` 지시: 단계 문장 문법 변경 금지, 거리 가중치는 반올림 말고 ×10 정수, 점수 ±0.01 일치.
- Python과 JS가 갈리던 13건의 원인은 Python의 `sorted(set(...))`가 동점에서 실행마다 순서가 바뀌는 것. 두 동점 규칙(거리 동점 → (루트 id, 단계), 대체 후보 동점 → 처음 나온 순서)을 Python에 넣은 패치가 `tests/fixtures/python-pinned.patch`다. 이 패치를 넣은 Python과는 fixtures 전부 일치한다.
- 미리 만든 `dd-handtraps.json`·`dd-planlib.json`은 **패치 전 Python**으로 만들어졌다. 그래서 일부 레코드는 "미리 만든 데이터"와 "실시간 계산" 결과가 다르다(예: A1 17단계 니비루 3.6점 vs 6.6점). 데이터를 만드는 쪽에서 패치를 적용해 다시 만들어야 맞는다. 사이트에서는 손대지 않았다.
- 스몰 월드가 든 패 하나의 계산은 평균 약 1.2초, 최대 약 4.2초(Node 기준). 폰은 더 느릴 수 있다(재보지 않음).

## 7. 아직 안 끝난 것 (사용자 결정·작업 대기)

1. **케플러 효과가 무효되는 경우가 매우 많다는 플레이 경험**(사용자). 지금 데이터에서 A1·A2·B1 2단계 지옥문 서치가 우라라·무한포영·뵐러에 막히면 패에 다른 카드가 없을 때 케플러만 남는다(0.09~0.3점). 제안했지만 답을 못 받은 것:
   - (1) 패 선택 화면에 "케플러 효과가 막히면" 결과를 미리 보여주기(추천),
   - (2) "케플러 효과 무효 걱정" 선택지를 추가해 추천 순서를 바꾸기(점수 섞는 기준이 데이터에 없음),
   - (3) 둘 다.
2. **DDD研究所(d-eye.work)에 "※ケプラー無効" 글이 있다.** 클라우드 환경에서는 사이트 접속이 막혀 본문을 못 읽었다(검색 요약만 확인). 후보 글:
   - #734 (케플러+지옥문) https://www.d-eye.work/entry/2025/09/13/230019
   - #776 (그리폰+케플러) https://www.d-eye.work/entry/2026/01/18/193755
   - #777 (케플러+스케일) https://www.d-eye.work/entry/2026/01/19/110841
   - #778 (케플러+령왕) https://www.d-eye.work/entry/2026/01/20/111314
   - 주의: `dd-guide.md`는 "케플러 무효 대응 블로그 루트는 전부 이 덱에 없는 카드를 써서 미확인"이라고 한다. 본문에서 쓰는 카드가 전부 DD4 덱 리스트(`dd-guide.md` 덱 리스트)에 있는지 먼저 확인해야 한다. **읽은 내용을 데이터(`dd-routes.md` 등)에 바로 넣지 말고, 사용자에게 보여주고 확인받은 뒤에 넣는다.**
3. 문서 인용 부분(md 4장 "가장 아픈 지점" 등)의 표기 순서도 "누구 효과 → 하는 일"로 바꿀지 — 질문만 해 두고 답을 못 받았다.
4. "점수가 높아도 스몰 월드 경로는 뒤로" 같은 우선순위 규칙을 둘지 — 질문만 해 두고 답을 못 받았다. 지금은 점수가 같으면 패 그대로 → 스몰 월드 → 다크 오컬티즘 순.
5. 사용자가 웹 버전에서 계산기가 도는지 직접 확인하기로 했다(패 선택 → 그리폰·스케일·우라라 → "실시간 계산 · 패: … · ○○ms" 표시).
6. 남은 데이터 이상 목록은 `data/handtraps-report.md`, `data/validation-report.md`에 있다(현재 handtraps 쪽은 0건).
