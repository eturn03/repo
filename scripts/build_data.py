#!/usr/bin/env python3
"""DD 전개 도우미 데이터 생성기.

data/dd-guide.md, data/dd-routes.md, data/app-config.json 을 읽어
data/dd-data.json 과 data/dd-data.js(브라우저용) 를 만든다.
파싱이 끝나면 자동 검사를 돌리고 결과를 화면과 data/validation-report.md 에 남긴다.

실행: python3 scripts/build_data.py   (Windows: py scripts\\build_data.py)
외부 패키지 없이 파이썬 표준 라이브러리만 쓴다.
"""

import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GUIDE_MD = DATA / "dd-guide.md"
ROUTES_MD = DATA / "dd-routes.md"
CONFIG = DATA / "app-config.json"
OUT_JSON = DATA / "dd-data.json"
OUT_JS = DATA / "dd-data.js"
OUT_REPORT = DATA / "validation-report.md"

MARKER_RE = re.compile(r"추정|해석|미검증|미확인|원문 생략|보완|생략")
ROUTE_ID_RE = re.compile(r"\b([A-G])(\d+)\b")

# 단계 문장에서 카드명을 지운 뒤 남아도 되는 일반 낱말(카드가 아닌 것).
# 여기에 없는 낱말이 남으면 "덱 리스트에 없는 카드일 수 있음"으로 보고한다.
STEP_VOCAB = set("""
일반소환 특소 서치 효과 링크 엑시즈 융합 싱크로 P소환 P존 세팅 재발동 놓기 회수 묘지로 파괴 자괴 후
바운스 패로 되돌림 소생 제외 코스트 상대 자신 데미지 레벨 4로 추가 P소환권 위 겹침 발동 무효 내
원문 생략 보완 다음 P소환에 2장이 필요 표기는 문맥상 파괴로 추정 이 턴 덱→패 불가 증G로 1장 드로우한
직후 이후 드로우 봉쇄 필드에 남음 원본 로그엔 표기 P존에 하려면 1·4를 0과 9가 필요 상대가 의 은 는
덱 패 단계에서 4를 로 P소환하려면
""".split())


def load_md(path):
    text = path.read_text(encoding="utf-8")
    text = html.unescape(text)
    return text.replace("\\]", "]").replace("\\[", "[")


def split_sections(text, prefix):
    """prefix('## ' 등)로 시작하는 제목 단위로 나눈다. 첫 제목 앞 내용은 title=None."""
    sections, title, buf = [], None, []
    for line in text.splitlines():
        if line.startswith(prefix) and not line.startswith(prefix + "#"):
            sections.append((title, "\n".join(buf).strip("\n")))
            title, buf = line[len(prefix):].strip(), []
        else:
            buf.append(line)
    sections.append((title, "\n".join(buf).strip("\n")))
    return sections


def split_cells(line):
    cells = line.strip().strip("|").split("|")
    return [c.strip() for c in cells]


def parse_tables(body):
    """본문 안의 마크다운 표를 모두 찾는다. 각 표 바로 앞의 굵은 제목(**...**)도 같이 붙인다."""
    tables, lines, i, last_bold = [], body.splitlines(), 0, None
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^\*\*(.+?)\*\*\s*$", line.strip())
        if m:
            last_bold = m.group(1)
        if line.strip().startswith("|") and i + 1 < len(lines) and re.match(r"^\|\s*-", lines[i + 1].strip()):
            header = split_cells(line)
            rows, j = [], i + 2
            while j < len(lines) and lines[j].strip().startswith("|"):
                cells = split_cells(lines[j])
                rows.append(dict(zip(header, cells + [""] * (len(header) - len(cells)))))
                j += 1
            tables.append({"heading": last_bold, "header": header, "rows": rows})
            i = j
            continue
        i += 1
    return tables


def bullets(body):
    return [ln[2:].strip() for ln in body.splitlines() if ln.startswith("- ")]


def paragraphs(body):
    out, buf = [], []
    for ln in body.splitlines():
        if not ln.strip():
            if buf:
                out.append(" ".join(buf))
                buf = []
        else:
            buf.append(ln.strip())
    if buf:
        out.append(" ".join(buf))
    return out


class Ctx:
    def __init__(self, config):
        self.config = config
        self.warnings = []   # 문서끼리 어긋나거나 애매한 곳(자동 검출)
        self.checks = []     # (이름, 통과여부, 설명)
        self.alias_to_card = {}
        for full, shorts in config["cardAliases"].items():
            self.alias_to_card[full] = full
            for s in shorts:
                self.alias_to_card[s] = full
        self.alias_sorted = sorted(self.alias_to_card, key=len, reverse=True)

    def check(self, name, ok, detail=""):
        self.checks.append({"name": name, "ok": bool(ok), "detail": detail})

    def warn(self, text):
        if text not in self.warnings:
            self.warnings.append(text)

    def resolve(self, name):
        name = name.strip()
        return self.alias_to_card.get(name)

    def find_cards(self, text):
        """문장 속 카드 언급을 긴 이름부터 찾는다. (카드목록, 카드명을 지운 나머지 문장) 반환."""
        found, rest = [], text
        for alias in self.alias_sorted:
            if alias in rest:
                card = self.alias_to_card[alias]
                if card not in found:
                    found.append(card)
                rest = rest.replace(alias, " ")
        return found, rest

    def ids_in(self, text, all_ids, groups=False):
        """문장에서 루트 ID를 뽑는다. 'C1~C4' 범위와, groups=True면 'B'·'B계열' 같은 그룹 전체도 펼친다."""
        out = []

        def add(i):
            if i in all_ids and i not in out:
                out.append(i)

        def expand_token(tok):
            m = re.fullmatch(r"([A-G])(\d+)\s*[~–]\s*([A-G])?(\d+)", tok)
            if m:
                g = m.group(1)
                for k in range(int(m.group(2)), int(m.group(4)) + 1):
                    add(f"{g}{k}")
                return
            if re.fullmatch(r"[A-G]\d+", tok):
                add(tok)
                return
            if groups and re.fullmatch(r"[A-G]", tok):
                for i in sorted(all_ids, key=route_sort_key):
                    if i[0] == tok:
                        add(i)

        tok_re = r"[A-G]\d*(?:\s*[~–]\s*[A-G]?\d+)?"
        for m in re.finditer(rf"(?<![A-Za-z0-9]){tok_re}(?:·{tok_re})*(?![A-Za-z0-9])", text):
            parts = m.group(0).split("·")
            if len(parts) == 1 and re.fullmatch(r"[A-G]", parts[0]):
                # 홀로 선 글자 하나: 'B계열'일 때만 그룹으로 본다.
                after = text[m.end():m.end() + 2]
                if groups and after == "계열":
                    expand_token(parts[0])
                continue
            for p in parts:
                expand_token(p.strip())
        return out


def route_sort_key(i):
    return (i[0], int(i[1:]))


# ---------------------------------------------------------------- 루트 파일

def parse_routes(ctx, text):
    sections = split_sections(text, "## ")
    intro_title, intro_body = None, ""
    groups, routes = [], []
    head = sections[0]
    intro_body = head[1]
    title_line = re.match(r"^#\s+(.+)$", intro_body.strip().splitlines()[0])
    for gtitle, gbody in sections[1:]:
        gm = re.match(r"^([A-G])\.\s*(.+)$", gtitle)
        if not gm:
            ctx.warn(f"루트 파일: 그룹 제목 형식이 아님 → '{gtitle}'")
            continue
        gid = gm.group(1)
        gname = gm.group(2)
        header_final = None
        fm = re.search(r"—\s*최종:\s*(.+)$", gname)
        if fm:
            header_final = fm.group(1).strip()
            gname = gname[:fm.start()].strip()
        group = {"id": gid, "title": gname, "headerFinal": header_final, "routeIds": []}
        for rtitle, rbody in split_sections(gbody, "### ")[1:]:
            route = parse_route(ctx, rtitle, rbody, group)
            if route:
                routes.append(route)
                group["routeIds"].append(route["id"])
        groups.append(group)
    intro_lines = intro_body.splitlines()
    intro_md = "\n".join(intro_lines[1:]).strip() if title_line else intro_body
    return {"title": title_line.group(1) if title_line else "", "introMarkdown": intro_md,
            "groups": groups, "routes": routes}


def parse_route(ctx, rtitle, rbody, group):
    m = re.match(r"^([A-G]\d+)\.\s*(.+)$", rtitle)
    if not m:
        ctx.warn(f"루트 파일: 루트 제목 형식이 아님 → '{rtitle}'")
        return None
    rid, name = m.group(1), m.group(2).strip()
    route = {"id": rid, "group": group["id"], "name": name, "steps": [], "notes": [],
             "finalText": "", "finalCards": [], "finalExtra": [], "finalNote": "",
             "source": None}
    numbers = []
    for line in rbody.splitlines():
        s = line.strip()
        if s.startswith("최종:"):
            fm = re.match(r"^최종:\s*(.+?)\s*·\s*출처:\s*\[(.+?)\]\((.+?)\)\s*$", s)
            if fm:
                route["finalText"] = fm.group(1)
                route["source"] = {"label": fm.group(2), "url": fm.group(3)}
            else:
                route["finalText"] = s[3:].strip()
                ctx.warn(f"{rid}: '최종 · 출처' 줄 형식이 예상과 다름 → '{s}'")
            continue
        sm = re.match(r"^(\d+)\.\s+(.+)$", s)
        if sm:
            n, t = int(sm.group(1)), sm.group(2).strip()
            numbers.append(n)
            route["steps"].append(make_step(ctx, rid, n, t))
        elif s:
            ctx.warn(f"{rid}: 단계/최종 줄이 아닌 내용 → '{s}'")
    route["_numbers"] = numbers
    # 이니시 카드(필요한 패): 루트 이름의 첫 부분
    init_text = re.split(r"\s+[·→]\s+", name)[0]
    init_text_clean = re.sub(r"\s*\(.*?\)\s*", "", init_text).strip()
    parts = [p.strip() for p in init_text_clean.split("+")]
    init_cards = []
    for p in parts:
        card = ctx.resolve(p)
        if not card:
            p2 = re.sub(r"\s*\d+장$", "", p)
            card = ctx.resolve(p2)
            if card:
                ctx.warn(f"{rid}: 이름 '{name}'의 '{p}'에서 '장수' 표기를 떼고 '{p2}'로 읽음. "
                         f"'제로 마키나 + 지옥문 2장'은 '2장 조합(제로 마키나 1 + 지옥문 1)'으로 해석했다 "
                         f"(가이드 2장 조합 표 '제로 마키나 + 지옥문', 대응 표 '패에 지옥문이 더 있으면').")
        if card:
            init_cards.append(card)
        else:
            ctx.warn(f"{rid}: 이름에서 이니시 카드를 못 읽음 → '{p}'")
    route["initiatorText"] = init_text
    route["initiator"] = init_cards
    required = [{"card": c, "reason": "루트 이름의 시작 카드"} for c in init_cards]
    for st in route["steps"]:
        if not st["opponent"]:
            mm = re.match(r"^내\s+(\S+)\s+발동", st["text"])
            if mm:
                card = ctx.resolve(mm.group(1))
                if card and all(r["card"] != card for r in required):
                    required.append({"card": card, "reason": f"{st['n']}단계 '{st['text']}'"})
    route["requiredHand"] = required
    # 최종 필드
    parse_final(ctx, route, group)
    return route


def make_step(ctx, rid, n, t):
    opponent = t.startswith("[상대]")
    body = t[len("[상대]"):].strip() if opponent else t
    cards, rest = ctx.find_cards(body)
    opp_cards = []
    for oc in ctx.config["opponentOnlyCards"]:
        if oc in rest:
            opp_cards.append(oc)
            rest = rest.replace(oc, " ")
    # 남은 낱말 검사
    rest = re.sub(r"[()（）:,.+·→①②\[\]\"“”]", " ", rest)
    leftovers = [w for w in rest.split() if w not in STEP_VOCAB and not re.fullmatch(r"[\d+\-]+", w)]
    is_summon = False
    # '(원문 생략, 보완: 다음 P소환에 …)' 같은 주석 속 낱말은 소환으로 세지 않는다
    body_core = re.sub(r"\([^()]*(?:원문 생략|보완)[^()]*\)", "", body)
    if not opponent:
        if re.search(r"일반소환|특소|링크|엑시즈|융합|싱크로|소생|P소환(?!권)", body_core):
            is_summon = True
        else:
            ex_alias = [a for a, c in ctx.alias_to_card.items() if c in ctx.ex_cards]
            for a in sorted(ex_alias, key=len, reverse=True):
                if re.match(re.escape(a) + r"[①②]?\(", body):
                    is_summon = True
                    break
    markers = sorted(set(MARKER_RE.findall(t)))
    return {"n": n, "text": t, "opponent": opponent, "cards": cards, "opponentCards": opp_cards,
            "isSummon": is_summon, "markers": markers, "_leftovers": leftovers}


def parse_final(ctx, route, group):
    ft = route["finalText"]
    main, *extra = [x.strip() for x in ft.split(",")]
    cards, notes = [], []

    def add_cards_from(seg):
        seg = re.sub(r"^\d+왕:\s*", "", seg)
        seg = seg.replace("(표)", "")
        seg_note = re.findall(r"\(([^)]*)\)", seg)
        seg = re.sub(r"\([^)]*\)", "", seg)
        ok = True
        for tok in re.split(r"[+·]", seg):
            tok = tok.strip()
            if not tok:
                continue
            if tok in ctx.config["groupWords"]:
                cards.extend(ctx.config["groupWords"][tok])
            else:
                c = ctx.resolve(tok)
                if c:
                    cards.append(c)
                else:
                    ok = False
        notes.extend(seg_note)
        return ok

    if not add_cards_from(main):
        ctx.warn(f"{route['id']}: 최종 필드 '{main}'에서 카드명을 다 못 읽음")
    for e in extra:
        probe = re.sub(r"\(표\)", "", e).strip()
        if all(ctx.resolve(t.strip()) for t in re.split(r"[+·]", probe) if t.strip()):
            add_cards_from(e)
            ctx.warn(f"{route['id']}: 최종 '{ft}'의 쉼표 뒤 '{e}'를 카드로 읽음(A2·A7은 쉼표 뒤가 설명문이라 형식이 섞여 있음)")
        else:
            notes.append(e)
    route["finalCards"] = cards
    route["finalNote"] = " / ".join(notes)
    if group["headerFinal"] and "엑덱 제로 마키나" in group["headerFinal"]:
        route["finalExtra"].append({"card": "DDD 영사왕 제로 마키나", "zone": "엑덱 앞면",
                                    "from": f"그룹 {group['id']} 제목: '최종: {group['headerFinal']}'"})


# ---------------------------------------------------------------- 가이드 파일

def parse_guide(ctx, text, all_ids):
    secs = split_sections(text, "## ")
    head_title, head_body = secs[0]
    first = head_body.strip().splitlines()
    guide = {"title": re.sub(r"^#\s*", "", first[0]) if first else "",
             "date": first[-1].strip() if len(first) > 1 else "", "sections": []}
    by = {}
    for title, body in secs[1:]:
        guide["sections"].append({"title": title, "markdown": body})
        by[title] = body
    ctx.sections = by

    def need(title):
        if title not in by:
            ctx.check(f"가이드 섹션 '{title}' 존재", False, "섹션이 없음")
            return ""
        return by[title]

    out = {}

    # 덱 리스트
    body = need("덱 리스트")
    deck_intro = paragraphs(body)[0] if body else ""
    cards = []
    t = parse_tables(body)[0]
    for r in t["rows"]:
        cat = r["구분"]
        name = r["카드명 (한글판)"]
        cards.append({
            "name": name, "count": int(r["장수"]), "category": cat,
            "zone": "EX" if cat == "EX" else "메인", "note": r["비고"],
            "short": ctx.config["cardAliases"].get(name, [name])[0],
            "isMonster": cat == "몬스터",
            "isDD": cat == "몬스터" and name.startswith("DD"),
            "isInitiator": name in ctx.config["initiatorCards"],
        })
    out["deckIntro"] = deck_intro
    out["cards"] = cards

    # 카드 효과 요약
    body = need("핵심 카드 효과 요약")
    effects = []
    for r in parse_tables(body)[0]["rows"]:
        raw = r["카드"]
        name = re.sub(r"\s*\(P\d+\)\s*$", "", raw)
        pm = re.search(r"\(P(\d+)\)", raw)
        effects.append({"card": name, "raw": raw, "scale": int(pm.group(1)) if pm else None,
                        "role": r["이 덱에서 하는 일"], "effect": r["효과 요약 (1턴 제약)"]})
    out["cardEffects"] = effects
    out["cardEffectsIntro"] = paragraphs(body)[0]

    # 이니시별 1장
    body = need("이니시별 1장 전개")
    init_rows = []
    tbl = parse_tables(body)[0]
    for r in tbl["rows"]:
        card = ctx.resolve(r["패의 이니시"])
        init_rows.append({
            "initiatorText": r["패의 이니시"], "initiator": card,
            "default": {"text": r["기본: 5체째 제우스"], "ids": ctx.ids_in(r["기본: 5체째 제우스"], all_ids)},
            "solomon": {"text": r["유발 많이 예상: 솔로몬 선출"], "ids": ctx.ids_in(r["유발 많이 예상: 솔로몬 선출"], all_ids)},
            "thomas": {"text": r["토마스를 패에 잡음"], "ids": ctx.ids_in(r["토마스를 패에 잡음"], all_ids)},
            "start": r["시작 동작"],
        })
    out["initiatorTable"] = {"header": tbl["header"], "rows": init_rows,
                             "bullets": bullets(body), "paragraphs": paragraphs(body)}

    # 2장 이상 조합
    body = need("2장 이상 조합")
    combos = []
    for r in parse_tables(body)[0]["rows"]:
        combos.append({"combo": r["조합"], "action": r["하는 일"], "basis": r["근거"],
                       "ids": ctx.ids_in(r["하는 일"], all_ids),
                       "requires": parse_requires(ctx, r["조합"], "2장 조합 표")})
    out["combos"] = {"rows": combos, "paragraphs": paragraphs(body)}

    # 패 → 루트 조회표
    body = need("패 → 루트 빠른 조회표")
    tables = parse_tables(body)
    lk = {"paragraphs": paragraphs(body)}
    for tb in tables:
        h = tb["heading"] or ""
        if h.startswith("1단계"):
            lk["step1"] = {"heading": h, "rows": [
                {"hand": r["패"], "routes": r["루트"], "ids": ctx.ids_in(r["루트"], all_ids),
                 "cards": [ctx.resolve(x) for x in r["패"].split("+")]} for r in tb["rows"]]}
        elif h.startswith("2단계"):
            lk["step2"] = {"heading": h, "rows": [parse_conversion(ctx, r) for r in tb["rows"]]}
        elif h.startswith("3단계"):
            rows = []
            for r in tb["rows"]:
                rows.append({"card": ctx.resolve(r["패에 잡힌 카드"]), "cardText": r["패에 잡힌 카드"],
                             "effect": r["영향"], "response": r["대응"],
                             "blockedIds": ctx.ids_in(r["영향"], all_ids, groups=True),
                             "alternativeIds": ctx.ids_in(r["대응"], all_ids, groups=True)})
            lk["step3"] = {"heading": h, "rows": rows}
    # 4단계 문단
    m = re.search(r"\*\*4단계: (.+?)\*\*\s*\n\n(.+?)(?:\n\n|$)", body, re.S)
    lk["step4"] = {"heading": "4단계: " + m.group(1), "text": m.group(2).strip()} if m else None
    for k in ("step1", "step2", "step3", "step4"):
        ctx.check(f"조회표 {k} 파싱", lk.get(k), "" if lk.get(k) else "표/문단을 못 찾음")
    out["lookup"] = lk

    # 최종 필드
    body = need("최종 필드와 방해 수")
    ff = []
    for r in parse_tables(body)[0]["rows"]:
        name = r["카드"]
        zone = None
        card = ctx.resolve(name)
        if not card and name.startswith("엑덱 앞면 "):
            card = ctx.resolve(name.replace("엑덱 앞면 ", ""))
            zone = "엑덱 앞면"
        if not card:
            card = ctx.resolve(re.sub(r"\(.*?\)", "", name))
        ff.append({"label": name, "card": card, "zone": zone, "blocks": r["막는 것"], "cost": r["비용·제약"]})
    paras = paragraphs(body)
    out["finalField"] = {"rows": ff, "intro": paras[0] if paras else "", "notes": paras[2:] if len(paras) > 2 else paras[1:]}

    # 패트랩 대응
    body = need("패트랩 맞았을 때 대응")
    rows = []
    for r in parse_tables(body)[0]["rows"]:
        rows.append({"action": r["상대 행동"], "timing": r["맞는 지점"], "response": r["대응 루트"],
                     "final": r["최종"], "ids": ctx.ids_in(r["대응 루트"], all_ids)})
    out["handTrap"] = {"intro": paragraphs(body)[0], "rows": rows, "bullets": bullets(body)}

    # 검증 결과
    body = need("검증 결과 (2026-10-17)") or next((b for t, b in by.items() if t and t.startswith("검증 결과")), "")
    vt = parse_tables(body)
    out["verification"] = {"title": next((t for t in by if t and t.startswith("검증 결과")), "검증 결과"),
                           "table": vt[0]["rows"] if vt else [], "markdown": body}
    # 데스마키나-링크 목록, 원문 누락 보완, 남은 미검증
    dm = re.search(r"(\d+)개 루트\(([^)]+)\)가 후반에 데스마키나를 빌가메스", body)
    out["verification"]["deathOnLink"] = {
        "declaredCount": int(dm.group(1)) if dm else None,
        "ids": ctx.ids_in(dm.group(2), all_ids) if dm else []}
    jm = re.search(r"\*\*데스마키나를 링크 위에 겹치는 문제\*\*(.+?)(?:\n\*\*|$)", body, re.S)
    judge = [b for b in bullets(jm.group(1))] if jm else []
    out["verification"]["deathOnLinkBullets"] = judge
    sup = re.search(r"\*\*원문 누락 보완\*\*.*?\n\n(.+?)(?:\n\n\*\*|$)", body, re.S)
    out["verification"]["supplements"] = bullets(sup.group(1)) if sup else []
    um = re.search(r"\*\*남은 미검증\*\*:\s*(.+)", body)
    out["verification"]["remaining"] = um.group(1).strip() if um else ""
    out["verification"]["layoutUnverifiedIds"] = []
    for r in out["verification"]["table"]:
        if "미검증" in r.get("결과", ""):
            out["verification"]["layoutUnverifiedIds"] = ctx.ids_in(r["결과"], all_ids)
    rm = re.search(r"\*\*규칙 메모\*\*.*?\n\n(.+?)(?:\n\n\*\*|$)", body, re.S)
    out["verification"]["ruleMemo"] = bullets(rm.group(1)) if rm else []

    # 출처
    body = need("출처")
    srcs = []
    for b in bullets(body):
        m2 = re.match(r"^\[(.+?)\]\((.+?)\)\s*(?:—\s*(.+))?$", b)
        if m2:
            srcs.append({"label": m2.group(1), "url": m2.group(2), "note": m2.group(3) or ""})
    out["sources"] = {"intro": paragraphs(body)[0], "links": srcs}

    # 기본 원리: 루트 이름 읽는 법
    body = need("기본 원리")
    nm = re.search(r"\*\*루트 이름 읽는 법\*\*\s*\n\n(.+?)(?:\n\n\*\*|$)", body, re.S)
    out["nameGuide"] = bullets(nm.group(1)) if nm else []
    cm = re.search(r"\*\*소환 제약 체크\*\*\s*\n\n(.+?)(?:\n\n\*\*|$)", body, re.S)
    out["summonLimits"] = bullets(cm.group(1)) if cm else []
    sm = re.search(r"\*\*1장뿐인 부품\*\*:\s*(.+)", body)
    out["singletons"] = sm.group(1).strip() if sm else ""
    out["guide"] = guide
    return out


def parse_requires(ctx, hand, where):
    """'스몰 월드 + 우라라·후와로스 중 1장' 같은 패 조건을 카드 조건 목록으로 바꾼다."""
    if hand.startswith("이니시 ") and "장 이상" in hand:
        m = re.search(r"(\d+)장 이상", hand)
        return [{"kind": "initiatorCount", "min": int(m.group(1))}]
    req = []
    for p in [x.strip() for x in hand.split("+")]:
        if p.startswith("아무 카드"):
            req.append({"kind": "any"})
        elif p.startswith("다른 DD 몬스터"):
            req.append({"kind": "otherDD"})
        else:
            names = [x.strip() for x in re.sub(r"\s*중 1장$", "", p).split("·")]
            names = [re.sub(r"\(패\)$", "", n) for n in names]
            cards = [ctx.resolve(n) for n in names]
            if None in cards:
                ctx.warn(f"{where}: '{p}'의 카드명을 다 못 읽음")
            req.append({"kind": "anyOf", "cards": [c for c in cards if c]})
    return req


def parse_conversion(ctx, r):
    hand = r["패"]
    req = parse_requires(ctx, hand, "조회표 2단계")
    bridge = None
    bm = re.search(r"다리\s+(\S+)", r["변환"])
    if bm:
        bridge = ctx.resolve(bm.group(1))
    result = r["결과"]
    rm = re.match(r"^(.+?) 루트$", result)
    result_cards = [ctx.resolve(rm.group(1))] if rm and ctx.resolve(rm.group(1)) else []
    if not result_cards and "표 참고" in result:
        # '카운트 특소 → 제로 마키나/케플러 서치' : 마지막 '서치' 대상들을 이니시로 본다
        last = r["변환"].split("→")[-1].strip()
        if last.endswith("서치"):
            result_cards = [c for c in (ctx.resolve(x) for x in last[:-2].strip().split("/")) if c]
            ctx.warn(f"조회표 2단계 '{hand}': 결과 칸이 '{result}'라서, 변환 칸 마지막 '{last}'의 카드를 이어갈 이니시로 읽었다.")
    return {"hand": hand, "conversion": r["변환"], "result": result, "requires": req,
            "bridge": ctx.resolve(bm.group(1)) if bm else None,
            "resultInitiators": result_cards}


def quote_from(ctx, sel):
    body = ctx.sections.get(sel["section"], "")
    if "tableRowStartsWith" in sel:
        for tb in parse_tables(body):
            for r in tb["rows"]:
                first = list(r.values())[0]
                if first.startswith(sel["tableRowStartsWith"]):
                    return {"section": sel["section"], "text": " | ".join(r.values())}
        return None
    cands = bullets(body) + paragraphs(body)
    for c in cands:
        c2 = c[2:] if c.startswith("- ") else c
        if ("startsWith" in sel and c2.startswith(sel["startsWith"])) or ("contains" in sel and sel["contains"] in c2):
            # 문단 안에서 해당 문장만 잘라낸다
            if "contains" in sel:
                # 문단에서 해당 문장이 시작하는 곳부터 문단 끝까지
                return {"section": sel["section"], "text": c2[c2.index(sel["contains"]):]}
            return {"section": sel["section"], "text": c2}
    return None


# ---------------------------------------------------------------- 검사

def validate(ctx, routes_doc, g, data):
    routes = routes_doc["routes"]
    ids = [r["id"] for r in routes]
    # 1. 루트 개수
    intro = routes_doc["introMarkdown"]
    m = re.search(r"루트\s*(\d+)개[^(]*\(([^)]+)\)", intro)
    declared_total = int(m.group(1)) if m else None
    declared = {}
    if m:
        for part in m.group(2).split("·"):
            pm = re.match(r"\s*([A-G])\s*(\d+)", part)
            if pm:
                declared[pm.group(1)] = int(pm.group(2))
    actual = {}
    for r in routes:
        actual[r["group"]] = actual.get(r["group"], 0) + 1
    ctx.check("루트 개수 29개", len(routes) == 29 and declared_total == len(routes),
              f"파싱 {len(routes)}개 / 문서 선언 {declared_total}개")
    ctx.check("그룹별 루트 개수가 문서 선언과 같음", declared == actual,
              " · ".join(f"{k} {actual.get(k, 0)}/{v}" for k, v in declared.items()))
    ctx.check("루트 ID 중복 없음", len(set(ids)) == len(ids), ", ".join(ids))
    # 2. 단계 번호
    bad = [r["id"] for r in routes if r["_numbers"] != list(range(1, len(r["_numbers"]) + 1))]
    ctx.check("모든 루트 단계 번호가 1부터 빠짐없이 이어짐", not bad, ", ".join(bad) or f"{sum(len(r['steps']) for r in routes)}단계")
    # 3. 출처·최종
    nosrc = [r["id"] for r in routes if not r["source"]]
    ctx.check("모든 루트에 출처 링크 있음", not nosrc, ", ".join(nosrc))
    nofin = [r["id"] for r in routes if not r["finalCards"]]
    ctx.check("모든 루트의 최종 필드를 카드로 읽음", not nofin, ", ".join(nofin))
    # 4. 카드가 덱 리스트에 있는지
    deck_names = {c["name"] for c in data["cards"]}
    alias_missing = [n for n in ctx.config["cardAliases"] if n not in deck_names]
    ctx.check("약칭 설정의 카드가 전부 덱 리스트에 있음", not alias_missing, ", ".join(alias_missing))
    deck_no_alias = [n for n in deck_names if n not in ctx.config["cardAliases"]]
    ctx.check("덱 리스트 카드가 전부 약칭 설정에 있음", not deck_no_alias, ", ".join(deck_no_alias))
    used, not_in_deck, leftovers, opp = {}, [], [], set()
    for r in routes:
        for st in r["steps"]:
            for c in st["cards"]:
                used.setdefault(c, set()).add(r["id"])
                if c not in deck_names:
                    not_in_deck.append(f"{r['id']}-{st['n']}: {c}")
            for oc in st["opponentCards"]:
                opp.add(f"{oc}({r['id']}-{st['n']})")
            if st["_leftovers"]:
                leftovers.append(f"{r['id']}-{st['n']}: {' '.join(st['_leftovers'])}  ← '{st['text']}'")
        for c in r["finalCards"]:
            if c not in deck_names:
                not_in_deck.append(f"{r['id']} 최종: {c}")
    ctx.check("루트 단계·최종 필드에 나오는 카드가 전부 덱 리스트에 있음", not not_in_deck,
              f"루트에 나온 카드 {len(used)}종 모두 덱 리스트에 있음" if not not_in_deck else "; ".join(not_in_deck))
    ctx.check("단계 문장에 카드로 못 읽은 낱말이 없음(덱에 없는 카드 탐지용)", not leftovers,
              "; ".join(leftovers) if leftovers else "없음")
    if opp:
        ctx.warn("덱 리스트에 없는 카드 '니비루'가 루트 단계에 나온다: " + ", ".join(sorted(opp)) +
                 ". 상대가 쓰는 카드라 덱 검사에서 제외했다.")
    # 덱 장수 합계
    di = data["deckIntro"]
    m = re.search(r"메인\s*(\d+)장\(몬스터\s*(\d+)·마법\s*(\d+)·함정\s*(\d+)\)과 EX\s*(\d+)장", di)
    if m:
        want = list(map(int, m.groups()))
        got = [sum(c["count"] for c in data["cards"] if c["zone"] == "메인"),
               sum(c["count"] for c in data["cards"] if c["category"] == "몬스터"),
               sum(c["count"] for c in data["cards"] if c["category"] == "마법"),
               sum(c["count"] for c in data["cards"] if c["category"] == "함정"),
               sum(c["count"] for c in data["cards"] if c["zone"] == "EX")]
        ctx.check("덱 리스트 장수 합계가 문서 선언(메인 40·몬25·마8·함7·EX15)과 같음", want == got, f"문서 {want} / 표 합계 {got}")
    # 효과 요약·최종 필드 표의 카드가 덱에 있는지
    eff_bad = [e["card"] for e in data["cardEffects"] if e["card"] not in deck_names]
    ctx.check("카드 효과 요약 표의 카드가 덱 리스트에 있음", not eff_bad, ", ".join(eff_bad))
    ff_bad = [f["label"] for f in data["finalField"]["rows"] if f["card"] not in deck_names]
    ctx.check("최종 필드 표의 카드가 덱 리스트에 있음", not ff_bad, ", ".join(ff_bad))
    # 장수 초과(같은 루트에서 같은 메인 카드 언급 수는 검사하지 않음: 상태 추적 없이 판단 불가)
    # 5. 가이드에 나오는 루트 ID가 실제로 있는지
    all_ids = set(ids)
    guide_text = "\n".join(s["markdown"] for s in g["guide"]["sections"])
    ref = set(f"{a}{b}" for a, b in ROUTE_ID_RE.findall(guide_text))
    missing = sorted(ref - all_ids, key=route_sort_key)
    ctx.check("가이드에 나오는 루트 ID가 루트 파일에 전부 있음", not missing, ", ".join(missing) or f"{len(ref)}개 참조")
    unref = sorted(all_ids - ref, key=route_sort_key)
    if unref:
        ctx.warn("가이드 본문에서 이름이 직접 나오지 않는 루트: " + ", ".join(unref))
    # 6. 데스마키나-링크 목록 대조
    dol = g["verification"]["deathOnLink"]
    auto = [r["id"] for r in routes if any(re.match(r"^데스마키나.*빌가메스.*위 겹침", s["text"]) for s in r["steps"])]
    same = set(auto) == set(dol["ids"]) and dol["declaredCount"] == len(dol["ids"])
    ctx.check("'데스마키나를 빌가메스 위에 겹침' 루트 목록이 단계와 일치", same,
              f"문서 {dol['declaredCount']}개 {','.join(dol['ids'])} / 단계 검출 {len(auto)}개 {','.join(auto)}")
    # 7. 1장뿐인 부품 표와 단계 대조(자동 검출, 차이는 경고)
    singles = {
        "DD 카운트 서베이어": (r"^(?:제로마키나 파괴 → )?카운트 특소\s*\(령왕 효과", "령왕으로 카운트를 부르는"),
        "DD 마도현자 코페르니쿠스": (r"코페르 특소\s*\(령왕 효과", "령왕으로 코페르를 부르는"),
        "DD 랜스 솔저": (r"랜스", "랜스를 쓰는"),
        "DD 마도현자 토마스": (r"토마스", "토마스를 쓰는"),
    }
    for row in g["lookup"].get("step3", {}).get("rows", []):
        if row["card"] in singles:
            pat, label = singles[row["card"]]
            hit = [r["id"] for r in routes if any(re.search(pat, s["text"]) for s in r["steps"])]
            doc = row["blockedIds"]
            only_steps = [i for i in hit if i not in doc]
            only_doc = [i for i in doc if i not in hit]
            if only_steps or only_doc:
                ctx.warn(f"3단계 표 '{row['cardText']}' 행: 문서 불가 목록 {','.join(doc)} / 단계에서 '{label}' 루트로 검출 {','.join(hit)}"
                         + (f" → 표에 없는 루트: {','.join(only_steps)}" if only_steps else "")
                         + (f" → 단계에선 안 보이는 루트: {','.join(only_doc)}" if only_doc else "")
                         + ". 앱은 문서 목록대로 막고, 표에 없는 루트엔 '자동 검출' 주의만 붙인다.")
            row["autoDetectedIds"] = hit
    # 8. 5체째 제우스 목록과 제우스 소환 순번
    for r in routes:
        n = 0
        for s in r["steps"]:
            if s["isSummon"]:
                n += 1
                s["summonIndex"] = n
            else:
                s["summonIndex"] = None
    fifth = []
    for r in routes:
        z = next((s for s in r["steps"] if s["isSummon"] and re.match(r"^제우스", s["text"])), None)
        r["zeusSummonIndex"] = z["summonIndex"] if z else None
        r["zeusStep"] = z["n"] if z else None
        if z and z["summonIndex"] == 5:
            fifth.append(r["id"])
    decl = ctx.config["routeSets"]["5체째 제우스"]
    ctx.check("문서의 '5체째 제우스'(A1·A3·A5·A6)는 단계상 제우스가 5번째 소환", all(i in fifth for i in decl),
              f"단계 기준 제우스가 5번째 소환인 루트: {','.join(fifth)}")
    extra5 = [i for i in fifth if i not in decl]
    if extra5:
        ctx.warn(f"단계 수를 세면 제우스가 5번째 소환인 루트가 문서 목록(A1·A3·A5·A6) 밖에도 있다: {','.join(extra5)}. "
                 "(패트랩 화면의 니비루는 dd-handtraps.json 기준이라 이 계산을 쓰지 않는다. 소환 수는 앱이 단계 문장으로 센 값이라 참고용. "
                 "'케플러·스케일 P소환'처럼 한 단계에 여러 장을 P소환하는 경우도 1회로 셌다. C2는 제우스 앞에 2장 P소환이 있어 장수로 세면 6번째가 된다.)")
    # 9. 설정의 문서 인용·역조회가 문서와 맞는지
    for k, sel in ctx.config["quoteSelectors"].items():
        q = quote_from(ctx, sel)
        ctx.check(f"문서 인용 '{k}' 찾음", q, (q or {}).get("text", "못 찾음")[:60])
    for item in ctx.config["reverseLookup"]:
        for c in item["cards"]:
            ok = any(f["card"] == c["card"] for f in g["finalField"]["rows"])
            ctx.check(f"역조회 '{item['label']}'의 '{c['card']}'가 최종 필드 표에 있음", ok)
    # 10. 최종 필드 카드가 최종 필드 표에 없는 경우
    ffc = {f["card"] for f in g["finalField"]["rows"]}
    for r in routes:
        for c in r["finalCards"]:
            if c not in ffc:
                ctx.warn(f"{r['id']}: 최종 필드의 '{c}'는 '최종 필드와 방해 수' 표에 항목이 없다(화면엔 카드 효과 요약만 보여줌).")


def route_notes(ctx, routes_doc, g):
    v = g["verification"]
    intro = routes_doc["introMarkdown"]
    arc_note = next((b for b in bullets(intro) if b.startswith("아크 크라이시스")), None)
    judge = next((b for b in v["deathOnLinkBullets"] if b.startswith("판단:")), None)
    name_guide = {b.split("**")[1]: b for b in g["nameGuide"] if b.startswith("**")}
    supp = {}
    for b in v["supplements"]:
        m = re.match(r"^([A-G]\d+)", b)
        if m:
            supp.setdefault(m.group(1), []).append(b)
    for r in routes_doc["routes"]:
        notes = []
        for s in r["steps"]:
            if s["markers"]:
                notes.append({"kind": "단계 표시", "text": f"{s['n']}단계: {s['text']}"})
        for b in supp.get(r["id"], []):
            notes.append({"kind": "원문 누락 보완(검증 결과)", "text": b})
        if r["id"] in v["deathOnLink"]["ids"] and judge:
            notes.append({"kind": "데스마키나 링크 위 겹치기", "text": judge})
        if r["id"] in v["layoutUnverifiedIds"]:
            notes.append({"kind": "미검증", "text": "몬스터 존 배치(링크 마커·EX 존): 블로그 수기 루트라 미검증 (검증 결과 표)"})
        if arc_note and any(s["text"].startswith("아크 크라이시스 특소(제외") for s in r["steps"]):
            notes.append({"kind": "해석", "text": arc_note})
        if r["id"] in ctx.config["routeSets"]["솔로몬 선출"] and "솔로몬 선출" in name_guide:
            notes.append({"kind": "루트 이름", "text": name_guide["솔로몬 선출"].replace("**", "")})
        if r["group"] == "B" and "토마스 미사용" in name_guide:
            notes.append({"kind": "루트 이름", "text": name_guide["토마스 미사용"].replace("**", "")})
        if r["id"] in ctx.config["routeSets"]["5체째 제우스"] and "5체째 제우스" in name_guide:
            notes.append({"kind": "루트 이름", "text": name_guide["5체째 제우스"].replace("**", "")})
        if r["finalNote"]:
            notes.append({"kind": "최종 필드", "text": r["finalNote"]})
        for req in r["requiredHand"]:
            if req["reason"] != "루트 이름의 시작 카드":
                notes.append({"kind": "필요한 패(단계에서 읽음)", "text": f"{req['card']} — {req['reason']}"})
        if v["remaining"]:
            notes.append({"kind": "미검증", "text": "남은 미검증: " + v["remaining"]})
        r["notes"] = notes


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    ctx = Ctx(config)
    guide_text = load_md(GUIDE_MD)
    routes_text = load_md(ROUTES_MD)
    # EX 카드 목록은 덱 리스트 표에서 먼저 읽어 둔다(단계의 약식 소환 표기 판단에 씀)
    pre = parse_tables(split_sections(guide_text, "## ")[1][1])[0]
    ctx.ex_cards = {r["카드명 (한글판)"] for r in pre["rows"] if r["구분"] == "EX"}
    routes_doc = parse_routes(ctx, routes_text)
    all_ids = {r["id"] for r in routes_doc["routes"]}
    g = parse_guide(ctx, guide_text, all_ids)
    validate(ctx, routes_doc, g, g)
    route_notes(ctx, routes_doc, g)
    quotes = {k: quote_from(ctx, sel) for k, sel in config["quoteSelectors"].items()}
    for r in routes_doc["routes"]:
        r.pop("_numbers", None)
        for s in r["steps"]:
            s.pop("_leftovers", None)
    data = {
        "meta": {"generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                 "sources": ["data/dd-guide.md", "data/dd-routes.md", "data/app-config.json"],
                 "guideTitle": g["guide"]["title"], "guideDate": g["guide"]["date"],
                 "routesTitle": routes_doc["title"]},
        "cards": g["cards"], "deckIntro": g["deckIntro"],
        "cardEffects": g["cardEffects"], "cardEffectsIntro": g["cardEffectsIntro"],
        "routesIntroMarkdown": routes_doc["introMarkdown"],
        "groups": routes_doc["groups"], "routes": routes_doc["routes"],
        "initiatorTable": g["initiatorTable"], "combos": g["combos"], "lookup": g["lookup"],
        "nameGuide": g["nameGuide"], "summonLimits": g["summonLimits"], "singletons": g["singletons"],
        "finalField": g["finalField"],
        "handTrapResponses": g["handTrap"],
        "verification": g["verification"], "sources": g["sources"],
        "guideSections": g["guide"]["sections"],
        "quotes": quotes,
        "config": config,
        "validation": {"checks": ctx.checks, "warnings": ctx.warnings},
    }
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    OUT_JS.write_text("// 자동 생성 파일: scripts/build_data.py 로 다시 만든다. 직접 고치지 말 것.\n"
                      "window.DD_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
    # 보고서
    lines = ["# 데이터 검사 결과", "", f"생성: {data['meta']['generatedAt']}", "", "## 검사", ""]
    for c in ctx.checks:
        lines.append(f"- {'✅' if c['ok'] else '❌'} {c['name']}" + (f" — {c['detail']}" if c["detail"] else ""))
    lines += ["", "## 문서끼리 어긋나거나 애매한 곳 (자동 검출)", ""]
    lines += [f"- {w}" for w in ctx.warnings] or ["- 없음"]
    OUT_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    fails = [c for c in ctx.checks if not c["ok"]]
    print(f"루트 {len(routes_doc['routes'])}개, 카드 {len(g['cards'])}종, 검사 {len(ctx.checks)}개 중 실패 {len(fails)}개, 경고 {len(ctx.warnings)}개")
    for c in ctx.checks:
        print(("  OK  " if c["ok"] else "  FAIL") + f" {c['name']}" + (f" — {c['detail']}" if c["detail"] else ""))
    print("경고:")
    for w in ctx.warnings:
        print("  - " + w)
    print(f"→ {OUT_JSON.relative_to(ROOT)}, {OUT_JS.relative_to(ROOT)}, {OUT_REPORT.relative_to(ROOT)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
