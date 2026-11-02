"""Plan library: every verified line (29 originals + hand-adjusted ones) with the exact
hand cards it needs and the deck cards it pulls. A plan is usable for a hand H iff
needs <= H and pulls <= DECK - H (per card). This check is conservative."""
import json, sys
from collections import Counter
sys.path.insert(0, '.')
import engine as E
C = E.C
ADJ = json.load(open('hand-adjust.json'))
DECK = {k: v[0] for k, v in C.MAIN.items()}
DECK.update(C.CONTRACTS)


def trace(steps, hand):
    st = E.init_state(hand)
    st._pulled = []
    for k, raw in enumerate(steps, 1):
        raw = raw.replace(' (대체)', '').replace(' (추가)', '')
        strict = not (raw.startswith('[상대]') or raw.startswith('내 드롤') or '니비루 무효' in raw)
        new, ok, info = E.step(st, k, raw, strict=strict)
        if not ok:
            return None
        st = new
    return Counter(getattr(st, '_pulled', [])), st


plans = []
seen = set()
def add(pid, label, steps, hand, final=None):
    key = (tuple(steps), tuple(sorted(hand)))
    if key in seen:
        return
    r = trace(steps, hand)
    if r is None:
        print('FAIL', pid); return
    pulls, st = r
    seen.add(key)
    plans.append({'id': pid, 'label': label, 'needs_in_hand': dict(Counter(hand)), 'deck_pulls': dict(pulls),
                  'steps': steps, 'final_score': E.score(st), 'final_monsters': [m['name'] for m in st.field]})

for rid, r in E.ROUTES.items():
    add(rid, f"{rid} {r['title']}", r['orig'] if False else r['steps'], E.STARTERS[rid])
for rid, v in ADJ.items():
    if rid.startswith('_'):
        continue
    for j, c in enumerate(v['conflicts']):
        p = c['adjusted_plan']
        lab = f"{rid} 수정({', '.join(f'{k} {n}장' for k, n in c['cards_in_hand'].items())} 패에 있음)"
        add(f"{rid}~{j}", lab, p['steps'], c['hand_used'])
json.dump(plans, open('planlib.json', 'w'), ensure_ascii=False)
print(len(plans))
