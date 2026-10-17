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
    info = []     # 참고(이상은 아님)
    checks = []

    def check(name, ok, detail=""):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    # ---- 기본 검사
    m = re.search(r"([\d,]+)건", md)
    declared = int(m.group(1).replace(",", "")) if m else None
    if declared != len(records):
        issues.append(f"md 머리말은 '전체 데이터 {declared:,}건'인데 JSON은 {len(records):,}건이다(차이 {len(records) - declared:+d}건).")
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
    # ---- 단계 문장 비교(2차부터 dd-routes.md 원문과 같아야 함)
    mism = defaultdict(set)
    for x in records:
        r = routes.get(x["route"])
        if r and r["steps"][x["step"] - 1]["text"] != x["step_text"]:
            mism[(x["route"], x["step"])].add(x["step_text"])
    check("step_text가 dd-routes.md 원문과 같음", not mism,
          "; ".join(f"{rid} {n}단계 '{next(iter(t))}'" for (rid, n), t in sorted(mism.items())))

    # ---- 소환 수(monsters_summoned_so_far, 장수 기준)
    SC = "monsters_summoned_so_far"
    check(f"모든 레코드에 {SC} 있음", all(SC in x for x in records))
    by_route = defaultdict(dict)
    for x in records:
        if SC in x:
            by_route[x["route"]].setdefault(x["step"], x[SC])
    stuck, down = [], []
    for rid, steps in by_route.items():
        r = routes[rid]
        for s in r["steps"]:
            k = s["n"]
            if k in steps and (k - 1) in steps:
                if s["isSummon"] and steps[k] == steps[k - 1]:
                    stuck.append(f"{rid} {k}단계 '{s['text']}'")
                if steps[k] < steps[k - 1]:
                    down.append(f"{rid} {k}단계")
    check("소환 수가 단계를 지나며 줄어들지 않음", not down, "; ".join(down))
    if stuck:
        issues.append(f"소환 단계인데 {SC}가 앞 단계와 같다: " + "; ".join(stuck) + ".")

    # ---- documented
    def is_cond(t):
        return "있으면" in t
    selfre = re.compile(r"^이 루트\(([A-G]\d+)\) 자체가")
    calc_keys = ("plan", "with_my_droll", "counter", "if_extra_card_in_hand")
    uncond_calc = [f"{x['route']} {x['step']}단계 {x['trap_name']} '{x['documented']}' ({','.join(k for k in calc_keys if k in x)})"
                   for x in records if "documented" in x and not is_cond(x["documented"]) and any(k in x for k in calc_keys)]
    if uncond_calc:
        issues.append("md 5장은 '무조건 적용이면 plan 없음'인데, 조건 없는 documented에 계산 결과가 같이 있다: " + "; ".join(uncond_calc) +
                      ". 화면은 문서 표시를 먼저 두고 계산 결과를 아래에 참고로 보여준다.")
    cond_nocalc = [f"{x['route']} {x['step']}단계 {x['trap_name']}" for x in records
                   if "documented" in x and is_cond(x["documented"]) and not any(k in x for k in calc_keys)]
    check("조건부 documented에는 조건이 안 맞을 때 쓸 계산 결과가 있음(md 5장)", not cond_nocalc, "; ".join(cond_nocalc))
    self_wrong = [f"{x['route']} {x['step']}단계 '{x['documented']}'" for x in records
                  if "documented" in x and selfre.match(x["documented"]) and selfre.match(x["documented"]).group(1) != x["route"]]
    check("'이 루트(X) 자체가…'의 X가 그 레코드의 루트와 같음", not self_wrong, "; ".join(self_wrong))
    self_plain = [f"{x['route']} {x['step']}단계 '{x['documented']}'" for x in records
                  if "documented" in x and not selfre.match(x["documented"])
                  and re.search(rf"(?<![A-Z0-9]){x['route']}(?!\d)", x["documented"])]
    check("자기 루트를 가리키는 documented는 '이 루트(X) 자체가…' 형식", not self_plain, "; ".join(self_plain))
    bad_ids = sorted({i for x in records if "documented" in x for i in re.findall(r"[A-G]\d{1,2}", x["documented"]) if i not in routes})
    check("documented가 가리키는 루트 ID가 전부 있음", not bad_ids, ", ".join(bad_ids))
    nib_doc = defaultdict(list)
    for x in records:
        if x["trap"] == "nibiru" and "documented" in x:
            nib_doc[x["route"]].append(x["step"])
    nib_bad = []
    for rid, sts in sorted(nib_doc.items()):
        five = sorted(k for k, v in by_route[rid].items() if v == 5)
        if sorted(sts) != five:
            nib_bad.append(f"{rid} documented {sorted(sts)} / 소환 5장인 단계 {five}")
    check("니비루 '문서: 5체째 제우스 ②로 무효'는 소환 수가 5장인 단계(5체째 직후)에만 붙음", not nib_bad, "; ".join(nib_bad))
    if nib_doc:
        info.append("니비루 documented 단계: " + "; ".join(f"{k} {min(v)}~{max(v)}" for k, v in sorted(nib_doc.items())) +
                    ". 6장째 소환 이후는 같은 무효가 counter로 계산돼 있다(md 5장 설명과 같음).")

    # ---- 카운터
    cnt_bad = [x for x in records if x["trap"] in ("imperm", "dominus") and "counter" in x]
    check("무한포영·도미나스(함정)에는 counter가 없음(md 2장)", not cnt_bad, str(len(cnt_bad)))
    zeus_left = [f"{x['route']} {x['step']}단계 {x['trap_name']}" for x in records
                 if "counter" in x and "제우스" in x["counter"]["how"] and "plan" in x["counter"]
                 and any(i.startswith("제우스②") for i in x["counter"]["plan"]["final"]["interruptions"])]
    if zeus_left:
        issues.append(f"제우스②로 무효(1턴 1번)한 counter.plan의 결과 필드에 '제우스②'가 다시 방해로 남아 있다: {len(zeus_left)}건 (예: " +
                      "; ".join(zeus_left[:6]) + ").")

    # ---- negated_monsters
    suffix, notsub, missing_nm = Counter(), [], 0

    def fields(x):
        yield "state_at_hit", x["state_at_hit"]
        for name, pl in (("plan", x.get("plan")), ("counter.plan", (x.get("counter") or {}).get("plan"))):
            if pl:
                yield name, pl["final"]
        for i, e in enumerate(x.get("if_extra_card_in_hand", [])):
            yield f"if_extra[{i}]", e["plan"]["final"]
        for i, w in enumerate(x.get("with_my_droll", [])):
            yield f"with_my_droll[{i}]", w["plan"]["final"]
    for x in records:
        for where, f in fields(x):
            for n in f.get("monsters", []):
                if n.endswith("(무효)"):
                    suffix[n] += 1
            if "negated_monsters" not in f:
                missing_nm += 1
            elif not set(f["negated_monsters"]) <= set(f.get("monsters", [])):
                notsub.append(f"{x['route']} {x['step']}단계 {x['trap_name']} {where}: {f['negated_monsters']} / 몬스터 {f.get('monsters')}")
    check("몬스터 이름에 '(무효)'가 남아 있지 않음", not suffix, ", ".join(f"{k} {v}" for k, v in suffix.items()))
    check("state_at_hit·final 모두 negated_monsters 있음", missing_nm == 0, f"없는 곳 {missing_nm}")
    check("negated_monsters가 그 필드의 monsters 안에 있음", not notsub, "; ".join(notsub[:5]) + (f" 외 {len(notsub) - 5}건" if len(notsub) > 5 else ""))

    # ---- 판정 모델과 비교: 유령토끼는 앞면 마함(P존) 효과 발동에 걸린다(md 2장)
    ortho = []
    for rid, r in routes.items():
        for st in r["steps"]:
            if "(오르트로스 효과)" in st["text"] and not st["opponent"]:
                if "ogre" not in {x["trap"] for x in per_step.get((rid, st["n"]), [])}:
                    ortho.append(f"{rid} {st['n']}")
    check("오르트로스 P효과 단계마다 유령토끼 레코드 있음(md 2장)", not ortho, ", ".join(ortho))

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

    # ---- if_extra_card_in_hand: md 5장 '제우스가 처음 나오기 전 단계까지'
    late = []
    for x in records:
        if "if_extra_card_in_hand" in x:
            zs = routes[x["route"]].get("zeusStep")
            if zs is not None and x["step"] >= zs:
                late.append(f"{x['route']} {x['step']}단계(제우스 {zs}단계)")
    check("if_extra_card_in_hand는 제우스가 처음 나오기 전 단계에만 있음(md 5장)", not late, "; ".join(sorted(set(late))[:10]))

    # ---- 참고: 데이터 없는 단계
    no_data = {}
    for rid, r in routes.items():
        have = {k for (rr, k) in per_step if rr == rid}
        miss = [s["n"] for s in r["steps"] if s["n"] not in have and not s["opponent"]]
        if miss:
            no_data[rid] = miss
    info.append("패트랩 레코드가 하나도 없는 단계(상대 행동 단계 제외, 화면엔 '데이터 없음'): " +
                "; ".join(f"{k} {','.join(map(str, v))}" for k, v in no_data.items()))

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
        "info": info,
        "checks": checks,
    }
    (OUT_DIR / "meta.js").write_text("// 자동 생성: scripts/build_handtraps.py\nwindow.DD_HT_META=" +
                                     json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    lines = ["# 패트랩 데이터 검사", "", "## 검사", ""] + \
        [f"- {'✅' if c['ok'] else '❌'} {c['name']}" + (f" — {c['detail']}" if c["detail"] else "") for c in checks] + \
        ["", "## 이상해 보이는 데이터 (고치지 않고 표시만)", ""] + ([f"- {i}" for i in issues] or ["- 없음"]) + \
        ["", "## 참고", ""] + [f"- {i}" for i in info]
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
