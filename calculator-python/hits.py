import sys, json, re, copy
from collections import Counter
from multiprocessing import Pool

sys.path.insert(0, '.')
import engine as E
C = E.C

TRAPS = {
    'ash': ('하루 우라라', 'hand_mon'),
    'maxxc': ('증식의 G', 'hand_mon'),
    'fuwalos': ('마루챠미 후와로스', 'hand_mon'),
    'nibiru': ('원시생명태 니비루', 'hand_mon'),
    'imperm': ('무한포영', 'trap'),
    'veiler': ('이펙트 뵐러', 'hand_mon'),
    'dominus': ('도미나스 임펄스', 'trap'),
    'droll': ('드롤 & 로크 버드', 'hand_mon'),
    'ogre': ('유령토끼', 'hand_mon'),
    'belle': ('저택 와라시', 'hand_mon'),
    'gyban': ('묘지 제외(바이스테어류·D.D. 크로우)', 'hand_mon'),
}
EXTRA_STARTERS = ['케플러', '지옥문', '제로마키나', '스케일', '그리폰']

DOC = [  # (trap, step regex, starter, ref, conditional_extra)
    ('droll', r'^제로마키나 서치.?지옥문', '지옥문', 'D1·D2', None),
    ('droll', r'^코페르 서치\(카운트', '제로마키나', 'D3', None),
    ('droll', r'^케플러 서치\(카운트', '제로마키나', 'D4', None),
    ('droll', r'^령왕 서치\(케플러', '케플러', 'D5·D6', None),
    ('maxxc', r'령왕 효과', '케플러', 'E1', '드롤'),
    ('maxxc', r'령왕 효과', '지옥문', 'E2', '드롤'),
    ('dominus', r'령왕 효과', '제로마키나', 'G1', '지옥문'),
]
F_DOC = {'A2': 'F1·F2', 'A4': 'F3·F4', 'A7': 'F5·F6'}
NIB_DOC = {'A1', 'A3', 'A5', 'A6'}


def doc_ref(rid, k, trap, raw):
    st = E.STARTERS[rid][0]
    for t, rx, starter, ref, cond in DOC:
        if t == trap and starter == st and re.search(rx, raw) and k <= 6:
            return ref, cond
    if trap in ('imperm', 'veiler') and rid in F_DOC and 'P존 세팅(자신 1000 데미지)' in raw and k < 20:
        return F_DOC[rid], None
    return None, None


# ---------------------------------------------------------------- generic counters
def zeus_options(st):
    z = st.mon('제우스')
    if not z or z.get('neg') or st.opt['제우스2'] > 0:
        return []
    mons = [n for n, v in st.gy.items() if v > 0 and n in E.DD_MON]
    cons = [n for n, v in st.gy.items() if v > 0 and n in C.CONTRACTS]
    out = []
    for m in mons:
        for c in cons:
            s = E.snap(st)
            s.gy[m] -= 1
            s.gy[c] -= 1
            s.ban[m] += 1
            s.ban[c] += 1
            s.opt['제우스2'] += 1
            out.append((f'제우스 ②로 무효(코스트: 묘지 {m}+{c} 제외)', s))
    return out


def caesar_option(st):
    m = st.mon('대왕시져')
    if not m or m.get('neg') or not m.get('mats'):
        return []
    s = E.snap(st)
    mm = s.mon('대왕시져')
    s.gy[mm['mats'].pop()] += 1
    return [('대왕시져 ①로 무효(소재 1개)', s)]


def opt_diff_of(st, k, raw):
    """state where step k's effect was activated but negated."""
    tmp, ok, info = E.step(st, k, raw, strict=False)
    new = E.snap(st)
    for key, v in tmp.opt.items():
        if v > new.opt[key]:
            new.opt[key] = v
    # card activations that happen before the effect (continuous spells from hand)
    if '지옥문 효과' in raw and '지옥문' not in new.st and new.hand['지옥문'] > 0:
        new.hand['지옥문'] -= 1
        new.st.append('지옥문')
    if '령왕 효과' in raw:
        new.ddonly = True
        if '령왕' not in new.st and new.hand['령왕'] > 0:
            new.hand['령왕'] -= 1
            new.st.append('령왕')
    if 'P존 세팅(자신 1000 데미지)' in raw:
        new.ddonly = True
    # costs
    if '솔로몬 효과' in raw:
        m = new.mon('솔로몬')
        if m and m['mats']:
            new.gy[m['mats'].pop(0)] += 1
    if '텔 효과' in raw and '데미지' in raw:
        m = new.mon('텔')
        if m and m['mats']:
            new.gy[m['mats'].pop(0)] += 1
    new.last_destroyed = []
    return new


def neg_mon(st, name):
    s = E.snap(st)
    m = s.mon(name)
    if m:
        m['neg'] = True
    return s


def tribute_all(st):
    s = E.snap(st)
    for m in list(s.field):
        s.leave_field_mon(0, m, 'gy')
    s.field.append({'name': '니비루토큰', 'lvl': 11, 'mats': [], 'own_lance': False})
    s.last_destroyed = []
    return s


def destroy_card(st, name):
    s = E.snap(st)
    s.last_destroyed = list(s.last_destroyed)
    ok = s.destroy(0, name)
    return s if ok else None


# ---------------------------------------------------------------- continuation wrappers
def cont(state, rid, fr, extra_first=()):
    b = E.best_continuation(state, own=(rid, fr), extra_first=extra_first)
    return b


def pack(b, rid):
    """compress a continuation into segments."""
    fin = b['state']
    segs = []
    if b['pre']:
        segs.append({'insert': b['pre']})
    steps = E.ROUTES[b['route']]['steps']
    done_idx = [i for (_, i, _) in b['done']]
    skipped = [{'step': i, 'text': raw, 'why': why} for (_, i, raw, why) in b['skipped']]
    segs.append({'route': b['route'], 'from': b['from'], 'to': len(steps), 'skip': [x['step'] for x in skipped]})
    return {'route': b['route'], 'from': b['from'], 'segments': segs, 'skipped': skipped,
            'executed': [raw for (_, _, raw) in b['done']], 'final': E.describe(fin), 'score': b['score']}


def best_of(options):
    """options: list of (label, packed) -> choose by score."""
    return max(options, key=lambda x: x[1]['score'])


# ---------------------------------------------------------------- per-trap simulation
def simulate(rid, k, trap, before, after, hand_extra=None):
    raw = E.ROUTES[rid]['steps'][k - 1]
    d = E.classify(raw)
    nsteps = len(E.ROUTES[rid]['steps'])
    res = []

    def with_counters(state_at, kind, negate_state_fn, fr):
        """add options where Zeus/Caesar negate the hand trap."""
        opts = []
        if TRAPS[trap][1] == 'hand_mon':
            for lab, s in zeus_options(state_at):
                opts.append((lab, s, 'counter'))
            if trap in ('nibiru', 'gyban'):
                for lab, s in caesar_option(state_at):
                    opts.append((lab, s, 'counter'))
        return opts

    if trap in ('ash', 'imperm', 'veiler', 'dominus', 'belle'):
        # negate step k's effect
        ns = opt_diff_of(before, k, raw)
        if trap in ('imperm', 'veiler') and d['src']:
            ns = neg_mon(ns, d['src'])
        main = pack(cont(ns, rid, k + 1), rid)
        out = {'effect': 'negated', 'response': main}
        counters = []
        if TRAPS[trap][1] == 'hand_mon':
            for lab, s in zeus_options(before):
                new, ok, _ = E.step(s, k, raw)
                if ok:
                    p = pack(cont(new, rid, k + 1), rid)
                    counters.append({'label': lab, 'response': p})
        if counters:
            out['counter'] = max(counters, key=lambda c: c['response']['score'])
        return out
    if trap == 'ogre':
        # effect resolves, then the activating card is destroyed (Ogre resolves first but the effect still resolves)
        src = d['src']
        if src == '지옥문' and '지옥문' not in after.st:
            return None
        s2 = destroy_card(after, src)
        if s2 is None:
            on_before = before.mon(src) or any(p['name'] == src for p in before.pz) or src in before.st
            if not on_before:
                return None
            return {'effect': f'{src}은(는) 이 효과로 어차피 파괴되는 카드라 영향 거의 없음(효과는 남은 대상에 처리)',
                    'response': pack(cont(after, rid, k + 1), rid)}
        extra = ()
        destroyed_kinds = s2.last_destroyed
        if E.zm_ready(s2) and src != '제로마키나' and (src in C.DDD or src in C.CONTRACTS):
            extra = ('제로마키나 특소(제로마키나 효과)',)
        cands = [pack(cont(s2, rid, k + 1), rid)]
        if extra:
            cands.append(pack(cont(s2, rid, k + 1, extra_first=extra), rid))
        out = {'effect': f'{src} 파괴(효과는 처리됨)', 'response': max(cands, key=lambda p: p['score'])}
        counters = []
        for lab, s in zeus_options(before):
            new, ok, _ = E.step(s, k, raw)
            if ok:
                counters.append({'label': lab, 'response': pack(cont(new, rid, k + 1), rid)})
        if counters:
            out['counter'] = max(counters, key=lambda c: c['response']['score'])
        return out
    if trap == 'droll':
        s2 = E.snap(after)
        s2.droll = True
        out = {'effect': '이후 덱→패 불가', 'response': pack(cont(s2, rid, k + 1), rid)}
        counters = []
        for lab, s in zeus_options(after):
            counters.append({'label': lab, 'response': pack(cont(s, rid, k + 1), rid)})
        if counters:
            out['counter'] = max(counters, key=lambda c: c['response']['score'])
        return out
    if trap == 'nibiru':
        s2 = tribute_all(after)
        out = {'effect': '필드 몬스터 전부 릴리스, 내 필드에 니비루 토큰', 'response': pack(cont(s2, rid, k + 1), rid)}
        counters = []
        for lab, s in zeus_options(after) + caesar_option(after):
            counters.append({'label': lab, 'response': pack(cont(s, rid, k + 1), rid)})
        if counters:
            out['counter'] = max(counters, key=lambda c: c['response']['score'])
        return out
    if trap == 'gyban':
        targets = [n for n in d.get('gyuse', []) if before.gy[n] > 0]
        if d['src'] == '클로비스' and before.ban[d.get('target', '')] > 0:
            targets = [n for n in targets if n != d.get('target')]
        if not targets:
            return None
        worst = None
        for t in sorted(set(targets)):
            s = E.snap(before)
            s.gy[t] -= 1
            s.ban[t] += 1
            p = pack(cont(s, rid, k), rid)
            if worst is None or p['score'] < worst[1]['score']:
                worst = (t, p)
        out = {'effect': f'묘지의 {worst[0]} 제외', 'target': worst[0], 'response': worst[1]}
        counters = []
        for lab, s in zeus_options(before) + caesar_option(before):
            counters.append({'label': lab, 'response': pack(cont(s, rid, k), rid)})
        if counters:
            out['counter'] = max(counters, key=lambda c: c['response']['score'])
        return out
    if trap in ('maxxc', 'fuwalos'):
        full = E.PREFIX[rid][-1]
        evs = [(i, sm) for (i, sm) in full.ss_events if i >= k]
        if trap == 'fuwalos':
            evs = [(i, [x for x in sm if x[1] in ('deck', 'ex', 'exup')]) for (i, sm) in evs]
            evs = [(i, sm) for (i, sm) in evs if sm]
        out = {'effect': f'이후 특소 {len(evs)}회 → 상대 {len(evs)}장 드로우',
               'draws': len(evs), 'draw_steps': [i for i, _ in evs],
               'stop_now': E.describe(before)}
        # droll variant (needs 드롤 in hand): let the opponent draw, then our Droll locks both players
        if evs:
            hv = list(E.STARTERS[rid]) + ['드롤']
            pre = E.prefix_states(rid, hv)
            opts = []
            for n_draw, (j, _) in enumerate(evs, 1):
                s = E.snap(pre[j])
                s.droll = True
                s.hand['드롤'] -= 1
                s.gy['드롤'] += 1
                fin, done, sk = E.run_steps(s, E.ROUTES[rid]['steps'][j:], offset=j + 1, label=rid)
                opts.append((n_draw, j, E.score(fin), s))
            full_score = E.score(E.PREFIX[rid][-1])
            best_sc = max(o[2] for o in opts)
            # earliest point that keeps the best reachable score
            pick = min([o for o in opts if o[2] >= best_sc - 1e-9], key=lambda o: o[0])
            early = opts[0]
            chosen = []
            for o in ([early] if early is not pick else []) + [pick]:
                n_draw, j, sc, s = o
                p = pack(cont(s, rid, j + 1), rid)
                chosen.append({'droll_after_step': j, 'opp_draws': n_draw, 'response': p})
            out['with_droll'] = chosen
        counters = []
        for lab, s in zeus_options(before):
            new, ok, _ = E.step(s, k, raw)
            if ok:
                fin, done, sk = E.run_steps(new, E.ROUTES[rid]['steps'][k:], offset=k + 1, label=rid)
                counters.append((E.score(fin), lab, s, new))
        if counters:
            sc, lab, s, new = max(counters, key=lambda c: c[0])
            out['counter'] = {'label': lab, 'response': pack(cont(new, rid, k + 1), rid)}
        return out
    return None


def applicable(rid, k):
    raw = E.ROUTES[rid]['steps'][k - 1]
    d = E.classify(raw)
    before, after = E.PREFIX[rid][k - 1], E.PREFIX[rid][k]
    traps = []
    if d['loc'] == 'opp':
        return d, traps
    if d['cats'] & {'search', 'ss_deck', 'send_deck'}:
        traps.append('ash')
    if 'search' in d['cats']:
        traps.append('droll')
    if d['loc'] == 'mon' and d['src'] and before.mon(d['src']):
        traps += ['imperm', 'veiler']
    if 'ss' in d['cats'] and d['loc'] != 'proc':
        traps.append('dominus')
    if d['loc'] in ('mon',) and d['src'] and before.mon(d['src']):
        traps.append('ogre')
    if d['loc'] in ('spell', 'pz') and d['src']:
        traps.append('ogre')
    gy_ss = 'gy_ss' in d['cats'] or (d['src'] == '클로비스' and before.ban[d.get('target', '')] == 0)
    if gy_ss or 'gy_banish' in d['cats']:
        traps.append('belle')
    if any(before.gy[n] > 0 for n in d.get('gyuse', [])):
        traps.append('gyban')
    if E.summons_of(before, after) and 'ns' not in d['cats']:
        traps += ['maxxc', 'fuwalos']
    if after.sums >= 5:
        traps.append('nibiru')
    return d, traps


def work(rid):
    rows = []
    steps = E.ROUTES[rid]['steps']
    first_gil = next((i for i, s in enumerate(steps, 1) if s.startswith('제우스')), 14)
    for k in range(1, len(steps) + 1):
        d, traps = applicable(rid, k)
        before, after = E.PREFIX[rid][k - 1], E.PREFIX[rid][k]
        for t in traps:
            ref, cond = doc_ref(rid, k, t, steps[k - 1])
            if t == 'nibiru' and rid in NIB_DOC and after.sums == 5:
                ref = '문서: 5체째 제우스 ②로 무효'
            row = {'route': rid, 'step': k, 'text': steps[k - 1], 'trap': t, 'trap_name': TRAPS[t][0],
                   'state': E.describe(before if t not in ('droll', 'nibiru') else after), 'summons_so_far': after.sums}
            if ref and rid in ref.replace('·', ' ').split():
                ref = f'이 루트({rid}) 자체가 이 상황의 대응 루트'
            if ref and not cond:
                row['documented'] = ref
                rows.append(row)
                continue
            r = simulate(rid, k, t, before, after)
            if r is None:
                continue
            row.update(r)
            if ref and cond:
                row['documented'] = f'패에 {cond}이(가) 있으면 문서 루트 {ref}'
            # extra-starter variants for early hits
            if k <= first_gil and t in ('ash', 'imperm', 'veiler', 'dominus', 'ogre', 'droll') and 'response' in r:
                vs = []
                for x in EXTRA_STARTERS:
                    hv = list(E.STARTERS[rid]) + [x]
                    if C.MAIN.get(x) and Counter(hv)[x] > C.MAIN[x][0]:
                        continue
                    pre = E.prefix_states(rid, hv)
                    try:
                        rv = simulate_variant(rid, k, t, pre[k - 1], pre[k])
                    except Exception as e:
                        rv = None
                    if rv and rv['score'] > r['response']['score'] + 0.5:
                        vs.append({'extra_in_hand': x, 'response': rv})
                if vs:
                    row['variants'] = vs
            rows.append(row)
    return rows


def simulate_variant(rid, k, t, before, after):
    """same as simulate but searching continuations from any route start (extra starter in hand)."""
    raw = E.ROUTES[rid]['steps'][k - 1]
    d = E.classify(raw)
    if t in ('ash', 'imperm', 'veiler', 'dominus'):
        ns = opt_diff_of(before, k, raw)
        if t in ('imperm', 'veiler') and d['src']:
            ns = neg_mon(ns, d['src'])
        st = ns
        fr = k + 1
    elif t == 'droll':
        st = E.snap(after)
        st.droll = True
        fr = k + 1
    elif t == 'ogre':
        st = destroy_card(after, d['src'])
        if st is None:
            return None
        fr = k + 1
    else:
        return None
    b = E.best_continuation(st, own=(rid, fr), topk=20)
    return pack(b, rid)


if __name__ == '__main__':
    rids = list(E.ROUTES)
    with Pool(2) as p:
        allrows = p.map(work, rids)
    rows = [r for rr in allrows for r in rr]
    json.dump(rows, open('hits.json', 'w'),
              ensure_ascii=False)
    print(len(rows), Counter(r['trap'] for r in rows))
