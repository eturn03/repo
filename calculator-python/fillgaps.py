import json, random, sys
from collections import Counter
from multiprocessing import Pool
sys.path.insert(0, '.')
import engine as E
C = E.C
plans = json.load(open('planlib.json'))
DECK = {k: v[0] for k, v in C.MAIN.items()}; DECK.update(C.CONTRACTS)
DECK40 = {'드롤': 2, '네크로': 1, '증G': 1, '랜스': 1, '우라라': 3, '후와로스': 3, '케플러': 3, '스케일': 2, '코페르': 1, '오르트로스': 1,
          '그리폰': 2, '토마스': 1, '카운트': 1, '제로마키나': 3, '다크오컬티즘': 1, '스몰월드': 2, '지옥문': 3, '령왕': 1, '말살': 1,
          '무한포영': 3, '도미나스': 3, '상암': 1}
pool = [k for k, v in DECK40.items() for _ in range(v)]
MODEL = set(C.MAIN) | set(C.CONTRACTS)


def usable(p, h):
    if any(h[c] < n for c, n in p['needs_in_hand'].items()):
        return False
    return all(p['deck_pulls'].get(c, 0) <= DECK[c] - h[c] for c in p['deck_pulls'])


def solve(mh):
    st = E.init_state(mh)
    best = None
    for rid in E.ROUTES:
        if any(Counter(mh)[c] < n for c, n in Counter(E.STARTERS[rid]).items()):
            continue
        b = E.best_continuation(st, own=(rid, 1), topk=29)
        if best is None or b['score'] > best['score']:
            best = b
    if best is None:
        # no route's starters in hand: try all starts anyway
        for rid in E.ROUTES:
            b = E.best_continuation(st, own=(rid, 1), topk=10)
            if best is None or b['score'] > best['score']:
                best = b
    return mh, best['route'], [x[2] for x in best['done']], best['score']


if __name__ == '__main__':
    random.seed(7)
    gaps = {}
    for size in (5, 6):
        for n in range(15000):
            hand = random.sample(pool, size)
            mh = sorted(x for x in hand if x in MODEL)
            h = Counter(mh)
            if not any(h[x] for x in ('케플러', '지옥문', '제로마키나')):
                continue
            if not any(usable(p, h) for p in plans):
                gaps[tuple(mh)] = 1
    print('gap hand types', len(gaps))
    with Pool(2) as p:
        res = p.map(solve, [list(g) for g in gaps])
    from planlib import trace
    added = 0
    for mh, rid, steps, sc in res:
        r = trace(steps, mh)
        if r is None:
            print('trace fail', mh); continue
        pulls, st = r
        plans.append({'id': f'H{added}', 'label': f"{rid} 기반 수정(패: {', '.join(mh)})", 'needs_in_hand': dict(Counter(mh)),
                      'deck_pulls': dict(pulls), 'steps': steps, 'final_score': E.score(st), 'final_monsters': [m['name'] for m in st.field]})
        added += 1
    json.dump(plans, open('planlib.json', 'w'), ensure_ascii=False)
    print('added', added, 'total', len(plans))
    for mh, rid, steps, sc in res[:8]:
        print(mh, rid, sc)
