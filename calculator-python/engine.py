"""Hand-trap response engine for the DD4 routes.

For every step of every route it asks: which opponent hand traps can hit here,
what the state becomes, and what is the best legal continuation.  Continuations
are taken from documented route suffixes (own route or the most similar
positions of other routes) and replayed with the rule checker; any step that
becomes illegal is skipped.  Results are therefore always checker-legal, but
only as good as the documented lines they are built from.
"""
import sys, re, copy, json, itertools
from collections import Counter

S = '.'
sys.path.insert(0, S)
import checker as C  # noqa: E402

C.MAIN['드롤'] = (2, 'M', 1, None, False, 0, 0)
DD_MON = set(C.MAIN) - {'드롤'} | set(C.EX) - {'비욘드'}
ZONES_ON = True
LOOKAHEAD = True
LOOKAHEAD_TOP = 2
IGNORE = ('[룰확인]', '원문 표기 오류 추정', '출처 없는 덤프')


# ---------------------------------------------------------------- routes
def load_routes():
    routes, cur = {}, None
    for ln in open('dd-routes.md'):
        ln = ln.rstrip('\n')
        m = re.match(r'^### (\w\d)\. (.*)$', ln)
        if m:
            cur = m.group(1)
            routes[cur] = {'title': m.group(2), 'steps': [], 'orig': []}
            continue
        m = re.match(r'^(\d+)\. (.*)$', ln)
        if m and cur:
            s = m.group(2).replace('&#91;', '[').replace('\\]', ']')
            routes[cur]['orig'].append(s)
            if '원문 표기는' not in s:
                s = re.sub(r'\s*\(원문[^)]*\)\s*$', '', s)
            s = re.sub(r'\s*\((이 턴 덱→패 불가|령왕은 필드에 남음|원본 로그엔 표기 생략)\)\s*$', '', s)
            routes[cur]['steps'].append(s)
    return routes


ROUTES = load_routes()
STARTERS = C.STARTERS


# ---------------------------------------------------------------- classification
def classify(raw):
    s = C.norm(raw)
    d = {'src': None, 'loc': 'proc', 'cats': set(), 'raw': raw}
    if s.startswith('[상대]') or s.startswith('내 드롤'):
        d['loc'] = 'opp'
        return d
    if re.match(r'^(\S+) 일반소환', s):
        d['cats'].add('ns')
        return d
    m = re.match(r'^(\S+) 서치[:(]\s*(\S+) 효과', s)
    if m:
        d['src'] = m.group(2)
        d['loc'] = 'spell' if m.group(2) == '지옥문' else 'mon'
        d['cats'] |= {'search'}
        d['target'] = m.group(1)
        return d
    if 'P존 세팅(자신 1000 데미지)' in s:
        d.update(src='빌가메스', loc='mon')
        return d
    if '놓기(제로마키나 효과)' in s and not s.startswith('P존에'):
        d.update(src='제로마키나', loc='pz')
        return d
    if s.startswith('P존에 놓기(제로마키나 효과)'):
        d.update(src='제로마키나', loc='ex')
        return d
    if '알프레드 효과' in s and '놓기' in s or re.match(r'^(\S+) 놓기$', s):
        d.update(src='알프레드', loc='ban')
        return d
    if '령왕 효과' in s:
        d.update(src='령왕', loc='spell')
        d['cats'] |= {'ss_deck', 'ss'}
        return d
    if s.startswith('랜스 특소'):
        d.update(src='랜스', loc='gy')
        d['cats'] |= {'gy_ss', 'ss'}
        d['gyuse'] = ['랜스']
        return d
    if '토마스 효과:' in s:
        d.update(src='토마스', loc='mon')
        d['cats'] |= {'ss_deck', 'ss'}
        return d
    if re.match(r'^제로마키나 특소', s):
        d.update(src='제로마키나', loc='ex')
        d['cats'] |= {'ss'}
        return d
    if s == '오르트로스 특소(오르트로스 효과)':
        d.update(src='오르트로스', loc='hand')
        d['cats'] |= {'ss'}
        return d
    m = re.match(r'^(스케일|그리폰) 특소\s*\(\1 효과\)$', s)
    if m:
        d.update(src=m.group(1), loc='hand')
        d['cats'] |= {'ss'}
        return d
    m = re.match(r'^(\S+) (?:소생|특소)\s*\((테무진|클로비스) 효과\)$', s)
    if m:
        d.update(src=m.group(2), loc='mon', target=m.group(1))
        d['cats'] |= {'ss'}
        if m.group(2) == '테무진':
            d['cats'].add('gy_ss')
        d['gyuse'] = [m.group(1)]
        return d
    m = re.match(r'^(\S+) (링크|엑시즈|싱크로|융합|특소)\s*\((.+?)\)$', s)
    if m and m.group(1) in C.EX:
        x, kind, mats = m.groups()
        if '알프레드 효과' in mats:
            d.update(src='알프레드', loc='mon')
            d['cats'] |= {'ss'}
        elif kind == '융합' and x in ('알프레드', '테무진'):
            d.update(src='네크로', loc='gy')
            d['cats'] |= {'gy_banish', 'ss'}
            d['gyuse'] = ['네크로'] + C.names_in(mats.split(':')[0])
        elif x == '아크크라이시스':
            d['gyuse'] = C.names_in(mats.replace('제외:', ''))
        d['summon_proc'] = kind
        return d
    m = re.match(r'^(\S+) 묘지로\s*\((코페르|텔) 효과\)$', s)
    if m:
        d.update(src=m.group(2), loc='mon' if m.group(2) == '코페르' else 'gy')
        d['cats'] |= {'send_deck'}
        return d
    if '회수(토마스 효과)' in s:
        d.update(src='토마스', loc='pz')
        return d
    m = re.match(r'^(\S+) (?:바운스|패로 되돌림)\((스케일|케플러) 효과\)$', s)
    if m:
        d.update(src=m.group(2), loc='gy' if m.group(2) == '스케일' else 'mon')
        return d
    if re.search(r'P소환$', s):
        d['cats'].add('ps')
        return d
    if '제우스 효과' in s:
        d.update(src='제우스', loc='mon')
        return d
    if '오르트로스 효과' in s:
        d.update(src='오르트로스', loc='pz')
        return d
    if s == '그리폰 파괴(그리폰 효과)':
        d.update(src='그리폰', loc='pz')
        return d
    if '레벨 4로(스케일 효과)' in s:
        d.update(src='스케일', loc='mon')
        return d
    if '랜스 효과' in s:
        d.update(src='랜스', loc='mon')
        return d
    if '텔 효과' in s:
        d.update(src='텔', loc='mon')
        return d
    return d


# ---------------------------------------------------------------- summon instrumentation
_orig_summon = C.State.summon


def _summon(self, step, n, *a, **k):
    if not hasattr(self, '_summoned'):
        self._summoned = []
    self._summoned.append(n)
    return _orig_summon(self, step, n, *a, **k)


C.State.summon = _summon
_orig_from = C.State.from_loc


def _from_loc(self, step, n, locs):
    loc = _orig_from(self, step, n, locs)
    if loc == 'deck':
        if not hasattr(self, '_pulled'):
            self._pulled = []
        self._pulled.append(n)
    return loc


C.State.from_loc = _from_loc


def _default_src(d, n):
    raw = d['raw']
    if 'ss_deck' in d['cats']:
        return 'deck'
    if d['src'] == '제로마키나' and d['loc'] == 'ex':
        return 'exup'
    if d['src'] in ('스케일', '그리폰', '오르트로스') and d['loc'] == 'hand':
        return 'hand'
    if d['src'] in ('테무진', '랜스'):
        return 'gy'
    if d['src'] == '클로비스':
        return 'ban'
    if n in C.EX:
        return 'ex'
    return None



# ---------------------------------------------------------------- monster zones
# slots: 0..4 main zones (left->right), 5 = EMZ-left (above main 1), 6 = EMZ-right (above main 3)
LINK_ARROWS = {'빌가메스': ('BL', 'BR'), '제우스': ('BL', 'B', 'BR'), '비욘드': ('BL', 'BR')}
EMZ_POINT = {5: {'BL': 0, 'B': 1, 'BR': 2}, 6: {'BL': 2, 'B': 3, 'BR': 4}}
ZONE_CAP = 300


def _pointed(cfg):
    pts = set()
    for z in (5, 6):
        n = cfg[z]
        if n and n in LINK_ARROWS:
            for a in LINK_ARROWS[n]:
                if a in EMZ_POINT[z]:
                    pts.add(EMZ_POINT[z][a])
    return pts


def _restricted(name, src):
    if src == 'exup':
        return True
    return src == 'ex' and name in LINK_ARROWS


def _place(cfgs, name, src):
    out = set()
    for cfg in cfgs:
        emz_used = cfg[5] is not None or cfg[6] is not None
        if _restricted(name, src):
            slots = [z for z in _pointed(cfg) if cfg[z] is None]
            if not emz_used:
                slots += [5, 6]
        else:
            slots = [z for z in range(5) if cfg[z] is None]
            if src in ('ex',) and not emz_used:
                slots += [5, 6]
        for z in slots:
            c = list(cfg); c[z] = name
            out.add(tuple(c))
    if len(out) > ZONE_CAP:
        out = set(sorted(out, key=lambda c: tuple(x or '' for x in c))[:ZONE_CAP])
    return out


def _remove(cfgs, name):
    out = set()
    for cfg in cfgs:
        for z in range(7):
            if cfg[z] == name:
                c = list(cfg); c[z] = None
                out.add(tuple(c))
    return out


def zone_reconcile(st):
    """sync zone configs with the field after changes made outside step() (hits, Nibiru...)."""
    if not hasattr(st, 'zones'):
        st.zones = {(None,) * 7}
        st.zone_names = Counter()
    cur = Counter(m['name'] for m in st.field)
    gone = st.zone_names - cur
    new = cur - st.zone_names
    cf = st.zones
    for n, k in gone.items():
        for _ in range(k):
            cf = _remove(cf, n)
    for n, k in new.items():
        for _ in range(k):
            cf = _place(cf, n, 'other')
    st.zones = cf
    st.zone_names = cur


def zone_step(before_names, st, sm):
    """apply one step: monsters that left, then monsters summoned (name, src)."""
    cur = Counter(m['name'] for m in st.field)
    entered = Counter(n for n, _ in sm)
    gone = before_names - (cur - entered)
    cf = st.zones
    for n, k in gone.items():
        for _ in range(k):
            cf = _remove(cf, n)
    for n, src in sm:
        if n in cur:
            cf = _place(cf, n, src)
    # anything summoned and gone within the same step (e.g. ZM self-destroy) is not placed
    st.zones = cf
    st.zone_names = cur
    return bool(cf)

# ---------------------------------------------------------------- state helpers
def snap(st):
    return copy.deepcopy(st)


def real_issues(st, start):
    return [x for x in st.issues[start:] if not any(k in x[1] for k in IGNORE)]


def mon_neg(st, name):
    m = st.mon(name)
    return m is not None and m.get('neg')


def summons_of(before, after):
    """list of (name, source) for monsters that newly appeared on the field."""
    b = Counter(x['name'] for x in before.field)
    out = []
    for x in after.field:
        if b[x['name']] > 0:
            b[x['name']] -= 1
            continue
        n = x['name']
        src = None
        for loc in ('deck', 'ex', 'hand', 'gy', 'exup', 'ban'):
            if getattr(after, loc)[n] < getattr(before, loc)[n]:
                src = loc
                break
        if src is None and n in C.EX:
            src = 'ex'
        out.append((n, src))
    return out


def step(st, i, raw, strict=True):
    """execute one step transactionally. returns (new_state, ok, info)."""
    d = classify(raw)
    new = snap(st)
    new._summoned = []
    zone_reconcile(new)
    zone_before = Counter(new.zone_names)
    start = len(new.issues)
    # generic precondition: monster effects need the monster face-up on field and not negated
    if d['loc'] == 'mon' and d['src']:
        m = new.mon(d['src'])
        if m is None:
            new.issue(i, f"{d['src']} 필드에 없음")
        elif m.get('neg'):
            new.issue(i, f"{d['src']} 효과 무효 상태")
    if d['loc'] == 'pz' and d['src'] and '재발동' not in raw and not any(p['name'] == d['src'] for p in new.pz):
        new.issue(i, f"{d['src']} P존에 없음")
    destroyed_before = list(new.last_destroyed)
    new.last_destroyed = []
    mt = re.search(r'코스트 (\S+)\)', raw)
    if mt and '텔 효과' in raw:
        t = new.mon('텔')
        if t and mt.group(1) not in t['mats'] and t['mats']:
            raw = re.sub(r': 코스트 \S+\)', ')', raw)
    if C.norm(raw) == '오르트로스 특소(오르트로스 효과)':
        if new.hand['오르트로스'] <= 0:
            new.issue(i, '오르트로스가 패에 없음')
        elif not getattr(st, 'took_damage', False):
            new.issue(i, '오르트로스 ①: 직전에 데미지를 받지 않음')
        else:
            new.hand['오르트로스'] -= 1
            new.summon(i, '오르트로스')
        ok = True
    else:
        ok = C.handle(new, i, C.norm(raw), destroyed_before)
    new.took_damage = '자신 1000 데미지' in raw
    if not ok:
        new.issue(i, f'[해석 못함] {raw}')
    bad = real_issues(new, start)
    if bad and strict:
        return st, False, bad
    called = list(getattr(new, '_summoned', []))
    new._summoned = []
    diff = summons_of(st, new)
    pool = list(diff)
    sm = []
    for n in called:
        hit = next((x for x in pool if x[0] == n), None)
        if hit:
            pool.remove(hit)
            sm.append(hit)
        else:
            sm.append((n, _default_src(d, n)))
    sm += pool  # summons placed directly on the field (xyz) are not routed through State.summon
    if ZONES_ON and not zone_step(zone_before, new, sm):
        new.issue(i, '몬스터 존 배치 불가(링크 마커·EX 존 제한)')
        if strict:
            return st, False, real_issues(new, start)
    new.sums = getattr(st, 'sums', 0) + len(sm)
    new.ss_events = getattr(st, 'ss_events', [])
    if sm and 'ns' not in d['cats']:
        new.ss_events = new.ss_events + [(i, sm)]
    return new, True, bad


def init_state(hand):
    st = C.State(hand)
    st.sums = 0
    st.ss_events = []
    return st


def _alts(st, raw, rest):
    """alternative spellings of a failed step (substitute targets / materials)."""
    s = C.norm(raw)
    out = []
    later = ' '.join(rest)
    def cost(names):
        return sum((5 if n in later else 0) + W.get(n, 0.3) for n in names)
    fieldn = [m['name'] for m in st.field if m['name'] in DD_MON]
    def pref(names):
        # cards named in later steps first, then the rest
        return sorted(names, key=lambda n: (0 if n in later else 1, -C.MAIN.get(n, (0,))[0]))
    deck_p = [n for n, v in st.deck.items() if v > 0 and n in C.MAIN and C.MAIN[n][1] == 'P']
    deck_mon = [n for n, v in st.deck.items() if v > 0 and n in C.MAIN and n != '드롤']
    deck_any = deck_mon + [n for n, v in st.deck.items() if v > 0 and n in C.CONTRACTS]
    # Gilgamesh: place two different DD pendulums that are still in the deck
    m = re.match(r'^(.+?) P존 세팅\(자신 1000 데미지\)$', s)
    if m:
        orig = C.names_in(m.group(1))
        keep = [n for n in orig if st.deck[n] > 0]
        pool = pref([n for n in deck_p if n not in keep])
        pairs = []
        if len(keep) == 1:
            pairs = [(keep[0], o) for o in pool]
        else:
            pairs = [(a, b) for a, b in itertools.combinations(pool, 2)]
        for a, b in pairs[:12]:
            out.append(f'{a}·{b} P존 세팅(자신 1000 데미지)')
        return out
    # search target already gone from the deck (e.g. in hand): search something else
    m = re.match(r'^(\S+) 서치[:(]\s*(\S+) 효과\)?$', s)
    if m and st.deck[m.group(1)] <= 0:
        for t in pref([n for n in deck_any if n != m.group(1)])[:10]:
            out.append(f'{t} 서치({m.group(2)} 효과)')
        return out
    m = re.match(r'^(\S+) 묘지로\s*\((코페르|텔) 효과\)$', s)
    if m and st.deck[m.group(1)] <= 0:
        for t in pref([n for n in deck_any if n not in (m.group(1), '코페르')])[:8]:
            out.append(f'{t} 묘지로({m.group(2)} 효과)')
        return out
    # Orthros held in hand: set it from hand first, then use its P effect
    m = re.match(r'^(\S+?)[·&]오르트로스 파괴\(오르트로스 효과\)$', s)
    if m and not any(p['name'] == '오르트로스' for p in st.pz) and st.hand['오르트로스'] > 0:
        out.append(f'오르트로스 P존 세팅 ;; {m.group(1)}·오르트로스 파괴(오르트로스 효과)')
    # 령왕 SS target gone from the deck
    m2 = re.match(r'^(\S+) 특소\(령왕 효과: (\S+) 파괴\)$', s)
    if m2 and st.deck[m2.group(1)] <= 0:
        for x in pref([n for n in deck_mon])[:6]:
            out.append(f'{x} 특소(령왕 효과: {m2.group(2)} 파괴)')
    m = re.match(r'^(\S+) 특소\(령왕 효과(?:: (.+?))?\)$', s) or re.match(r'^(\S+) 파괴 → (\S+) 특소\(령왕 효과\)$', s)
    if m and '령왕 효과' in s:
        x = m.group(1) if '특소(령왕' in s else m.group(2)
        cands = sorted(set(fieldn + [p['name'] for p in st.pz]), key=lambda n: cost([n]))
        for y in cands:
            out.append(f'{x} 특소(령왕 효과: {y} 파괴)')
        return out
    m = re.match(r'^(빌가메스|제우스|솔로몬|대왕시져|클로비스|사이프리트) (링크|엑시즈|싱크로|특소)\((.+)\)$', s) or \
        re.match(r'^(빌가메스|제우스|솔로몬|대왕시져|클로비스|사이프리트)\((.+)\)$', s)
    if m:
        x = m.group(1)
        kind = {'빌가메스': '링크', '제우스': '링크', '솔로몬': '엑시즈', '대왕시져': '엑시즈', '클로비스': '싱크로', '사이프리트': '싱크로'}[x]
        mons = [mm for mm in st.field if mm['name'] in DD_MON]
        combos = []
        for r in (2, 3):
            for cmb in itertools.combinations(range(len(mons)), r):
                ms = [mons[j] for j in cmb]
                names = [q['name'] for q in ms]
                if len(set(map(id, ms))) != len(ms):
                    continue
                if x == '빌가메스' and r == 2:
                    combos.append(names)
                elif x == '제우스':
                    rating = sum(C.EX[n][2] if n in C.EX and C.EX[n][1] == 'L' else 1 for n in names)
                    if (r == 2 and rating >= 3) or (r == 3):
                        combos.append(names)
                elif x == '솔로몬' and r == 2 and all(q['lvl'] == 4 for q in ms):
                    combos.append(names)
                elif x == '대왕시져' and r == 2 and all(q['lvl'] == 6 for q in ms):
                    combos.append(names)
                elif x in ('클로비스', '사이프리트'):
                    tun = [q for q in ms if C.MAIN.get(q['name'], (0, 0, 0, 0, False))[4]]
                    tot = sum(q['lvl'] or 0 for q in ms)
                    if len(tun) == 1 and tot == C.EX[x][2]:
                        combos.append(names)
        combos.sort(key=cost)
        for names in combos:
            out.append(f"{x} {kind}({'+'.join(names)})")
        return out
    m = re.match(r'^(.+?) ?P소환$', s)
    if m:
        listed = C.names_in(m.group(1))
        pool = []
        for n in sorted({n for n in list(st.hand) + list(st.exup) if n in C.MAIN and C.MAIN[n][1] == 'P'}):
            pool += [n] * (st.hand[n] + st.exup[n])
        seen = set()
        for r in range(min(len(pool), 5), 0, -1):
            for cmb in itertools.combinations(pool, r):
                key = tuple(sorted(cmb))
                if key in seen or list(key) == sorted(listed):
                    continue
                seen.add(key)
                out.append('·'.join(cmb) + ' P소환')
                if len(out) >= 24:
                    return out
        return out
    m = re.match(r'^랜스 특소\s*\((?:랜스 효과: )?(\S+) 파괴\)$', s)
    if m:
        for c in st.st:
            if c != m.group(1):
                out.append(f'랜스 특소(랜스 효과: {c} 파괴)')
        return out
    m = re.match(r'^(\S+?)[·&](\S+?) 파괴\(오르트로스 효과\)$', s)
    if m:
        for c in list(st.st) + [q['name'] for q in st.field if q['name'] in DD_MON]:
            if c != '오르트로스':
                out.append(f'{c}·오르트로스 파괴(오르트로스 효과)')
        return out
    m = re.match(r'^추가 P소환권\(제우스 효과: (\S+) 파괴\)$', s) or re.match(r'^(\S+) 파괴 → 추가 P소환권\(제우스 효과\)$', s)
    if m:
        cands = list(st.st) + [p['name'] for p in st.pz] + [q['name'] for q in st.field if q['name'] in DD_MON and q['name'] != '제우스']
        for c in sorted(set(cands), key=lambda n: cost([n])):
            out.append(f'추가 P소환권(제우스 효과: {c} 파괴)')
        return out
    m = re.match(r'^(텔|데스마키나) 엑시즈\((\S+?)(?: 위 겹침)?\)$', s) or re.match(r'^(데스마키나)\((\S+?)(?:①|②)? 위 겹침\)$', s)
    if m:
        x = m.group(1)
        if x == '텔':
            bases = [q['name'] for q in st.field if q['name'] in ('솔로몬', '시져')]
        else:
            bases = [q['name'] for q in st.field if q['name'] in C.DDD and q['name'] != '데스마키나']
        for b in sorted(set(bases), key=lambda n: cost([n])):
            out.append(f'{x} 엑시즈({b})')
    return out


def _insert_options(st, raw_done, rest):
    """optional trigger steps worth trying right after a step."""
    opts = []
    later = ' '.join(rest)
    destroyed = st.last_destroyed
    hit = any(k == 'C' or (k in ('P', 'M') and n in C.DDD and n != '제로마키나') for k, n in destroyed)
    if hit and zm_ready(st):
        opts.append('제로마키나 특소(제로마키나 효과)')
    if getattr(st, 'took_damage', False) and st.hand['오르트로스'] > 0:
        opts.append('오르트로스 특소(오르트로스 효과)')
    # pendulum summon: also try summoning more cards than written
    if raw_done.endswith('P소환') and ' (대체)' not in raw_done:
        pass
    return opts


def _greedy_tail(st, steps, offset, label):
    return run_steps(st, steps, offset=offset, label=label, lookahead=False)


def run_steps(st, steps, offset=1, label=None, repair=True, lookahead=False, max_branch=4):
    """replay steps, skipping illegal ones (after trying substitutes).
    lookahead=True: at every repair / optional trigger, compare the alternatives by
    playing the rest greedily and keep the one with the best final field."""
    done, skipped = [], []
    k = 0
    while k < len(steps):
        raw = steps[k]
        i = offset + k
        if label and (raw.startswith('[상대]') or raw.startswith('내 드롤') or '니비루 무효' in raw):
            k += 1
            continue
        options = []  # list of (state, done_lines)
        new, ok, info = step(st, i, raw)
        if ok:
            options.append((new, [(label, i, raw)]))
        if repair and (not ok or (lookahead and raw.endswith('P소환'))):
            for alt in _alts(st, raw, steps[k + 1:]):
                cur, ok2, parts = st, True, alt.split(' ;; ')
                lines = []
                for part in parts:
                    cur, ok2, _ = step(cur, i, part)
                    if not ok2:
                        break
                    lines.append((label, i, part + ' (대체)'))
                if ok2:
                    options.append((cur, lines))
                    if not lookahead or len(options) > max_branch:
                        break
        if not options:
            skipped.append((label, i, raw, info[0][1] if info else ''))
            k += 1
            continue
        # optional triggers after this step
        if lookahead:
            extra = []
            for s_after, lines in options:
                for t in _insert_options(s_after, lines[-1][2], steps[k + 1:]):
                    s2, ok3, _ = step(s_after, i, t)
                    if ok3:
                        extra.append((s2, lines + [(label, i, t + ' (추가)')]))
            options += extra
        if len(options) == 1 or not lookahead:
            st, lines = options[0]
            done += lines
            k += 1
            continue
        best = None
        for s_opt, lines in options[:max_branch * 2]:
            fin, d2, sk2 = _greedy_tail(s_opt, steps[k + 1:], i + 1, label)
            sc = score(fin)
            if best is None or sc > best[0] + 1e-9:
                best = (sc, s_opt, lines)
        st, lines = best[1], best[2]
        done += lines
        k += 1
    return st, done, skipped


# ---------------------------------------------------------------- scoring
W = {'제우스': 3, '사이프리트': 3, '대왕시져': 3, '데스마키나': 3, '아크크라이시스': 1.5, '솔로몬': 1, '텔': 0.8,
     '시져': 0.8, '클로비스': 0.6, '테무진': 0.6, '알프레드': 0.6, '빌가메스': 0.4, '제로마키나': 0.8}


def zm_ready(st):
    return st.exup['제로마키나'] > 0 and st.opt['제로마키나1'] == 0


def score(st):
    s = 0
    for m in st.field:
        if m['name'] == '니비루토큰':
            continue
        v = W.get(m['name'], 0.3)
        if m['name'] == '데스마키나' and not m.get('mats'):
            v = 1.5
        if m.get('neg'):
            v *= 0.3
        s += v
    if '상암' in st.st and len([p for p in st.pz if p['name'] in C.MAIN or p['name'] in C.EX]) == 2:
        s += 2
    if zm_ready(st) and st.st:
        s += 1.5
    return round(s, 2)


def describe(st):
    mons = [m['name'] + ('(무효)' if m.get('neg') else '') for m in st.field]
    out = {'monsters': mons, 'contracts': list(st.st), 'pzones': [p['name'] for p in st.pz],
           'ex_faceup': [k for k, v in st.exup.items() for _ in range(v)],
           'hand': [k for k, v in st.hand.items() for _ in range(v) if v > 0],
           'zm_ready': zm_ready(st)}
    intr = []
    for m in st.field:
        n = m['name']
        if m.get('neg'):
            continue
        if n == '제우스' and st.opt['제우스2'] == 0:
            intr.append('제우스②(패 몬스터 효과 무효)')
        elif n == '사이프리트' and st.opt['사이프리트1'] == 0:
            intr.append('사이프리트①(앞면 마함 무효)')
        elif n == '대왕시져' and m.get('mats'):
            intr.append(f"대왕시져①(특소 포함 효과 무효, 소재 {len(m['mats'])})")
        elif n == '데스마키나':
            intr.append('데스마키나②(상대 필드 몬스터 효과 흡수)')
    if zm_ready(st) and (st.st or True):
        intr.append('제로마키나①(DDD·계약서 파괴 시 엑덱에서 특소+1장 파괴)')
    if '상암' in st.st and len(st.pz) == 2:
        intr.append('상암①(몬스터 대상 마함·소재 사용 금지)')
    out['interruptions'] = intr
    out['score'] = score(st)
    return out


# ---------------------------------------------------------------- prefix states (positions)
def prefix_states(rid, hand=None):
    r = ROUTES[rid]
    st = init_state(hand or STARTERS[rid])
    states = [st]
    for k, raw in enumerate(r['steps'], 1):
        new, ok, info = step(st, k, raw, strict=False)
        st = new
        states.append(st)
    return states  # states[k] = after step k


PREFIX = {rid: prefix_states(rid) for rid in ROUTES}


def sig(st):
    c = Counter()
    for m in st.field:
        c['F:' + m['name']] += 1
    for p in st.pz:
        c['P:' + p['name']] += 1
    for x in st.st:
        c['C:' + x] += 1
    for k, v in st.hand.items():
        if v > 0:
            c['H:' + k] += v
    for k, v in st.gy.items():
        if v > 0:
            c['G:' + k] += v
    for k, v in st.exup.items():
        if v > 0:
            c['E:' + k] += v
    for k, v in st.opt.items():
        if v > 0:
            c['O:' + k] += 1
    c['NS'] = st.ns
    return c


def dist(a, b):
    keys = set(a) | set(b)
    w = {'F': 1.0, 'P': 1.0, 'C': 1.0, 'H': 0.8, 'G': 0.4, 'E': 0.4, 'O': 0.6, 'N': 1.0}
    return sum(abs(a[k] - b[k]) * w[k[0]] for k in keys)


POS = []  # (rid, k, sig)
for rid, sts in PREFIX.items():
    for k, s in enumerate(sts):
        POS.append((rid, k, sig(s)))


def best_continuation(st, own=None, topk=29, extra_first=()):
    """own=(rid, from_index) – the route's own remaining steps (1-based index of first step to run)."""
    cands = []
    if own:
        rid, fr = own
        cands.append((rid, fr))
    sg = sig(st)
    bestpos = {}
    for rid, k, g in POS:
        if k >= len(ROUTES[rid]['steps']):
            continue
        dd = dist(sg, g)
        if rid not in bestpos or dd < bestpos[rid][0]:
            bestpos[rid] = (dd, k)
    ranked = sorted(bestpos.items(), key=lambda kv: kv[1][0])[:topk]
    seen = set()
    for rid, (dd, k) in ranked:
        key = tuple(ROUTES[rid]['steps'][k:])
        if key in seen:
            continue
        seen.add(key)
        cands.append((rid, k + 1))
    best = None
    cand_runs = []
    for rid, fr in cands:
        steps = ROUTES[rid]['steps'][fr - 1:]
        pre_done = []
        s0 = st
        for raw in extra_first:
            new, ok, _ = step(s0, 0, raw)
            if ok:
                s0 = new
                pre_done.append(raw)
        fin, done, skipped = run_steps(s0, steps, offset=fr, label=rid)
        sc = score(fin)
        cand_runs.append((sc, rid, fr, s0, pre_done, steps))
        cand = {'route': rid, 'from': fr, 'pre': pre_done, 'done': done, 'skipped': skipped, 'state': fin, 'score': sc}
        if best is None or sc > best['score'] + 1e-9 or (abs(sc - best['score']) < 1e-9 and own and rid == own[0] and best['route'] != own[0]):
            best = cand
    if LOOKAHEAD and cand_runs:
        for sc0, rid, fr, s0, pre_done, steps in sorted(cand_runs, key=lambda x: -x[0])[:LOOKAHEAD_TOP]:
            fin, done, skipped = run_steps(s0, steps, offset=fr, label=rid, lookahead=True)
            sc = score(fin)
            if sc > best['score'] + 1e-9:
                best = {'route': rid, 'from': fr, 'pre': pre_done, 'done': done, 'skipped': skipped, 'state': fin, 'score': sc}
    return best
