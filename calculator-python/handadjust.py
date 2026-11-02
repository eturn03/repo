import json, sys, itertools
from collections import Counter
from multiprocessing import Pool
sys.path.insert(0, '.')
import engine as E
C = E.C
PULLS = json.load(open('deckpulls.json'))
DECK = {k: v[0] for k, v in C.MAIN.items() if k != '드롤'}
DECK.update(C.CONTRACTS)
NAMEFIX = {'아크크라이시스': '아크 크라이시스', '니비루토큰': '니비루 토큰'}


def nm(x):
    for a, b in NAMEFIX.items():
        x = x.replace(a, b)
    return x


def fin(d):
    mons = [nm(m.replace('(무효)', '')) for m in d['monsters']]
    return {'monsters': mons, 'contracts': d['contracts'], 'pzones': d['pzones'],
            'zero_machinex_waiting_in_extra': d['zm_ready'], 'interruptions': d['interruptions'], 'score': d['score']}


def strict_breaks(rid, hand):
    st = E.init_state(hand)
    broken = []
    for k, raw in enumerate(E.ROUTES[rid]['steps'], 1):
        if raw.startswith('[상대]') or raw.startswith('내 드롤') or '니비루 무효' in raw:
            new, ok, info = E.step(st, k, raw, strict=False)
            st = new
            continue
        new, ok, info = E.step(st, k, raw)
        if not ok:
            broken.append({'step': k, 'text': nm(E.ROUTES[rid]['orig'][k - 1]), 'why': info[0][1] if info else ''})
            if len(broken) >= 3:
                break
            continue
        st = new
    return broken


def adapt(rid, hand):
    st = E.init_state(hand)
    b = E.best_continuation(st, own=(rid, 1), topk=29)
    return {'base_route': b['route'], 'steps': [nm(x[2]) for x in b['done']],
            'skipped_original_steps': [{'step': x[1], 'text': nm(E.ROUTES[b['route']]['orig'][x[1] - 1]), 'why': x[3]} for x in b['skipped']],
            'final': fin(E.describe(b['state']))}


def conflicts_for(rid):
    starters = Counter(E.STARTERS[rid])
    need = Counter(p['card'] for p in PULLS[rid])
    first_step = {}
    for p in PULLS[rid]:
        first_step.setdefault(p['card'], p['step'])
    cards = {}
    for c, n in need.items():
        if c not in DECK:
            continue
        hmin = max(1, DECK[c] - n + 1)
        if hmin <= DECK[c]:
            cards[c] = hmin
    out = []
    singles = [((c, h),) for c in cards for h in range(cards[c], DECK[c] + 1)]
    pairs = []
    for a, b in itertools.combinations(sorted(cards), 2):
        for ha in range(cards[a], DECK[a] + 1):
            for hb in range(cards[b], DECK[b] + 1):
                pairs.append(((a, ha), (b, hb)))
    for combo in [x[0:1] if len(x) == 1 else x for x in [s_ for s_ in singles] + pairs]:
        cs = combo if isinstance(combo[0], tuple) else (combo,)
        hand = list(E.STARTERS[rid])
        for c, h in cs:
            extra = h - starters[c]
            if extra > 0:
                hand += [c] * extra
        if len(hand) > 6:
            continue
        broken = strict_breaks(rid, hand)
        if not broken:
            continue
        out.append({'cards_in_hand': {c: h for c, h in cs}, 'hand_used': hand, 'first_broken_steps': broken,
                    'adjusted_plan': adapt(rid, hand)})
    base = E.describe(E.PREFIX[rid][-1])
    return rid, {'deck_pulls': [{'step': p['step'], 'card': p['card']} for p in PULLS[rid]],
                 'conflict_threshold': cards, 'normal_final': fin(base), 'conflicts': out}


if __name__ == '__main__':
    with Pool(2) as p:
        res = dict(p.map(conflicts_for, list(E.ROUTES)))
    json.dump(res, open('hand-adjust.json', 'w'), ensure_ascii=False, indent=1)
    print(sum(len(v['conflicts']) for v in res.values()))
    for c in res['A1']['conflicts'][:3]:
        print(c['cards_in_hand'], c['first_broken_steps'][0]['text'], '→', c['adjusted_plan']['base_route'], c['adjusted_plan']['final']['monsters'])
