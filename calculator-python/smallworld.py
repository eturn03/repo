import json, random, sys, itertools
from collections import Counter
sys.path.insert(0, '.')
import engine as E
C = E.C
STATS = {"케플러": ("Fiend", "DARK", 1, 0, 0), "코페르": ("Fiend", "DARK", 4, 0, 0), "토마스": ("Fiend", "DARK", 8, 1800, 2600),
         "오르트로스": ("Fiend", "DARK", 4, 600, 1800), "카운트": ("Fiend", "DARK", 8, 2000, 2000), "그리폰": ("Fiend", "DARK", 4, 1200, 1200),
         "스케일": ("Fiend", "DARK", 2, 0, 1000), "제로마키나": ("Fiend", "DARK", 8, 3000, 0), "네크로": ("Fiend", "DARK", 1, 300, 300),
         "랜스": ("Fiend", "DARK", 2, 400, 400), "우라라": ("Zombie", "FIRE", 3, 0, 1800), "후와로스": ("Winged Beast", "WIND", 4, 100, 600),
         "증G": ("Insect", "EARTH", 2, 500, 200), "드롤": ("Spellcaster", "WIND", 1, 0, 0)}
DECK40 = {'드롤': 2, '네크로': 1, '증G': 1, '랜스': 1, '우라라': 3, '후와로스': 3, '케플러': 3, '스케일': 2, '코페르': 1, '오르트로스': 1,
          '그리폰': 2, '토마스': 1, '카운트': 1, '제로마키나': 3, '다크오컬티즘': 1, '스몰월드': 2, '지옥문': 3, '령왕': 1, '말살': 1,
          '무한포영': 3, '도미나스': 3, '상암': 1}


def one(a, b):
    return sum(x == y for x, y in zip(STATS[a], STATS[b])) == 1


TRIPLES = [(r, b, t) for r in STATS for b in STATS for t in STATS if r != b and b != t and one(r, b) and one(b, t)]
plans = json.load(open('planlib.json'))
DECKM = {k: v[0] for k, v in C.MAIN.items()}; DECKM.update(C.CONTRACTS)
MODEL = set(C.MAIN) | set(C.CONTRACTS)


def usable(p, h, banished=Counter()):
    if any(h[c] < n for c, n in p['needs_in_hand'].items()):
        return False
    return all(p['deck_pulls'].get(c, 0) <= DECKM[c] - h[c] - banished[c] for c in p['deck_pulls'])


def best_for(hand):
    """hand: full list incl. non-modeled cards. returns (score, plan, sw_choice)"""
    h = Counter(hand)
    hm = Counter({k: v for k, v in h.items() if k in MODEL})
    cands = [(p['final_score'], p, None) for p in plans if usable(p, hm) and not any(s.startswith('[상대]') for s in p['steps'])]
    if h['스몰월드']:
        for r, b, t in TRIPLES:
            if h[r] < 1:
                continue
            if DECK40[b] - h[b] < 1:
                continue
            if DECK40[t] - h[t] - (1 if t == b else 0) < 1:
                continue
            h2 = h.copy(); h2[r] -= 1; h2['스몰월드'] -= 1; h2[t] += 1
            hm2 = Counter({k: v for k, v in h2.items() if k in MODEL and v > 0})
            ban = Counter({b: 1})
            for p in plans:
                if any(s.startswith('[상대]') for s in p['steps']):
                    continue
                if usable(p, hm2, ban):
                    cands.append((p['final_score'], p, (r, b, t)))
    if not cands:
        return None
    return max(cands, key=lambda x: (x[0], x[2] is None))


if __name__ == '__main__':
    pool = [k for k, v in DECK40.items() for _ in range(v)]
    random.seed(99)
    st = Counter()
    for size in (5, 6):
        for n in range(4000):
            hand = random.sample(pool, size)
            h = Counter(hand)
            starter = any(h[x] for x in ('케플러', '지옥문', '제로마키나'))
            sw = h['스몰월드'] > 0
            res = best_for(hand)
            key = ('이니시O' if starter else '이니시X') + ('+스몰월드' if sw else '')
            st[key + ' 패'] += 1
            if res:
                st[key + ' 수순있음'] += 1
                if res[2]:
                    st[key + ' 스몰월드로 더 좋아짐/가능해짐'] += 1
    for k in sorted(st):
        print(k, st[k])
    print(len(TRIPLES), 'triples')
    print([t for t in TRIPLES if t[2] in ('케플러', '제로마키나')][:40])
