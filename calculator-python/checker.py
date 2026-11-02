"""Independent rule checker for the DD4 routes in the doc's second tab.

Models card locations, normal summon, once-per-turn usage, summon restrictions,
pendulum scales, material levels/ranks and Droll's deck->hand lock.
Monster zone placement (link arrows) is NOT modelled; only a total count check.
"""
import re, sys, json
from collections import Counter

S = '.'

# ---------------- card data (from official KR text / YGOPRODeck stats) -------------
MAIN = {  # name: (count, kind, level, scale, tuner, atk, def)
    '케플러': (3, 'P', 1, 10, False, 0, 0),
    '코페르': (1, 'P', 4, 1, False, 0, 0),
    '토마스': (1, 'P', 8, 6, False, 1800, 2600),
    '오르트로스': (1, 'P', 4, 3, True, 600, 1800),
    '카운트': (1, 'P', 8, 1, False, 2000, 2000),
    '그리폰': (2, 'P', 4, 1, False, 1200, 1200),
    '스케일': (2, 'P', 2, 9, False, 0, 1000),
    '제로마키나': (3, 'P', 8, 0, False, 3000, 0),
    '네크로': (1, 'M', 1, None, False, 300, 300),
    '랜스': (1, 'M', 2, None, True, 400, 400),
}
CONTRACTS = {'지옥문': 3, '령왕': 1, '상암': 1}
DDD = {'제로마키나', '테무진', '알프레드', '아크크라이시스', '클로비스', '사이프리트', '시져', '솔로몬', '텔', '대왕시져',
       '데스마키나', '빌가메스', '제우스'}
EX = {  # name: (count, kind, level/rank/link)
    '테무진': (1, 'F', 6), '알프레드': (1, 'F', 6), '아크크라이시스': (1, 'FP', 12), '클로비스': (1, 'S', 6),
    '사이프리트': (1, 'S', 8), '시져': (1, 'X', 4), '솔로몬': (1, 'X', 4), '텔': (1, 'X', 5), '대왕시져': (1, 'X', 6),
    '데스마키나': (2, 'XP', 10), '빌가메스': (2, 'L', 2), '비욘드': (1, 'L', 2), '제우스': (1, 'L', 3),
}
ALL_NAMES = sorted(list(MAIN) + list(CONTRACTS) + list(EX), key=len, reverse=True)


def norm(s):
    s = s.replace('아크 크라이시스', '아크크라이시스').replace('①', '').replace('②', '').replace('③', '')
    s = s.replace(' (', '(').replace('( ', '(')
    return s.strip()


def names_in(s):
    out = []
    tmp = s
    for n in ALL_NAMES:
        while n in tmp:
            i = tmp.index(n)
            out.append((i, n))
            tmp = tmp[:i] + '＿' * len(n) + tmp[i + len(n):]
    return [n for _, n in sorted(out)]


class State:
    def __init__(self, hand):
        self.deck = Counter({k: v[0] for k, v in MAIN.items()})
        self.deck.update(CONTRACTS)
        self.ex = Counter({k: v[0] for k, v in EX.items()})
        self.hand = Counter()
        for h in hand:
            self.deck[h] -= 1
            self.hand[h] += 1
        self.field = []  # monsters: dict(name, lvl, mats, own_lance)
        self.pz = []  # pendulum zones: dict(name, activated)
        self.st = []  # face-up contracts
        self.gy = Counter()
        self.ban = Counter()
        self.exup = Counter()
        self.ns = 0
        self.opt = Counter()
        self.dmg = False
        self.droll = False
        self.ddonly = False
        self.ps_count = 0
        self.ps_allow = 1
        self.zeus1 = 0
        self.neg = set()  # names whose next effect is negated
        self.issues = []
        self.last_destroyed = []  # cards destroyed in the previous step (for ZM trigger)
        self.choices = []
        self.nchoice = 0

    def pick(self, k):
        c = self.choices[self.nchoice] if self.nchoice < len(self.choices) else 0
        self.nchoice += 1
        return c % max(k, 1)

    # ---- helpers
    def issue(self, step, msg):
        self.issues.append((step, msg))

    def mon(self, name):
        for m in self.field:
            if m['name'] == name:
                return m
        return None

    def take_opt(self, step, key, limit=1):
        self.opt[key] += 1
        if self.opt[key] > limit:
            self.issue(step, f'1턴 제약 초과: {key} ({self.opt[key]}회째)')

    def leave_field_mon(self, step, m, dest):
        """monster leaves field to dest ('gy','ban','hand','deck','ex')"""
        self.field.remove(m)
        n = m['name']
        for mat in m.get('mats', []):  # xyz materials go to GY
            self.gy[mat] += 1
        if m.get('own_lance'):
            dest = 'ban'
        if dest == 'gy':
            if n in MAIN and MAIN[n][1] == 'P':
                self.exup[n] += 1
            elif n in EX and 'P' in EX[n][1]:
                self.exup[n] += 1
            elif n in EX:
                self.gy[n] += 1
            else:
                self.gy[n] += 1
        elif dest == 'ban':
            self.ban[n] += 1
        elif dest == 'hand':
            if n in EX:
                self.ex[n] += 1  # extra deck monster returns to extra deck
            else:
                self.hand[n] += 1
        elif dest == 'deck':
            if n in EX:
                self.ex[n] += 1
            else:
                self.deck[n] += 1
        elif dest == 'ex_mat':  # used as link/synchro/fusion material -> GY (pendulums -> face-up extra)
            self.leave_field_mon(step, {'name': n, 'mats': [], 'own_lance': False}, 'gy') if False else None
        return dest

    def material_out(self, step, n):
        """remove monster n from field as material (link/synchro/fusion-from-field) -> GY rules"""
        m = self.mon(n)
        if not m:
            self.issue(step, f'소재 {n}이(가) 필드에 없음')
            return None
        self.leave_field_mon(step, m, 'gy')
        return m

    def destroy(self, step, n):
        """destroy card n on field (monster, P zone or contract)."""
        for p in self.pz:
            if p['name'] == n:
                self.pz.remove(p)
                self.exup[n] += 1
                self.last_destroyed.append(('P', n))
                return True
        if n in self.st:
            self.st.remove(n)
            self.gy[n] += 1
            self.last_destroyed.append(('C', n))
            return True
        m = self.mon(n)
        if m:
            self.leave_field_mon(step, m, 'gy')
            self.last_destroyed.append(('M', n))
            return True
        self.issue(step, f'파괴 대상 {n}이(가) 필드에 없음')
        return False

    def from_loc(self, step, n, locs):
        for loc in locs:
            c = getattr(self, loc)
            if c[n] > 0:
                c[n] -= 1
                return loc
        self.issue(step, f'{n}을(를) {"/".join(locs)}에서 찾을 수 없음')
        return None

    def summon(self, step, n, lvl=None, own_lance=False, src=None):
        base = MAIN.get(n, (0, '', None))[2] if n in MAIN else EX.get(n, (0, '', None))[2]
        if self.ddonly and not (n in MAIN or n in EX) and n != '비욘드':
            self.issue(step, f'DD만 특소 제약 중 {n} 특소')
        if self.ddonly and n == '비욘드':
            self.issue(step, '령왕/빌가메스 제약 중 비욘드(마법사족) 특소 불가')
        self.field.append({'name': n, 'lvl': lvl if lvl is not None else base, 'mats': [], 'own_lance': own_lance})
        if len(self.field) > 6:
            self.issue(step, f'몬스터 {len(self.field)}체: 메인 5 + EX 1 초과 가능성')


def lvl_of(st, n):
    m = st.mon(n)
    return m['lvl'] if m else None


# ---------------- step handlers -------------------------------------------------------
def run(route_id, hand, steps, choices=()):
    st = State(hand)
    st.choices = list(choices)
    for i, raw in enumerate(steps, 1):
        s = norm(raw)
        destroyed_before = list(st.last_destroyed)
        st.last_destroyed = []
        handled = handle(st, i, s, destroyed_before)
        if not handled:
            st.issue(i, f'[해석 못함] {raw}')
    return st


def ns(st, i, n):
    if st.from_loc(i, n, ['hand']) is None:
        return
    st.ns += 1
    if st.ns > 1:
        st.issue(i, '일반소환 2회')
    st.summon(i, n)


def search(st, i, x, src):
    if st.droll:
        st.issue(i, f'드롤 적용 중 덱→패 서치({x})')
    loc = st.from_loc(i, x, ['deck'])
    if loc:
        st.hand[x] += 1
    key = {'케플러': '케플러몬', '지옥문': '지옥문', '카운트': '카운트2', '솔로몬': '솔로몬', '그리폰': '그리폰3',
           '시져': None, '대왕시져': None}.get(src, src)
    if src == '케플러':
        if x not in CONTRACTS:
            st.issue(i, f'케플러는 계약서만 서치 가능({x})')
        if not st.mon('케플러'):
            st.issue(i, '케플러가 필드에 없음')
    if src == '지옥문':
        if '지옥문' not in st.st and st.hand['지옥문'] > 0:
            st.hand['지옥문'] -= 1
            st.st.append('지옥문')  # activate from hand
        if x not in MAIN:
            st.issue(i, f'지옥문은 DD 몬스터만 서치({x})')
        if '지옥문' not in st.st:
            st.issue(i, '지옥문이 앞면으로 없음')
    if src == '카운트':
        if not st.mon('카운트'):
            st.issue(i, '카운트가 필드에 없음')
        if x not in MAIN or (MAIN[x][5] != 0 and MAIN[x][6] != 0):
            st.issue(i, f'카운트는 공/수 0 DD 몬스터만 서치({x})')
    if src == '솔로몬':
        m = st.mon('솔로몬')
        if not m or not m['mats']:
            st.issue(i, '솔로몬 소재 없음')
        else:
            j = st.pick(len(m['mats']))
            st.gy[m['mats'].pop(j)] += 1
    if src == '시져':
        if x not in CONTRACTS:
            st.issue(i, '시져 ②는 계약서만')
    if key:
        st.take_opt(i, key)


def handle(st, i, s, destroyed_before):
    m = None
    # opponent / misc annotations
    if s.startswith('[상대]'):
        if '드롤' in s:
            st.droll = True
        if '빌가메스 효과 무효' in s:
            st.neg.add('빌가메스')
        if '령왕 효과 무효' in s:
            st.neg.add('령왕')
        return True
    if s.startswith('내 드롤 발동'):
        st.from_loc(i, '드롤', ['hand']) if st.hand['드롤'] else None
        return True
    if '니비루 무효(제우스 효과)' in s:
        for n in names_in(s.split('→')[0]):
            if st.from_loc(i, n, ['gy']):
                st.ban[n] += 1
        st.take_opt(i, '제우스2')
        return True
    if s.startswith('빌가메스 효과로 스케일 포함'):
        # D5 annotated omitted step: assume 스케일 + 토마스 placed
        for c in ('제로마키나', '스케일'):
            st.pz += [{'name': c, 'activated': False}]
            st.from_loc(i, c, ['deck'])
        st.take_opt(i, '빌가메스1')
        st.dmg = True
        return True

    # normal summon (+ optional inline search)
    m = re.match(r'^(\S+) 일반소환(?:: (\S+) 서치)?$', s)
    if m:
        ns(st, i, m.group(1))
        if m.group(2):
            search(st, i, m.group(2), m.group(1))
        return True
    m = re.match(r'^(\S+) 서치[:(]\s*(\S+) 효과\)?$', s)
    if m:
        search(st, i, m.group(1), m.group(2))
        return True
    # P zone placement from Gilgamesh (with damage)
    m = re.match(r'^(.+?) P존 세팅\(자신 1000 데미지\)$', s)
    if m:
        cards = names_in(m.group(1))
        if '빌가메스' in st.neg:
            st.issue(i, '무효된 빌가메스 효과 사용')
        if not st.mon('빌가메스'):
            st.issue(i, '빌가메스가 필드에 없음')
        st.take_opt(i, '빌가메스1')
        if len(set(cards)) != 2:
            st.issue(i, f'빌가메스는 이름 다른 2장: {cards}')
        for c in cards:
            if st.from_loc(i, c, ['deck']):
                st.pz.append({'name': c, 'activated': False})
        if len(st.pz) > 2:
            st.issue(i, f'P존 {len(st.pz)}장(2장 초과)')
        st.dmg = True
        st.ddonly = True
        return True
    m = re.match(r'^(?:(\S+) P존 재발동 → )?(\S+) P존 세팅$', s)
    if m:
        n = m.group(2) if not m.group(1) else m.group(1)
        if st.from_loc(i, n, ['hand']):
            st.pz.append({'name': n, 'activated': True})
        if len(st.pz) > 2:
            st.issue(i, f'P존 {len(st.pz)}장(2장 초과)')
        return True
    m = re.match(r'^(\S+) P존 재발동 → (\S+) 놓기\(제로마키나 효과\)$', s)
    if m:
        if st.from_loc(i, '제로마키나', ['hand']):
            st.pz.append({'name': '제로마키나', 'activated': True})
        return handle(st, i, f'{m.group(2)} 놓기(제로마키나 효과)', destroyed_before)
    if s.startswith('P존에 놓기(제로마키나 효과)'):
        if not any(k == 'M' and n == '제로마키나' for k, n in destroyed_before):
            st.issue(i, '제로마키나 ②: 직전에 몬스터존에서 파괴되지 않음')
        st.take_opt(i, '제로마키나2')
        if st.from_loc(i, '제로마키나', ['exup']):
            st.pz.append({'name': '제로마키나', 'activated': False})
        if len(st.pz) > 2:
            st.issue(i, f'P존 {len(st.pz)}장(2장 초과)')
        return True
    # contracts placed
    m = re.match(r'^(\S+) 놓기[:(]\s*(\S+) 효과\)?$', s)
    if m:
        targets = names_in(m.group(1))
        src = m.group(2)
        if src == '제로마키나':
            zm = [p for p in st.pz if p['name'] == '제로마키나']
            if not zm:
                st.issue(i, '제로마키나가 P존에 없음')
            elif not zm[0]['activated']:
                st.issue(i, '제로마키나 P효과: 발동한 턴이 아님(효과로 놓인 상태)')
            st.take_opt(i, '제로마키나P')
            for t in targets:
                if st.from_loc(i, t, ['deck']):
                    st.st.append(t)
        elif src == '알프레드':
            if not st.ban['알프레드']:
                st.issue(i, '알프레드가 제외되지 않음(②조건)')
            st.take_opt(i, '알프레드2')
            n_ddd = sum(1 for x in st.field if x['name'] in DDD)
            if len(targets) > n_ddd:
                st.issue(i, f'알프레드 ②: 놓는 수 {len(targets)} > 필드 DDD {n_ddd}')
            for t in targets:
                if st.from_loc(i, t, ['gy', 'ban']):
                    st.st.append(t)
        else:
            st.issue(i, f'놓기 출처 미지원 {src}')
        return True
    m = re.match(r'^(\S+) 놓기$', s)
    if m:  # sim log variant: alfred placement without source
        t = m.group(1)
        if st.from_loc(i, t, ['gy', 'ban']):
            st.st.append(t)
        st.take_opt(i, '알프레드2')
        return True
    # 령왕: "X 특소(령왕 효과: Z 파괴)" or "Z 파괴 → X 특소(령왕 효과)"
    m = re.match(r'^(\S+) 특소\(령왕 효과(?:: (.+?))?\)$', s)
    m2 = re.match(r'^(\S+) 파괴 → (\S+) 특소\(령왕 효과\)$', s)
    if m or m2:
        x = m.group(1) if m else m2.group(2)
        z = (m.group(2) if m else m2.group(1)) or ''
        zz = names_in(z)
        if '원문 표기는' in s:
            zz = ['제로마키나']
            st.issue(i, '원문 표기 오류 추정 단계(카운트 파괴→제로마키나 파괴로 처리)')
        if '령왕' not in st.st and st.hand['령왕'] > 0:
            st.hand['령왕'] -= 1
            st.st.append('령왕')
        if '령왕' not in st.st:
            st.issue(i, '령왕이 앞면으로 없음')
        if '령왕' in st.neg:
            st.issue(i, '무효된 령왕 사용')
        st.take_opt(i, '령왕')
        for t in zz:
            st.destroy(i, t)
        if st.from_loc(i, x, ['deck']):
            st.summon(i, x)
        st.ddonly = True
        on_summon(st, i, x)
        return True
    # Lance self revive
    m = re.match(r'^랜스 특소\s*\(랜스 효과: (\S+) 파괴\)$', s) or re.match(r'^랜스 특소\s*\((\S+) 파괴\)$', s)
    if m:
        z = m.group(1)
        if z not in st.st:
            st.issue(i, f'랜스 ②: {z}이(가) 내 필드 계약서가 아님')
        st.take_opt(i, '랜스2')
        st.destroy(i, z)
        if st.from_loc(i, '랜스', ['gy']):
            st.summon(i, '랜스', own_lance=True)
        return True
    # Thomas monster effect
    m = re.match(r'^(\S+) 특소\(토마스 효과: (\S+) 파괴\)$', s)
    if m:
        x, z = m.group(1), m.group(2)
        if not st.mon('토마스'):
            st.issue(i, '토마스가 몬스터로 필드에 없음')
        st.take_opt(i, '토마스몬')
        st.destroy(i, z)
        if st.from_loc(i, x, ['deck']):
            st.summon(i, x)
        if not (x in DDD and (MAIN.get(x, (0, 0, 0))[2] == 8)):
            st.issue(i, f'토마스: 레벨8 DDD만({x})')
        return True
    # Zero Machinex trigger
    m = re.match(r'^제로마키나 특소( 후 자괴)?\s*\(제로마키나 효과\)$', s)
    if m:
        ok = any((k in ('C',) or (k in ('P', 'M') and n in DDD and n != '제로마키나')) for k, n in destroyed_before)
        if not ok:
            st.issue(i, f'제로마키나 ① 트리거 불명(직전 파괴: {destroyed_before})')
        st.take_opt(i, '제로마키나1')
        if st.from_loc(i, '제로마키나', ['exup']):
            st.summon(i, '제로마키나')
        if m.group(1):
            st.destroy(i, '제로마키나')
            st.last_destroyed = [('M', '제로마키나')]
        return True
    if s.startswith('P존에 놓기(제로마키나 효과)'):
        if not any(k == 'M' and n == '제로마키나' for k, n in destroyed_before):
            st.issue(i, '제로마키나 ②: 직전에 몬스터존에서 파괴되지 않음')
        st.take_opt(i, '제로마키나2')
        if st.from_loc(i, '제로마키나', ['exup']):
            st.pz.append({'name': '제로마키나', 'activated': False})
        if len(st.pz) > 2:
            st.issue(i, f'P존 {len(st.pz)}장(2장 초과)')
        return True
    # Scale / Gryphon from hand
    m = re.match(r'^(스케일|그리폰) 특소\s*\(\1 효과\)$', s)
    if m:
        x = m.group(1)
        if x == '스케일':
            if not (any(p['name'] in MAIN for p in st.pz) or any(mm['name'] in MAIN and MAIN[mm['name']][1] == 'P' for mm in st.field)
                    or any(mm['name'] in EX and 'P' in EX[mm['name']][1] for mm in st.field)):
                st.issue(i, '스케일 ①: 필드에 DD 펜듈럼 카드 없음')
            st.take_opt(i, '스케일1')
        else:
            if not st.field:
                st.issue(i, '그리폰 ①: DD 몬스터 없음')
            st.take_opt(i, '그리폰1')
        if st.from_loc(i, x, ['hand']):
            st.summon(i, x)
        on_summon(st, i, x, ss=True)
        return True
    # revive
    m = re.match(r'^(\S+) (?:소생|특소)\s*\((테무진|클로비스) 효과\)$', s)
    if m:
        x, src = m.group(1), m.group(2)
        if not st.mon(src):
            st.issue(i, f'{src}이(가) 필드에 없음')
        st.take_opt(i, src + '1')
        locs = ['gy'] if src == '테무진' else ['ban', 'gy']
        if src == '클로비스' and not st.st and st.ban[x] == 0:
            st.issue(i, '클로비스: 계약서가 없어 묘지 대상 불가')
        loc = st.from_loc(i, x, locs)
        if loc:
            st.summon(i, x)
            if x == '그리폰' and loc == 'gy':
                pass
        on_summon(st, i, x, ss=True)
        return True
    # extra deck summons
    m = re.match(r'^(\S+) (링크|엑시즈|싱크로|융합|특소)\s*\((.+?)\)$', s)
    if m and m.group(1) in EX:
        return ex_summon(st, i, m.group(1), m.group(2), m.group(3))
    m = re.match(r'^(\S+?)\((.+)\)$', s)  # bare "제우스(빌가메스+제로마키나)" style
    if m and m.group(1) in EX:
        k = EX[m.group(1)][1]
        kind = {'L': '링크', 'X': '엑시즈', 'XP': '엑시즈', 'S': '싱크로', 'F': '융합', 'FP': '융합'}[k]
        return ex_summon(st, i, m.group(1), kind, m.group(2))
    m = re.match(r'^(아크크라이시스) 특소$', s)
    if m:
        return True  # sim duplicate log line
    # send to GY from deck
    m = re.match(r'^(\S+) 묘지로\s*\((코페르|텔) 효과\)$', s) or re.match(r'^(\S+) 묘지로$', s)
    if m:
        x = m.group(1)
        src = m.group(2) if m.lastindex and m.lastindex >= 2 else None
        if src is None:
            st.issue(i, f'출처 없는 덤프 줄({x}) — 원본 로그 중복 가능')
            return True
        if src == '코페르':
            st.take_opt(i, '코페르')
        else:
            if not st.gy['텔'] and not st.exup.get('텔'):
                st.issue(i, '텔이 묘지에 없는데 텔 ② 사용')
        if st.from_loc(i, x, ['deck']):
            st.gy[x] += 1
        return True
    # Thomas P: recover face-up pendulum from extra deck
    m = re.match(r'^(\S+) 회수\(토마스 효과\)$', s)
    if m:
        if not any(p['name'] == '토마스' for p in st.pz):
            st.issue(i, '토마스가 P존에 없음')
        st.take_opt(i, '토마스P')
        if st.from_loc(i, m.group(1), ['exup']):
            st.hand[m.group(1)] += 1
        return True
    # bounces by Scale ③
    m = re.match(r'^(\S+) (?:바운스|패로 되돌림)\((스케일|케플러) 효과\)$', s)
    if m:
        x, src = m.group(1), m.group(2)
        if src == '스케일':
            st.take_opt(i, '스케일3')
        else:
            st.take_opt(i, '케플러몬')
        found = False
        for p in st.pz:
            if p['name'] == x:
                st.pz.remove(p)
                st.hand[x] += 1
                found = True
                break
        if not found:
            mm = st.mon(x)
            if mm:
                st.leave_field_mon(i, mm, 'hand')
                found = True
        if not found:
            st.issue(i, f'바운스 대상 {x}이(가) 필드에 없음')
        return True
    # pendulum summon
    m = re.match(r'^(.+?) ?P소환$', s)
    if m:
        cards = names_in(m.group(1))
        st.ps_count += 1
        if st.ps_count > st.ps_allow:
            st.issue(i, f'펜듈럼 소환 {st.ps_count}회째(허용 {st.ps_allow})')
        if len(st.pz) != 2:
            st.issue(i, f'P존 {len(st.pz)}장으로 펜듈럼 소환')
        else:
            lo, hi = sorted(MAIN.get(p['name'], (0, 0, 0, EX.get(p['name'], (0, 0, 0))[2] if False else 0))[3]
                            if p['name'] in MAIN else {'아크크라이시스': 13, '데스마키나': 10}.get(p['name'], 0) for p in st.pz)
            for c in cards:
                lv = MAIN[c][2] if c in MAIN else None
                if lv is None or not (lo < lv < hi):
                    st.issue(i, f'{c}(레벨 {lv})은 스케일 {lo}~{hi} 사이가 아님')
        for c in cards:
            loc = st.from_loc(i, c, ['hand', 'exup'])
            if loc:
                st.summon(i, c)
                on_summon(st, i, c, ss=True, ps=True)
        return True
    # Zeus ① extra pendulum
    m = re.match(r'^추가 P소환권\(제우스 효과: (\S+) 파괴\)$', s) or re.match(r'^(\S+) 파괴 → 추가 P소환권\(제우스 효과\)$', s) \
        or re.match(r'^(\S+) 파괴\(제우스 효과\)$', s)
    if m:
        if not st.mon('제우스'):
            st.issue(i, '제우스가 필드에 없음')
        st.zeus1 += 1
        st.ps_allow = 2
        st.destroy(i, m.group(1))
        return True
    # Orthros P
    m = re.match(r'^(\S+?)[·&](\S+?) 파괴\(오르트로스 효과\)$', s) or re.match(r'^(\S+) 파괴\(오르트로스 효과\)$', s)
    if m:
        if not any(p['name'] == '오르트로스' for p in st.pz):
            st.issue(i, '오르트로스가 P존에 없음')
        st.take_opt(i, '오르트로스P')
        for x in m.groups():
            if x:
                st.destroy(i, x)
        return True
    # Gryphon P self destroy
    if s == '그리폰 파괴(그리폰 효과)':
        st.take_opt(i, '그리폰P')
        st.destroy(i, '그리폰')
        return True
    # level changes
    if s.startswith('레벨 4로(스케일 효과)') or re.match(r'^스케일 레벨 4로', s):
        mm = [x for x in st.field if x['name'] == '스케일']
        if not mm:
            st.issue(i, '스케일이 필드에 없음')
        else:
            mm[-1]['lvl'] = 4
        st.take_opt(i, '스케일2')
        return True
    m = re.match(r'^(?:(\S+) )?레벨 \+2\(랜스 효과\)$', s)
    if m:
        tgt = m.group(1) or '랜스'
        mm = st.mon(tgt)
        if not mm:
            st.issue(i, f'{tgt}이(가) 필드에 없음')
        else:
            nc = len(st.st) + sum(st.gy[c] for c in CONTRACTS)
            if nc < 2:
                st.issue(i, f'랜스 ①: 필드+묘지 계약서 {nc}장이라 +2 불가')
            mm['lvl'] += min(2, nc)
        st.take_opt(i, '랜스1')
        return True
    # Tell burn
    m = re.match(r'^상대 1000 데미지\(텔 효과(?:: 코스트 (\S+))?\)$', s)
    if m:
        t = st.mon('텔')
        if not t:
            st.issue(i, '텔이 필드에 없음')
        elif not st.dmg:
            st.issue(i, '텔 ①: 이 턴에 효과 데미지를 받지 않음')
        else:
            if not t['mats']:
                st.issue(i, '텔 소재 없음')
            else:
                c = m.group(1)
                if c and c in t['mats']:
                    t['mats'].remove(c)
                    st.gy[c] += 1
                elif c:
                    st.issue(i, f'텔 소재에 {c} 없음 (소재: {t["mats"]})')
                    st.gy[t['mats'].pop()] += 1
                else:
                    j = st.pick(len(t['mats']))
                    st.gy[t['mats'].pop(j)] += 1
        st.take_opt(i, '텔1')
        return True
    m = re.match(r'^텔 파괴\(제우스 효과\)$', s)
    if m:
        st.zeus1 += 1
        st.ps_allow = 2
        st.destroy(i, '텔')
        return True
    if s.startswith('자신 1000 데미지'):
        st.dmg = True
        return True
    if s.startswith('[상대] 니비루') or s.startswith('니비루'):
        return True
    if re.match(r'^(\S+) 제외$', s):
        return True
    return False


def on_summon(st, i, x, ss=False, ps=False):
    """bookkeeping for on-summon triggers that routes rely on implicitly (none auto)."""
    if x == '오르트로스' and ss:
        pass  # fiend-only restriction: all DD are fiends


def mats_split(s):
    s = s.split(':')[0]
    return names_in(s)


def ex_summon(st, i, x, kind, mats_s):
    full_mats_s = mats_s
    mats_s = mats_s.split(':')[0] if x != '아크크라이시스' else mats_s.replace('제외:', '')
    if st.ex[x] <= 0:
        st.issue(i, f'엑덱에 {x} 남아있지 않음')
    else:
        st.ex[x] -= 1
    if x == '아크크라이시스':
        mats = names_in(mats_s)
        kinds = set()
        for n in mats:
            loc = None
            mm = st.mon(n)
            if mm:
                st.leave_field_mon(i, mm, 'ban')
                st.ban[n] -= 0
                loc = 'field'
            elif st.gy[n] > 0:
                st.gy[n] -= 1
                st.ban[n] += 1
                loc = 'gy'
            else:
                st.issue(i, f'아크 크라이시스 제외 소재 {n}이(가) 필드/묘지에 없음')
            k = MAIN[n][1] if n in MAIN else EX[n][1]
            kinds.add('P' if k == 'P' else k[0])
        need = {'F', 'S', 'X', 'P'}
        if not need <= kinds:
            st.issue(i, f'아크 크라이시스 소재 종류 부족: {kinds}')
        st.take_opt(i, '아크크라이시스특소')
        st.summon(i, x)
        return True
    if kind == '엑시즈':
        mats = names_in(mats_s)
        if len(mats) == 1:  # overlay summon
            base = st.mon(mats[0])
            if not base:
                st.issue(i, f'겹칠 대상 {mats[0]}이(가) 필드에 없음')
                st.summon(i, x)
                return True
            if x == '텔':
                if not (base['name'] in EX and EX[base['name']][1] == 'X' and EX[base['name']][2] == 4 and base['name'] in DDD):
                    st.issue(i, f'텔은 랭크4 DDD 엑시즈 위에만 겹침({base["name"]})')
            elif x == '데스마키나':
                if base['name'] not in DDD:
                    st.issue(i, f'데스마키나는 DDD 위에만 겹침({base["name"]})')
                if base['name'] in EX and EX[base['name']][1] == 'L':
                    st.issue(i, f'[룰확인] 링크 몬스터({base["name"]}) 위 데스마키나 겹치기')
            else:
                st.issue(i, f'{x}은(는) 겹치기 소환 불가')
            st.field.remove(base)
            newmats = base['mats'] + [base['name']]
            st.field.append({'name': x, 'lvl': None, 'mats': newmats, 'own_lance': False})
            return True
        rank = EX[x][2]
        need_lv = {'솔로몬': 4, '시져': 4, '텔': 5, '대왕시져': 6, '데스마키나': 10}[x]
        mm = []
        for n in mats:
            o = st.mon(n)
            if not o:
                st.issue(i, f'엑시즈 소재 {n}이(가) 필드에 없음')
                continue
            if o['lvl'] != need_lv:
                st.issue(i, f'{x} 소재 {n} 레벨 {o["lvl"]} ≠ {need_lv}')
            st.field.remove(o)
            for mt in o.get('mats', []):
                st.gy[mt] += 1
            mm.append(n)
        if len(mats) != 2:
            st.issue(i, f'{x} 소재 수 {len(mats)}')
        st.field.append({'name': x, 'lvl': None, 'mats': mm, 'own_lance': False})
        return True
    if kind == '싱크로' or (kind == '특소' and x in ('사이프리트', '클로비스')):
        mats = names_in(mats_s)
        tot = 0
        tuners = 0
        for n in mats:
            o = st.mon(n)
            if not o:
                st.issue(i, f'싱크로 소재 {n}이(가) 필드에 없음')
                continue
            tot += o['lvl'] or 0
            if MAIN.get(n, (0, 0, 0, 0, False))[4]:
                tuners += 1
            st.leave_field_mon(i, o, 'syn')  # placeholder dest replaced below
        if tot != EX[x][2]:
            st.issue(i, f'{x} 레벨 합 {tot} ≠ {EX[x][2]}')
        if tuners != 1:
            st.issue(i, f'{x} 튜너 {tuners}장')
        st.summon(i, x)
        return True
    if kind == '링크' or (kind == '특소' and x in ('빌가메스', '제우스')):
        mats = names_in(mats_s)
        rating = 0
        for n in mats:
            o = st.mon(n)
            if not o:
                st.issue(i, f'링크 소재 {n}이(가) 필드에 없음')
                continue
            rating += 1
            st.leave_field_mon(i, o, 'gy')
        if x == '빌가메스' and len(mats) != 2:
            st.issue(i, f'빌가메스 소재 {len(mats)}장')
        if x == '제우스':
            link_sum_max = sum(EX[n][2] if n in EX and EX[n][1] == 'L' else 1 for n in mats)
            if not (len(mats) <= 3 <= link_sum_max) or len(mats) < 2:
                st.issue(i, f'제우스 링크3 소재 불일치 {mats}')
        st.summon(i, x)
        st.ddonly = True if x == '빌가메스' else st.ddonly
        return True
    if kind in ('융합', '특소') and x in ('알프레드', '테무진'):
        mats = names_in(mats_s)
        via_alfred = '알프레드 효과' in full_mats_s
        if via_alfred:
            if not st.mon('알프레드'):
                st.issue(i, '알프레드가 필드에 없음')
            st.take_opt(i, '알프레드1')
            for n in mats:
                o = st.mon(n)
                if st.ban[n] > 0:
                    st.ban[n] -= 1
                    (st.ex if n in EX else st.deck)[n] += 1
                elif o:
                    st.leave_field_mon(i, o, 'deck')
                elif st.hand[n] > 0:
                    st.hand[n] -= 1
                    st.deck[n] += 1
                else:
                    st.issue(i, f'알프레드 ①: {n}이(가) 패/필드/제외에 없음')
        else:  # via Necro in GY
            if st.gy['네크로'] <= 0:
                st.issue(i, '네크로가 묘지에 없음')
            st.take_opt(i, '네크로')
            for n in mats:
                if st.gy[n] > 0:
                    st.gy[n] -= 1
                    st.ban[n] += 1
                else:
                    st.issue(i, f'네크로 융합 소재 {n}이(가) 묘지에 없음')
        st.summon(i, x)
        return True
    st.issue(i, f'[해석 못함] 엑덱 소환 {x} {kind} {mats_s}')
    return True


# patch: synchro material leaving -> GY / banish(own lance) / extra(face-up pendulum)
_orig = State.leave_field_mon


def _leave(self, step, m, dest):
    if dest == 'syn':
        dest = 'gy'
    return _orig(self, step, m, dest)


State.leave_field_mon = _leave

# ---------------- route loading -----------------------------------------------------
STARTERS = {
    'A1': ['케플러'], 'A2': ['케플러'], 'A3': ['지옥문'], 'A4': ['지옥문'], 'A5': ['제로마키나'], 'A6': ['제로마키나'],
    'A7': ['제로마키나'], 'B1': ['케플러'], 'B2': ['지옥문'], 'B3': ['제로마키나'], 'C1': ['제로마키나'], 'C2': ['케플러'],
    'C3': ['지옥문'], 'C4': ['제로마키나'], 'D1': ['지옥문'], 'D2': ['지옥문'], 'D3': ['제로마키나'], 'D4': ['제로마키나'],
    'D5': ['케플러'], 'D6': ['케플러'], 'E1': ['케플러', '드롤'], 'E2': ['지옥문', '드롤'], 'F1': ['케플러'], 'F2': ['케플러'],
    'F3': ['지옥문'], 'F4': ['지옥문'], 'F5': ['제로마키나'], 'F6': ['제로마키나'], 'G1': ['제로마키나', '지옥문'],
}


def load():
    routes = {}
    for f in ['tab2_A.md', 'tab2_BC.md', 'tab2_D.md', 'tab2_EFG.md']:
        cur = None
        for ln in open(f'{S}/{f}'):
            ln = ln.rstrip('\n')
            mh = re.match(r'^### (\w\d)\. (.*)$', ln)
            if mh:
                cur = mh.group(1)
                routes[cur] = {'title': mh.group(2), 'steps': []}
                continue
            ms = re.match(r'^\d+\. (.*)$', ln)
            if ms and cur:
                routes[cur]['steps'].append(ms.group(1).replace('코페르·오르트로스 ·케플러', '코페르·오르트로스·케플러'))
    return routes


def hand_fix(st_hand):
    return st_hand


if __name__ == '__main__':
    routes = load()
    MAIN['드롤'] = (2, 'M', 1, None, False, 0, 0)
    out = {}
    for rid, r in routes.items():
        hand = STARTERS[rid]
        import itertools
        base = run(rid, hand, r['steps'])
        k = base.nchoice
        best = base
        for combo in itertools.product(range(3), repeat=min(k, 6)):
            t = run(rid, hand, r['steps'], combo)
            if len(t.issues) < len(best.issues):
                best = t
        stt = best
        # gate starts: activate from hand counts as face-up contract
        out[rid] = stt.issues
        fieldnames = sorted(x['name'] for x in stt.field)
        print(f'== {rid} {r["title"]}  | 최종 몬스터: {fieldnames} | 계약서: {stt.st} | P존: {[p["name"] for p in stt.pz]} | EX앞면: {dict(+stt.exup)}')
        for step, msg in stt.issues:
            print(f'   {step:>2}: {msg}')
    json.dump({k: v for k, v in out.items()}, open(f'{S}/check_out.json', 'w'), ensure_ascii=False, indent=1)
