import json, sys
from collections import Counter
sys.path.insert(0, '.')
import engine as E
C = E.C


def pulls(rid):
    st = E.init_state(E.STARTERS[rid])
    st._pulled = []
    out = []
    for k, raw in enumerate(E.ROUTES[rid]['steps'], 1):
        before = len(getattr(st, '_pulled', []))
        new, ok, info = E.step(st, k, raw, strict=False)
        got = new._pulled[before:] if hasattr(new, '_pulled') else []
        for c in got:
            out.append({'step': k, 'card': c})
        st = new
    return out


if __name__ == '__main__':
    res = {}
    for rid in E.ROUTES:
        res[rid] = pulls(rid)
    json.dump(res, open('deckpulls.json', 'w'), ensure_ascii=False, indent=0)
    for rid in ['A1', 'B1', 'A2']:
        print(rid, [(p['step'], p['card']) for p in res[rid]])
