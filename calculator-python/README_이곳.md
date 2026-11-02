# 원본 Python 계산기 (사용자가 올린 calculator.zip 그대로)

- 이 폴더의 코드는 사이트의 `assets/calc/engine.js`가 옮겨 온 원본이다. 수정하지 않았다(PORTING.md는 사용자가 나중에 덮어쓴 정정본).
- **동점 규칙 고정**: 원본은 `sorted(set(...))` 때문에 동점에서 실행마다 결과가 달라진다. 고정 패치는 `../tests/fixtures/python-pinned.patch` (이 폴더 기준 `patch -p1 < ../tests/fixtures/python-pinned.patch`로 engine.py에 적용).
- 실행: `PYTHONHASHSEED=0 python3 -s -P ...` 형태로 쓰고, import는 이 폴더에서 (`import engine as E, hits as H`). fixtures는 `fixtures/`.
- 원본 전체 fixtures를 돌리면 약 10분 걸린다.
