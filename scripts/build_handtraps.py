#!/usr/bin/env python3
"""패트랩 대응 데이터(dd-handtraps.json)를 루트별 JS 파일로 쪼갠다.

입력: data/dd-handtraps.json, data/dd-handtraps.md, data/dd-data.json(루트 단계 비교용)
출력:
  data/handtraps/<루트>.js   루트별 레코드(내용은 그대로, 공백만 줄임)
  data/handtraps/meta.js     md 요약(판정 모델·공통 원칙·아픈 지점·한계), 단계별 패트랩 목록, 이상 데이터 목록
  data/handtraps-report.md   이상해 보이는 데이터 목록

실행: python3 scripts/build_handtraps.py   (build_data.py 다음에)
"""

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT_DIR = DATA / "handtraps"


def sections(md):
    out, title, buf = {}, None, []
    for line in md.splitlines():
        m = re.match(r"^## (\d+)\.\s*(.+)$", line)
        if m:
            if title:
                out[title[0]] = {"title": title[1], "markdown": "\n".join(buf).strip()}
            title, buf = (m.group(1), m.group(2).strip()), []
        else:
            buf.append(line)
    if title:
        out[title[0]] = {"title": title[1], "markdown": "\n".join(buf).strip()}
    return out


def bullets(body):
    return [ln[2:].strip() for ln in body.splitlines() if ln.startswith("- ")]


def table_rows(body):
    lines = [ln for ln in body.splitlines() if ln.strip().startswith("|")]
    if len(lines) < 3:
        return []
    head = [c.strip() for c in lines[0].strip().strip("|").split("|")]
    return [dict(zip(head, [c.strip() for c in ln.strip().strip("|").split("|")])) for ln in lines[2:]]


def main():
    records = json.loads((DATA / "dd-handtraps.json").read_text(encoding="utf-8"))
    md = (DATA / "dd-handtraps.md").read_text(encoding="utf-8")
    dd = json.loads((DATA / "dd-data.json").read_text(encoding="utf-8"))
    routes = {r["id"]: r for r in dd["routes"]}
    secs = sections(md)
    issues = []   # 이상해 보이는 데이터
    checks = []

    def check(name, ok, detail=""):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    # ---- 기본 검사
    m = re.search(r"([\d,]+)건", md)
    declared = int(m.group(1).replace(",", "")) if m else None
    check("레코드 수가 md 선언과 같음", declared == len(records), f"md {declared} / json {len(records)}")
    unknown_routes = sorted({x["route"] for x in records} - set(routes))
    check("모든 레코드의 루트가 dd-routes.md에 있음", not unknown_routes, ", ".join(unknown_routes))
    bad_step = [(x["route"], x["step"]) for x in records if x["route"] in routes and not (1 <= x["step"] <= len(routes[x["route"]]["steps"]))]
    check("모든 레코드의 단계 번호가 루트 범위 안", not bad_step, str(bad_step[:5]))
    dup = [k for k, v in Counter((x["route"], x["step"], x["trap"]) for x in records).items() if v > 1]
    check("루트·단계·패트랩 조합 중복 없음", not dup, str(dup[:5]))
    traps = {}
    for x in records:
        traps.setdefault(x["trap"], x["trap_name"])
    model_rows = table_rows(secs.get("2", {}).get("markdown", ""))
    model_keys = {re.search(r"`(\w+)`", r[list(r)[0]]).group(1): r for r in model_rows if re.search(r"`(\w+)`", r[list(r)[0]])}
    check("JSON의 패트랩 키가 md 판정 모델 표에 전부 있음", set(traps) <= set(model_keys), ", ".join(sorted(set(traps) - set(model_keys))))

    per_step = defaultdict(list)
    for x in records:
        per_step[(x["route"], x["step"])].append(x)
    # ---- 단계 문장 비교
    mism = defaultdict(set)
    for x in records:
        r = routes.get(x["route"])
        if r and r["steps"][x["step"] - 1]["text"] != x["step_text"]:
            mism[(x["route"], x["step"])].add(x["step_text"])
    for (rid, n), texts in sorted(mism.items()):
        issues.append(f"{rid} {n}단계: JSON의 step_text가 dd-routes.md와 다름. md는 '{routes[rid]['steps'][n - 1]['text']}', JSON은 '{next(iter(texts))}' "
                      "(md의 '(원문 생략, 보완)' 주석이 빠진 것으로 보임). 화면엔 md 단계 문장을 쓰고 JSON 문장도 같이 보여준다.")

    # ---- 소환 수
    by_route = defaultdict(dict)
    for x in records:
        by_route[x["route"]].setdefault(x["step"], x["summons_so_far"])
    stuck = []
    for rid, steps in by_route.items():
        r = routes[rid]
        for s in r["steps"]:
            k = s["n"]
            if s["isSummon"] and k in steps and (k - 1) in steps and steps[k] == steps[k - 1] and (rid, k) not in mism:
                stuck.append(f"{rid} {k}단계 '{s['text']}'")
    if stuck:
        issues.append("소환 단계인데 summons_so_far가 앞 단계와 같다(그 단계 소환을 안 센 것으로 보임): " + "; ".join(stuck) +
                      ". 니비루 조건에 쓰이는 값이라 표시만 하고 고치지 않았다.")
    multi = sum(1 for rid, steps in by_route.items() for k in steps if (k - 1) in steps and steps[k] - steps[k - 1] > 1)
    issues.append(f"summons_so_far는 한 단계 P소환 여러 장을 장수대로 센다(예: A1 15단계 '코페르·오르트로스 P소환'에서 +2). "
                  f"사이트 단계 목록의 '소환 n번째'(단계 수 기준)와 값이 다를 수 있어, 패트랩 화면에서는 JSON 값을 쓴다. 한 번에 2 이상 늘어나는 곳 {multi}군데.")

    # ---- documented
    doc_and_calc = [x for x in records if "documented" in x and any(k in x for k in ("plan", "with_my_droll", "counter", "if_extra_card_in_hand"))]
    if doc_and_calc:
        c = Counter(x["documented"] for x in doc_and_calc)
        issues.append(f"md 5장은 'documented가 있으면 plan 없음'인데, 조건부 documented {len(doc_and_calc)}건은 계산 결과도 같이 있다: " +
                      ", ".join(f"'{k}' {v}건" for k, v in c.items()) +
                      ". 화면은 문서 루트 링크를 먼저 보여주고, 계산 결과는 '조건이 안 맞을 때'로 아래에 둔다.")
    selfref = sorted({f"{x['route']} {x['step']}단계 {x['trap_name']} → '{x['documented']}'" for x in records
                      if "documented" in x and re.search(rf"(?<![A-Z0-9]){x['route']}(?!\d)", x["documented"])})
    if selfref:
        issues.append("documented가 자기 루트를 가리킨다(이미 그 대응 루트를 진행 중인 경우): " + "; ".join(selfref))
    nib_doc = defaultdict(list)
    for x in records:
        if x["trap"] == "nibiru" and "documented" in x:
            nib_doc[x["route"]].append(x["step"])
    if nib_doc:
        issues.append("니비루 '문서: 5체째 제우스 ②로 무효'가 붙은 단계: " + "; ".join(f"{k} {min(v)}~{max(v)}단계" for k, v in sorted(nib_doc.items())) +
                      ". 그 다음 단계(P소환)부터는 같은 제우스② 무효가 documented가 아니라 계산 결과(counter)로 나온다. 화면은 데이터 그대로 둘 다 보여준다.")

    # ---- 카운터
    cnt_bad = [x for x in records if x["trap"] in ("imperm", "dominus") and "counter" in x]
    check("무한포영·도미나스(함정)에는 counter가 없음(md 2장)", not cnt_bad, str(len(cnt_bad)))
    zeus_left = [f"{x['route']} {x['step']}단계 {x['trap_name']}" for x in records
                 if "counter" in x and "제우스" in x["counter"]["how"] and "plan" in x["counter"]
                 and any(i.startswith("제우스②") for i in x["counter"]["plan"]["final"]["interruptions"])]
    if zeus_left:
        issues.append(f"제우스②로 무효(1턴 1번)한 counter.plan의 결과 필드에 '제우스②'가 다시 방해로 남아 있다: {len(zeus_left)}건 (예: " +
                      "; ".join(zeus_left[:6]) + ").")
    # ---- (무효) 이름
    suffix = Counter()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ("monsters",) and isinstance(v, list):
                    for n in v:
                        if n.endswith("(무효)"):
                            suffix[n] += 1
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(records)
    if suffix:
        issues.append("몬스터 이름에 '(무효)'가 붙은 값이 있다(무한포영·뵐러로 그 턴 효과 무효인 몬스터로 보임): " +
                      ", ".join(f"{k} {v}" for k, v in suffix.most_common()) + ". 그대로 표시한다.")
    # ---- 데이터 없는 단계
    no_data = {}
    for rid, r in routes.items():
        have = set(by_route.get(rid, {}))
        miss = [s["n"] for s in r["steps"] if s["n"] not in have and not s["opponent"]]
        if miss:
            no_data[rid] = miss
    if no_data:
        issues.append("패트랩 레코드가 하나도 없는 단계(상대 행동 단계 제외): " + "; ".join(f"{k} {','.join(map(str, v))}" for k, v in no_data.items()) +
                      ". 화면엔 '이 단계 데이터 없음'으로 나온다.")
    # ---- 판정 모델과 비교: 유령토끼는 앞면 마함(P존) 효과 발동에 걸린다(md 2장)
    ortho = []
    for rid, r in routes.items():
        for st in r["steps"]:
            if "(오르트로스 효과)" in st["text"] and not st["opponent"]:
                if "ogre" not in {x["trap"] for x in per_step.get((rid, st["n"]), [])}:
                    ortho.append(f"{rid} {st['n']}")
    if ortho:
        issues.append("md 2장 판정 모델은 유령토끼가 '앞면 마함(계약서·P존) 효과 발동'에 걸린다고 하는데, 오르트로스 P효과 단계 대부분에 유령토끼 레코드가 없다: "
                      + ", ".join(ortho) + "단계 (추정: 판정에서 빠졌거나, 의도적으로 제외).")
    # ---- md 4장 '가장 아픈 지점' 대조
    hurt = table_rows(secs.get("4", {}).get("markdown", ""))
    idx = {(x["route"], x["step"], x["trap_name"]): x for x in records}
    hurt_bad = []
    for row in hurt:
        rid = row["루트"].split()[0]
        for part in row[list(row)[1]].split("<br>"):
            mm = re.match(r"(\d+)단계 (.+?) ← (.+?): (.+)$", part.strip())
            if not mm:
                hurt_bad.append(f"{rid}: 형식 못 읽음 '{part}'")
                continue
            n, trap, left = int(mm.group(1)), mm.group(3), mm.group(4)
            x = idx.get((rid, n, trap))
            if not x:
                hurt_bad.append(f"{rid} {n}단계 {trap}: JSON에 레코드 없음")
                continue
            mons = x["plan"]["final"]["monsters"] if "plan" in x else None
            want = [] if left == "없음" else [s.strip() for s in left.split(",")]
            if mons is not None and mons != want:
                hurt_bad.append(f"{rid} {n}단계 {trap}: md '{left}' / JSON 결과 {mons}")
    check("md 4장 '가장 아픈 지점'이 JSON 결과(plan.final.monsters)와 같음", not hurt_bad, "; ".join(hurt_bad))
    if hurt_bad:
        issues.append("md 4장과 JSON이 다른 곳: " + "; ".join(hurt_bad))
    ex_steps = [x["step"] for x in records if "if_extra_card_in_hand" in x]
    issues.append(f"if_extra_card_in_hand는 md에 '초반 단계만'이라고 돼 있는데 가장 늦은 단계는 {max(ex_steps)}단계다." if ex_steps and max(ex_steps) > 10 else
                  f"if_extra_card_in_hand가 있는 단계 범위: {min(ex_steps)}~{max(ex_steps)}단계.")

    # ---- 출력
    OUT_DIR.mkdir(exist_ok=True)
    for old in OUT_DIR.glob("*.js"):
        old.unlink()
    per = defaultdict(list)
    for x in records:
        per[x["route"]].append(x)
    step_traps = {}
    for rid, xs in per.items():
        (OUT_DIR / f"{rid}.js").write_text(
            "// 자동 생성: scripts/build_handtraps.py (원본 data/dd-handtraps.json, 내용 그대로)\n"
            f"window.DD_HT=window.DD_HT||{{}};window.DD_HT[{json.dumps(rid)}]=" +
            json.dumps(xs, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
        st = defaultdict(list)
        for x in xs:
            st[x["step"]].append(x["trap"])
        step_traps[rid] = st
    meta = {
        "intro": secs.get("1", {}),
        "model": {"title": secs.get("2", {}).get("title"), "markdown": secs.get("2", {}).get("markdown", "")},
        "principles": {"title": secs.get("3", {}).get("title"), "bullets": bullets(secs.get("3", {}).get("markdown", ""))},
        "hurt": {"title": secs.get("4", {}).get("title"), "markdown": secs.get("4", {}).get("markdown", "")},
        "limits": {"title": secs.get("6", {}).get("title"), "bullets": bullets(secs.get("6", {}).get("markdown", ""))},
        "lowerBound": next((b for b in bullets(secs.get("1", {}).get("markdown", "")) if "하한" in b), ""),
        "traps": traps,
        "stepTraps": step_traps,
        "counts": {k: len(v) for k, v in per.items()},
        "total": len(records),
        "issues": issues,
        "checks": checks,
    }
    (OUT_DIR / "meta.js").write_text("// 자동 생성: scripts/build_handtraps.py\nwindow.DD_HT_META=" +
                                     json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    lines = ["# 패트랩 데이터 검사", "", "## 검사", ""] + \
        [f"- {'✅' if c['ok'] else '❌'} {c['name']}" + (f" — {c['detail']}" if c["detail"] else "") for c in checks] + \
        ["", "## 이상해 보이는 데이터 (고치지 않고 표시만)", ""] + [f"- {i}" for i in issues]
    (DATA / "handtraps-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT_DIR.glob("*.js"))
    print(f"레코드 {len(records)}건 → 루트 파일 {len(per)}개 ({size // 1024} KB)")
    for c in checks:
        print(("  OK   " if c["ok"] else "  FAIL ") + c["name"] + (f" — {c['detail']}" if c["detail"] else ""))
    print("이상해 보이는 데이터:")
    for i in issues:
        print("  - " + i)
    return 1 if any(not c["ok"] for c in checks) else 0


if __name__ == "__main__":
    raise SystemExit(main())
