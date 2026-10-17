/* DD4 전개 계산기 — calculator/checker.py · engine.py · hits.py 의 JavaScript 이식.
   Python 동작을 기준으로 줄 단위로 옮겼다. 단계 문장 문법(dd-routes.md)은 바꾸지 않는다.
   사용: var calc = DD_CALC_FACTORY(routeList)  (routeList = [{id, title, steps:[원문 문장...]}])
   브라우저(Web Worker·일반 스크립트)와 Node(require) 양쪽에서 동작한다. */
function DD_CALC_FACTORY(routeList) {
  'use strict';

  // ------------------------------------------------------------ Counter 도우미(Python Counter 흉내: 삽입 순서 유지)
  function g(c, k) { return c[k] || 0; }
  function inc(c, k, n) { c[k] = (c[k] || 0) + (n === undefined ? 1 : n); }
  function ccopy(c) { var o = {}; for (var k in c) o[k] = c[k]; return o; }
  function cpos(c) { var o = {}; for (var k in c) if (c[k] > 0) o[k] = c[k]; return o; }
  function csub(a, b) { var o = {}; for (var k in a) { var v = a[k] - (b[k] || 0); if (v > 0) o[k] = v; } return o; }
  function cfrom(list) { var o = {}; for (var i = 0; i < list.length; i++) inc(o, list[i]); return o; }
  function has(arr, x) { return arr.indexOf(x) >= 0; }
  function deepEq(a, b) {
    if (a === b) return true;
    if (Array.isArray(a)) { if (!Array.isArray(b) || a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false; return true; }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) if (!Object.prototype.hasOwnProperty.call(b, ka[j]) || !deepEq(a[ka[j]], b[ka[j]])) return false;
      return true;
    }
    return false;
  }
  function removeEq(arr, x) { for (var i = 0; i < arr.length; i++) if (deepEq(arr[i], x)) { arr.splice(i, 1); return; } throw new Error('list.remove(x): x not in list'); }
  function combinations(arr, r) {
    var out = [], n = arr.length;
    if (r > n) return out;
    var idx = []; for (var i = 0; i < r; i++) idx.push(i);
    out.push(idx.map(function (j) { return arr[j]; }));
    while (true) {
      var p = r - 1;
      while (p >= 0 && idx[p] === p + n - r) p--;
      if (p < 0) return out;
      idx[p]++;
      for (var q = p + 1; q < r; q++) idx[q] = idx[q - 1] + 1;
      out.push(idx.map(function (j) { return arr[j]; }));
    }
  }
  function uniq(list) { var s = [], seen = {}; for (var i = 0; i < list.length; i++) if (!seen[list[i]]) { seen[list[i]] = 1; s.push(list[i]); } return s; }
  function stableSortBy(list, keyfn) {
    return list.map(function (x, i) { return [keyfn(x), i, x]; }).sort(function (a, b) {
      var c = cmpKey(a[0], b[0]); return c !== 0 ? c : a[1] - b[1];
    }).map(function (t) { return t[2]; });
  }
  function cmpKey(a, b) {
    if (Array.isArray(a)) { for (var i = 0; i < Math.min(a.length, b.length); i++) { var c = cmpKey(a[i], b[i]); if (c) return c; } return a.length - b.length; }
    if (typeof a === 'number') return a < b ? -1 : a > b ? 1 : 0;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  // Python repr 흉내(이유 문장을 Python 결과와 같게)
  function pyStr(x) { return "'" + x + "'"; }
  function pyList(a) { return '[' + a.map(function (x) { return Array.isArray(x) ? '(' + x.map(pyStr).join(', ') + ')' : pyStr(x); }).join(', ') + ']'; }
  function josa(word, a, b) { var c = word.charCodeAt(word.length - 1); return (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0) ? a : b; }
  function round2(x) { return Math.round(x * 100 + (x >= 0 ? 1e-9 : -1e-9)) / 100; }

  // ------------------------------------------------------------ 카드 데이터 (checker.py)
  var MAIN = {
    '케플러': [3, 'P', 1, 10, false, 0, 0], '코페르': [1, 'P', 4, 1, false, 0, 0], '토마스': [1, 'P', 8, 6, false, 1800, 2600],
    '오르트로스': [1, 'P', 4, 3, true, 600, 1800], '카운트': [1, 'P', 8, 1, false, 2000, 2000], '그리폰': [2, 'P', 4, 1, false, 1200, 1200],
    '스케일': [2, 'P', 2, 9, false, 0, 1000], '제로마키나': [3, 'P', 8, 0, false, 3000, 0], '네크로': [1, 'M', 1, null, false, 300, 300],
    '랜스': [1, 'M', 2, null, true, 400, 400]
  };
  var CONTRACTS = { '지옥문': 3, '령왕': 1, '상암': 1 };
  var DDD = ['제로마키나', '테무진', '알프레드', '아크크라이시스', '클로비스', '사이프리트', '시져', '솔로몬', '텔', '대왕시져', '데스마키나', '빌가메스', '제우스'];
  var EX = {
    '테무진': [1, 'F', 6], '알프레드': [1, 'F', 6], '아크크라이시스': [1, 'FP', 12], '클로비스': [1, 'S', 6], '사이프리트': [1, 'S', 8],
    '시져': [1, 'X', 4], '솔로몬': [1, 'X', 4], '텔': [1, 'X', 5], '대왕시져': [1, 'X', 6], '데스마키나': [2, 'XP', 10],
    '빌가메스': [2, 'L', 2], '비욘드': [1, 'L', 2], '제우스': [1, 'L', 3]
  };
  // ALL_NAMES 는 드롤 추가 전에 만들어진다(Python과 같게)
  var ALL_NAMES = Object.keys(MAIN).concat(Object.keys(CONTRACTS), Object.keys(EX)).sort(function (a, b) { return b.length - a.length; });
  MAIN['드롤'] = [2, 'M', 1, null, false, 0, 0];  // engine.py
  function inMAIN(n) { return Object.prototype.hasOwnProperty.call(MAIN, n); }
  function inEX(n) { return Object.prototype.hasOwnProperty.call(EX, n); }
  function inCON(n) { return Object.prototype.hasOwnProperty.call(CONTRACTS, n); }
  function isDDD(n) { return DDD.indexOf(n) >= 0; }
  var DD_MON_SET = {};
  Object.keys(MAIN).forEach(function (n) { if (n !== '드롤') DD_MON_SET[n] = 1; });
  Object.keys(EX).forEach(function (n) { if (n !== '비욘드') DD_MON_SET[n] = 1; });
  function isDDMon(n) { return !!DD_MON_SET[n]; }

  function norm(s) {
    s = s.split('아크 크라이시스').join('아크크라이시스').split('①').join('').split('②').join('').split('③').join('');
    s = s.split(' (').join('(').split('( ').join('(');
    return s.trim();
  }
  function namesIn(s) {
    var out = [], tmp = s;
    for (var a = 0; a < ALL_NAMES.length; a++) {
      var n = ALL_NAMES[a];
      var i;
      while ((i = tmp.indexOf(n)) >= 0) {
        out.push([i, n]);
        tmp = tmp.slice(0, i) + new Array(n.length + 1).join('＿') + tmp.slice(i + n.length);
      }
    }
    out.sort(function (x, y) { return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0); });
    return out.map(function (x) { return x[1]; });
  }

  // ------------------------------------------------------------ 상태 (checker.State + engine 속성)
  function State(hand) {
    if (hand === undefined) return;  // clone 용
    this.deck = {};
    for (var k in MAIN) if (k !== '드롤') this.deck[k] = MAIN[k][0];
    this.deck['드롤'] = MAIN['드롤'][0];
    for (var c in CONTRACTS) inc(this.deck, c, CONTRACTS[c]);
    this.ex = {}; for (var e in EX) this.ex[e] = EX[e][0];
    this.hand = {};
    for (var i = 0; i < hand.length; i++) { inc(this.deck, hand[i], -1); inc(this.hand, hand[i]); }
    this.field = []; this.pz = []; this.st = [];
    this.gy = {}; this.ban = {}; this.exup = {};
    this.ns = 0; this.opt = {}; this.dmg = false; this.droll = false; this.ddonly = false;
    this.ps_count = 0; this.ps_allow = 1; this.zeus1 = 0; this.neg = {};
    this.issues = []; this.last_destroyed = []; this.choices = []; this.nchoice = 0;
    this._summoned = null; this._pulled = null; this.took_damage = false;
    this.zones = null; this.zone_names = null; this.sums = 0; this.ss_events = [];
  }
  State.prototype.clone = function () {
    var s = new State();
    s.deck = ccopy(this.deck); s.ex = ccopy(this.ex); s.hand = ccopy(this.hand);
    s.field = this.field.map(function (m) { var o = { name: m.name, lvl: m.lvl, mats: m.mats.slice(), own_lance: m.own_lance }; if ('neg' in m) o.neg = m.neg; return o; });
    s.pz = this.pz.map(function (p) { return { name: p.name, activated: p.activated }; });
    s.st = this.st.slice(); s.gy = ccopy(this.gy); s.ban = ccopy(this.ban); s.exup = ccopy(this.exup);
    s.ns = this.ns; s.opt = ccopy(this.opt); s.dmg = this.dmg; s.droll = this.droll; s.ddonly = this.ddonly;
    s.ps_count = this.ps_count; s.ps_allow = this.ps_allow; s.zeus1 = this.zeus1; s.neg = ccopy(this.neg);
    s.issues = this.issues.slice(); s.last_destroyed = this.last_destroyed.slice(); s.choices = this.choices.slice(); s.nchoice = this.nchoice;
    s._summoned = this._summoned ? this._summoned.slice() : null; s._pulled = this._pulled ? this._pulled.slice() : null;
    s.took_damage = this.took_damage;
    s.zones = this.zones ? new Map(this.zones) : null; s.zone_names = this.zone_names ? ccopy(this.zone_names) : null;
    s.sums = this.sums; s.ss_events = this.ss_events;
    return s;
  };
  State.prototype.pick = function (k) { var c = this.nchoice < this.choices.length ? this.choices[this.nchoice] : 0; this.nchoice++; return c % Math.max(k, 1); };
  State.prototype.issue = function (step, msg) { this.issues.push([step, msg]); };
  State.prototype.mon = function (name) { for (var i = 0; i < this.field.length; i++) if (this.field[i].name === name) return this.field[i]; return null; };
  State.prototype.take_opt = function (step, key, limit) {
    limit = limit || 1; inc(this.opt, key);
    if (this.opt[key] > limit) this.issue(step, '1턴 제약 초과: ' + key + ' (' + this.opt[key] + '회째)');
  };
  State.prototype.leave_field_mon = function (step, m, dest) {
    if (dest === 'syn') dest = 'gy';
    removeEq(this.field, m);
    var n = m.name;
    var mats = m.mats || [];
    for (var i = 0; i < mats.length; i++) inc(this.gy, mats[i]);
    if (m.own_lance) dest = 'ban';
    if (dest === 'gy') {
      if (inMAIN(n) && MAIN[n][1] === 'P') inc(this.exup, n);
      else if (inEX(n) && EX[n][1].indexOf('P') >= 0) inc(this.exup, n);
      else inc(this.gy, n);
    } else if (dest === 'ban') inc(this.ban, n);
    else if (dest === 'hand') { if (inEX(n)) inc(this.ex, n); else inc(this.hand, n); }
    else if (dest === 'deck') { if (inEX(n)) inc(this.ex, n); else inc(this.deck, n); }
    return dest;
  };
  State.prototype.destroy = function (step, n) {
    for (var i = 0; i < this.pz.length; i++) if (this.pz[i].name === n) {
      this.pz.splice(i, 1); inc(this.exup, n); this.last_destroyed.push(['P', n]); return true;
    }
    var j = this.st.indexOf(n);
    if (j >= 0) { this.st.splice(j, 1); inc(this.gy, n); this.last_destroyed.push(['C', n]); return true; }
    var m = this.mon(n);
    if (m) { this.leave_field_mon(step, m, 'gy'); this.last_destroyed.push(['M', n]); return true; }
    this.issue(step, '파괴 대상 ' + n + '이(가) 필드에 없음');
    return false;
  };
  State.prototype.from_loc = function (step, n, locs) {
    for (var i = 0; i < locs.length; i++) {
      var c = this[locs[i]];
      if (g(c, n) > 0) {
        c[n] -= 1;
        if (locs[i] === 'deck') { if (!this._pulled) this._pulled = []; this._pulled.push(n); }
        return locs[i];
      }
    }
    this.issue(step, n + '을(를) ' + locs.join('/') + '에서 찾을 수 없음');
    return null;
  };
  State.prototype.summon = function (step, n, lvl, own_lance) {
    if (!this._summoned) this._summoned = [];
    this._summoned.push(n);
    var base = inMAIN(n) ? MAIN[n][2] : (inEX(n) ? EX[n][2] : null);
    if (this.ddonly && !(inMAIN(n) || inEX(n)) && n !== '비욘드') this.issue(step, 'DD만 특소 제약 중 ' + n + ' 특소');
    if (this.ddonly && n === '비욘드') this.issue(step, '령왕/빌가메스 제약 중 비욘드(마법사족) 특소 불가');
    this.field.push({ name: n, lvl: (lvl !== undefined && lvl !== null) ? lvl : base, mats: [], own_lance: !!own_lance });
    if (this.field.length > 6) this.issue(step, '몬스터 ' + this.field.length + '체: 메인 5 + EX 1 초과 가능성');
  };

  // ------------------------------------------------------------ 단계 해석 (checker.handle)
  function nsum(st, i, n) {
    if (st.from_loc(i, n, ['hand']) === null) return;
    st.ns += 1;
    if (st.ns > 1) st.issue(i, '일반소환 2회');
    st.summon(i, n);
  }
  var SEARCH_KEY = { '케플러': '케플러몬', '지옥문': '지옥문', '카운트': '카운트2', '솔로몬': '솔로몬', '그리폰': '그리폰3', '시져': null, '대왕시져': null };
  function search(st, i, x, src) {
    if (st.droll) st.issue(i, '드롤 적용 중 덱→패 서치(' + x + ')');
    var loc = st.from_loc(i, x, ['deck']);
    if (loc) inc(st.hand, x);
    var key = Object.prototype.hasOwnProperty.call(SEARCH_KEY, src) ? SEARCH_KEY[src] : src;
    if (src === '케플러') {
      if (!inCON(x)) st.issue(i, '케플러는 계약서만 서치 가능(' + x + ')');
      if (!st.mon('케플러')) st.issue(i, '케플러가 필드에 없음');
    }
    if (src === '지옥문') {
      if (st.st.indexOf('지옥문') < 0 && g(st.hand, '지옥문') > 0) { st.hand['지옥문'] -= 1; st.st.push('지옥문'); }
      if (!inMAIN(x)) st.issue(i, '지옥문은 DD 몬스터만 서치(' + x + ')');
      if (st.st.indexOf('지옥문') < 0) st.issue(i, '지옥문이 앞면으로 없음');
    }
    if (src === '카운트') {
      if (!st.mon('카운트')) st.issue(i, '카운트가 필드에 없음');
      if (!inMAIN(x) || (MAIN[x][5] !== 0 && MAIN[x][6] !== 0)) st.issue(i, '카운트는 공/수 0 DD 몬스터만 서치(' + x + ')');
    }
    if (src === '솔로몬') {
      var m = st.mon('솔로몬');
      if (!m || !m.mats.length) st.issue(i, '솔로몬 소재 없음');
      else { var j = st.pick(m.mats.length); inc(st.gy, m.mats.splice(j, 1)[0]); }
    }
    if (src === '시져') { if (!inCON(x)) st.issue(i, '시져 ②는 계약서만'); }
    if (key) st.take_opt(i, key);
  }

  function re(s, rx) { return rx.exec(s); }

  function handle(st, i, s, destroyed_before) {
    var m, m2;
    if (s.indexOf('[상대]') === 0) {
      if (s.indexOf('드롤') >= 0) st.droll = true;
      if (s.indexOf('빌가메스 효과 무효') >= 0) st.neg['빌가메스'] = 1;
      if (s.indexOf('령왕 효과 무효') >= 0) st.neg['령왕'] = 1;
      return true;
    }
    if (s.indexOf('내 드롤 발동') === 0) {
      if (g(st.hand, '드롤')) st.from_loc(i, '드롤', ['hand']);
      return true;
    }
    if (s.indexOf('니비루 무효(제우스 효과)') >= 0) {
      var nn = namesIn(s.split('→')[0]);
      for (var a = 0; a < nn.length; a++) if (st.from_loc(i, nn[a], ['gy'])) inc(st.ban, nn[a]);
      st.take_opt(i, '제우스2');
      return true;
    }
    if (s.indexOf('빌가메스 효과로 스케일 포함') === 0) {
      ['제로마키나', '스케일'].forEach(function (c) { st.pz.push({ name: c, activated: false }); st.from_loc(i, c, ['deck']); });
      st.take_opt(i, '빌가메스1'); st.dmg = true;
      return true;
    }
    if ((m = re(s, /^(\S+) 일반소환(?:: (\S+) 서치)?$/))) {
      nsum(st, i, m[1]);
      if (m[2]) search(st, i, m[2], m[1]);
      return true;
    }
    if ((m = re(s, /^(\S+) 서치[:(]\s*(\S+) 효과\)?$/))) { search(st, i, m[1], m[2]); return true; }
    if ((m = re(s, /^(.+?) P존 세팅\(자신 1000 데미지\)$/))) {
      var cards = namesIn(m[1]);
      if (st.neg['빌가메스']) st.issue(i, '무효된 빌가메스 효과 사용');
      if (!st.mon('빌가메스')) st.issue(i, '빌가메스가 필드에 없음');
      st.take_opt(i, '빌가메스1');
      if (uniq(cards).length !== 2) st.issue(i, '빌가메스는 이름 다른 2장: ' + pyList(cards));
      cards.forEach(function (c) { if (st.from_loc(i, c, ['deck'])) st.pz.push({ name: c, activated: false }); });
      if (st.pz.length > 2) st.issue(i, 'P존 ' + st.pz.length + '장(2장 초과)');
      st.dmg = true; st.ddonly = true;
      return true;
    }
    if ((m = re(s, /^(?:(\S+) P존 재발동 → )?(\S+) P존 세팅$/))) {
      var n0 = !m[1] ? m[2] : m[1];
      if (st.from_loc(i, n0, ['hand'])) st.pz.push({ name: n0, activated: true });
      if (st.pz.length > 2) st.issue(i, 'P존 ' + st.pz.length + '장(2장 초과)');
      return true;
    }
    if ((m = re(s, /^(\S+) P존 재발동 → (\S+) 놓기\(제로마키나 효과\)$/))) {
      if (st.from_loc(i, '제로마키나', ['hand'])) st.pz.push({ name: '제로마키나', activated: true });
      return handle(st, i, m[2] + ' 놓기(제로마키나 효과)', destroyed_before);
    }
    if (s.indexOf('P존에 놓기(제로마키나 효과)') === 0) {
      if (!destroyed_before.some(function (d) { return d[0] === 'M' && d[1] === '제로마키나'; })) st.issue(i, '제로마키나 ②: 직전에 몬스터존에서 파괴되지 않음');
      st.take_opt(i, '제로마키나2');
      if (st.from_loc(i, '제로마키나', ['exup'])) st.pz.push({ name: '제로마키나', activated: false });
      if (st.pz.length > 2) st.issue(i, 'P존 ' + st.pz.length + '장(2장 초과)');
      return true;
    }
    if ((m = re(s, /^(\S+) 놓기[:(]\s*(\S+) 효과\)?$/))) {
      var targets = namesIn(m[1]), src = m[2];
      if (src === '제로마키나') {
        var zm = st.pz.filter(function (p) { return p.name === '제로마키나'; });
        if (!zm.length) st.issue(i, '제로마키나가 P존에 없음');
        else if (!zm[0].activated) st.issue(i, '제로마키나 P효과: 발동한 턴이 아님(효과로 놓인 상태)');
        st.take_opt(i, '제로마키나P');
        targets.forEach(function (t) { if (st.from_loc(i, t, ['deck'])) st.st.push(t); });
      } else if (src === '알프레드') {
        if (!g(st.ban, '알프레드')) st.issue(i, '알프레드가 제외되지 않음(②조건)');
        st.take_opt(i, '알프레드2');
        var nddd = st.field.filter(function (x) { return isDDD(x.name); }).length;
        if (targets.length > nddd) st.issue(i, '알프레드 ②: 놓는 수 ' + targets.length + ' > 필드 DDD ' + nddd);
        targets.forEach(function (t) { if (st.from_loc(i, t, ['gy', 'ban'])) st.st.push(t); });
      } else st.issue(i, '놓기 출처 미지원 ' + src);
      return true;
    }
    if ((m = re(s, /^(\S+) 놓기$/))) {
      if (st.from_loc(i, m[1], ['gy', 'ban'])) st.st.push(m[1]);
      st.take_opt(i, '알프레드2');
      return true;
    }
    m = re(s, /^(\S+) 특소\(령왕 효과(?:: (.+?))?\)$/);
    m2 = re(s, /^(\S+) 파괴 → (\S+) 특소\(령왕 효과\)$/);
    if (m || m2) {
      var x = m ? m[1] : m2[2];
      var z = (m ? m[2] : m2[1]) || '';
      var zz = namesIn(z);
      if (s.indexOf('원문 표기는') >= 0) { zz = ['제로마키나']; st.issue(i, '원문 표기 오류 추정 단계(카운트 파괴→제로마키나 파괴로 처리)'); }
      if (st.st.indexOf('령왕') < 0 && g(st.hand, '령왕') > 0) { st.hand['령왕'] -= 1; st.st.push('령왕'); }
      if (st.st.indexOf('령왕') < 0) st.issue(i, '령왕이 앞면으로 없음');
      if (st.neg['령왕']) st.issue(i, '무효된 령왕 사용');
      st.take_opt(i, '령왕');
      zz.forEach(function (t) { st.destroy(i, t); });
      if (st.from_loc(i, x, ['deck'])) st.summon(i, x);
      st.ddonly = true;
      return true;
    }
    if ((m = re(s, /^랜스 특소\s*\(랜스 효과: (\S+) 파괴\)$/) || re(s, /^랜스 특소\s*\((\S+) 파괴\)$/))) {
      var zl = m[1];
      if (st.st.indexOf(zl) < 0) st.issue(i, '랜스 ②: ' + zl + '이(가) 내 필드 계약서가 아님');
      st.take_opt(i, '랜스2');
      st.destroy(i, zl);
      if (st.from_loc(i, '랜스', ['gy'])) st.summon(i, '랜스', null, true);
      return true;
    }
    if ((m = re(s, /^(\S+) 특소\(토마스 효과: (\S+) 파괴\)$/))) {
      var xt = m[1], zt = m[2];
      if (!st.mon('토마스')) st.issue(i, '토마스가 몬스터로 필드에 없음');
      st.take_opt(i, '토마스몬');
      st.destroy(i, zt);
      if (st.from_loc(i, xt, ['deck'])) st.summon(i, xt);
      if (!(isDDD(xt) && ((inMAIN(xt) ? MAIN[xt][2] : 0) === 8))) st.issue(i, '토마스: 레벨8 DDD만(' + xt + ')');
      return true;
    }
    if ((m = re(s, /^제로마키나 특소( 후 자괴)?\s*\(제로마키나 효과\)$/))) {
      var okz = destroyed_before.some(function (d) { return d[0] === 'C' || ((d[0] === 'P' || d[0] === 'M') && isDDD(d[1]) && d[1] !== '제로마키나'); });
      if (!okz) st.issue(i, '제로마키나 ① 트리거 불명(직전 파괴: ' + pyList(destroyed_before) + ')');
      st.take_opt(i, '제로마키나1');
      if (st.from_loc(i, '제로마키나', ['exup'])) st.summon(i, '제로마키나');
      if (m[1]) { st.destroy(i, '제로마키나'); st.last_destroyed = [['M', '제로마키나']]; }
      return true;
    }
    if ((m = re(s, /^(스케일|그리폰) 특소\s*\((스케일|그리폰) 효과\)$/)) && m[1] === m[2]) {
      var xs = m[1];
      if (xs === '스케일') {
        var okp = st.pz.some(function (p) { return inMAIN(p.name); }) || st.field.some(function (mm) { return inMAIN(mm.name) && MAIN[mm.name][1] === 'P'; }) ||
          st.field.some(function (mm) { return inEX(mm.name) && EX[mm.name][1].indexOf('P') >= 0; });
        if (!okp) st.issue(i, '스케일 ①: 필드에 DD 펜듈럼 카드 없음');
        st.take_opt(i, '스케일1');
      } else {
        if (!st.field.length) st.issue(i, '그리폰 ①: DD 몬스터 없음');
        st.take_opt(i, '그리폰1');
      }
      if (st.from_loc(i, xs, ['hand'])) st.summon(i, xs);
      return true;
    }
    if ((m = re(s, /^(\S+) (?:소생|특소)\s*\((테무진|클로비스) 효과\)$/))) {
      var xr = m[1], sr = m[2];
      if (!st.mon(sr)) st.issue(i, sr + '이(가) 필드에 없음');
      st.take_opt(i, sr + '1');
      var locs = sr === '테무진' ? ['gy'] : ['ban', 'gy'];
      if (sr === '클로비스' && !st.st.length && g(st.ban, xr) === 0) st.issue(i, '클로비스: 계약서가 없어 묘지 대상 불가');
      var lr = st.from_loc(i, xr, locs);
      if (lr) st.summon(i, xr);
      return true;
    }
    if ((m = re(s, /^(\S+) (링크|엑시즈|싱크로|융합|특소)\s*\((.+?)\)$/)) && inEX(m[1])) return exSummon(st, i, m[1], m[2], m[3]);
    if ((m = re(s, /^(\S+?)\((.+)\)$/)) && inEX(m[1])) {
      var kk = EX[m[1]][1];
      var kind = { L: '링크', X: '엑시즈', XP: '엑시즈', S: '싱크로', F: '융합', FP: '융합' }[kk];
      return exSummon(st, i, m[1], kind, m[2]);
    }
    if (re(s, /^(아크크라이시스) 특소$/)) return true;
    if ((m = re(s, /^(\S+) 묘지로\s*\((코페르|텔) 효과\)$/) || re(s, /^(\S+) 묘지로$/))) {
      var xg = m[1];
      var sg = m.length > 2 && m[2] !== undefined ? m[2] : null;
      if (sg === null) { st.issue(i, '출처 없는 덤프 줄(' + xg + ') — 원본 로그 중복 가능'); return true; }
      if (sg === '코페르') st.take_opt(i, '코페르');
      else if (!g(st.gy, '텔') && !g(st.exup, '텔')) st.issue(i, '텔이 묘지에 없는데 텔 ② 사용');
      if (st.from_loc(i, xg, ['deck'])) inc(st.gy, xg);
      return true;
    }
    if ((m = re(s, /^(\S+) 회수\(토마스 효과\)$/))) {
      if (!st.pz.some(function (p) { return p.name === '토마스'; })) st.issue(i, '토마스가 P존에 없음');
      st.take_opt(i, '토마스P');
      if (st.from_loc(i, m[1], ['exup'])) inc(st.hand, m[1]);
      return true;
    }
    if ((m = re(s, /^(\S+) (?:바운스|패로 되돌림)\((스케일|케플러) 효과\)$/))) {
      var xb = m[1], sb = m[2];
      st.take_opt(i, sb === '스케일' ? '스케일3' : '케플러몬');
      var found = false;
      for (var pi = 0; pi < st.pz.length; pi++) if (st.pz[pi].name === xb) { st.pz.splice(pi, 1); inc(st.hand, xb); found = true; break; }
      if (!found) { var mb = st.mon(xb); if (mb) { st.leave_field_mon(i, mb, 'hand'); found = true; } }
      if (!found) st.issue(i, '바운스 대상 ' + xb + '이(가) 필드에 없음');
      return true;
    }
    if ((m = re(s, /^(.+?) ?P소환$/))) {
      var pc = namesIn(m[1]);
      st.ps_count += 1;
      if (st.ps_count > st.ps_allow) st.issue(i, '펜듈럼 소환 ' + st.ps_count + '회째(허용 ' + st.ps_allow + ')');
      if (st.pz.length !== 2) st.issue(i, 'P존 ' + st.pz.length + '장으로 펜듈럼 소환');
      else {
        var sc = st.pz.map(function (p) { return inMAIN(p.name) ? MAIN[p.name][3] : ({ '아크크라이시스': 13, '데스마키나': 10 }[p.name] || 0); }).sort(function (a, b) { return a - b; });
        var lo = sc[0], hi = sc[1];
        pc.forEach(function (c) {
          var lv = inMAIN(c) ? MAIN[c][2] : null;
          if (lv === null || !(lo < lv && lv < hi)) st.issue(i, c + '(레벨 ' + (lv === null ? 'None' : lv) + ')은 스케일 ' + lo + '~' + hi + ' 사이가 아님');
        });
      }
      pc.forEach(function (c) { if (st.from_loc(i, c, ['hand', 'exup'])) st.summon(i, c); });
      return true;
    }
    if ((m = re(s, /^추가 P소환권\(제우스 효과: (\S+) 파괴\)$/) || re(s, /^(\S+) 파괴 → 추가 P소환권\(제우스 효과\)$/) || re(s, /^(\S+) 파괴\(제우스 효과\)$/))) {
      if (!st.mon('제우스')) st.issue(i, '제우스가 필드에 없음');
      st.zeus1 += 1; st.ps_allow = 2;
      st.destroy(i, m[1]);
      return true;
    }
    if ((m = re(s, /^(\S+?)[·&](\S+?) 파괴\(오르트로스 효과\)$/) || re(s, /^(\S+) 파괴\(오르트로스 효과\)$/))) {
      if (!st.pz.some(function (p) { return p.name === '오르트로스'; })) st.issue(i, '오르트로스가 P존에 없음');
      st.take_opt(i, '오르트로스P');
      for (var gi = 1; gi < m.length; gi++) if (m[gi]) st.destroy(i, m[gi]);
      return true;
    }
    if (s === '그리폰 파괴(그리폰 효과)') { st.take_opt(i, '그리폰P'); st.destroy(i, '그리폰'); return true; }
    if (s.indexOf('레벨 4로(스케일 효과)') === 0 || re(s, /^스케일 레벨 4로/)) {
      var ms = st.field.filter(function (x) { return x.name === '스케일'; });
      if (!ms.length) st.issue(i, '스케일이 필드에 없음'); else ms[ms.length - 1].lvl = 4;
      st.take_opt(i, '스케일2');
      return true;
    }
    if ((m = re(s, /^(?:(\S+) )?레벨 \+2\(랜스 효과\)$/))) {
      var tg = m[1] || '랜스';
      var mt = st.mon(tg);
      if (!mt) st.issue(i, tg + '이(가) 필드에 없음');
      else {
        var nc = st.st.length; for (var cn in CONTRACTS) nc += g(st.gy, cn);
        if (nc < 2) st.issue(i, '랜스 ①: 필드+묘지 계약서 ' + nc + '장이라 +2 불가');
        mt.lvl += Math.min(2, nc);
      }
      st.take_opt(i, '랜스1');
      return true;
    }
    if ((m = re(s, /^상대 1000 데미지\(텔 효과(?:: 코스트 (\S+))?\)$/))) {
      var t = st.mon('텔');
      if (!t) st.issue(i, '텔이 필드에 없음');
      else if (!st.dmg) st.issue(i, '텔 ①: 이 턴에 효과 데미지를 받지 않음');
      else if (!t.mats.length) st.issue(i, '텔 소재 없음');
      else {
        var cc = m[1];
        if (cc && t.mats.indexOf(cc) >= 0) { t.mats.splice(t.mats.indexOf(cc), 1); inc(st.gy, cc); }
        else if (cc) { st.issue(i, '텔 소재에 ' + cc + ' 없음 (소재: ' + pyList(t.mats) + ')'); inc(st.gy, t.mats.pop()); }
        else { var jt = st.pick(t.mats.length); inc(st.gy, t.mats.splice(jt, 1)[0]); }
      }
      st.take_opt(i, '텔1');
      return true;
    }
    if (re(s, /^텔 파괴\(제우스 효과\)$/)) { st.zeus1 += 1; st.ps_allow = 2; st.destroy(i, '텔'); return true; }
    if (s.indexOf('자신 1000 데미지') === 0) { st.dmg = true; return true; }
    if (s.indexOf('[상대] 니비루') === 0 || s.indexOf('니비루') === 0) return true;
    if (re(s, /^(\S+) 제외$/)) return true;
    return false;
  }

  function exSummon(st, i, x, kind, mats_s) {
    var full = mats_s;
    mats_s = x !== '아크크라이시스' ? mats_s.split(':')[0] : mats_s.split('제외:').join('');
    if (g(st.ex, x) <= 0) st.issue(i, '엑덱에 ' + x + ' 남아있지 않음'); else st.ex[x] -= 1;
    var mats, n, o, k;
    if (x === '아크크라이시스') {
      mats = namesIn(mats_s);
      var kinds = {};
      for (k = 0; k < mats.length; k++) {
        n = mats[k];
        var mm = st.mon(n);
        if (mm) st.leave_field_mon(i, mm, 'ban');
        else if (g(st.gy, n) > 0) { st.gy[n] -= 1; inc(st.ban, n); }
        else st.issue(i, '아크 크라이시스 제외 소재 ' + n + '이(가) 필드/묘지에 없음');
        var kd = inMAIN(n) ? MAIN[n][1] : EX[n][1];
        kinds[kd === 'P' ? 'P' : kd[0]] = 1;
      }
      if (!(kinds.F && kinds.S && kinds.X && kinds.P)) st.issue(i, '아크 크라이시스 소재 종류 부족: ' + JSON.stringify(Object.keys(kinds)));
      st.take_opt(i, '아크크라이시스특소');
      st.summon(i, x);
      return true;
    }
    if (kind === '엑시즈') {
      mats = namesIn(mats_s);
      if (mats.length === 1) {
        var base = st.mon(mats[0]);
        if (!base) { st.issue(i, '겹칠 대상 ' + mats[0] + '이(가) 필드에 없음'); st.summon(i, x); return true; }
        if (x === '텔') {
          if (!(inEX(base.name) && EX[base.name][1] === 'X' && EX[base.name][2] === 4 && isDDD(base.name))) st.issue(i, '텔은 랭크4 DDD 엑시즈 위에만 겹침(' + base.name + ')');
        } else if (x === '데스마키나') {
          if (!isDDD(base.name)) st.issue(i, '데스마키나는 DDD 위에만 겹침(' + base.name + ')');
          if (inEX(base.name) && EX[base.name][1] === 'L') st.issue(i, '[룰확인] 링크 몬스터(' + base.name + ') 위 데스마키나 겹치기');
        } else st.issue(i, x + '은(는) 겹치기 소환 불가');
        removeEq(st.field, base);
        st.field.push({ name: x, lvl: null, mats: base.mats.concat([base.name]), own_lance: false });
        return true;
      }
      var needLv = { '솔로몬': 4, '시져': 4, '텔': 5, '대왕시져': 6, '데스마키나': 10 }[x];
      var got = [];
      for (k = 0; k < mats.length; k++) {
        n = mats[k]; o = st.mon(n);
        if (!o) { st.issue(i, '엑시즈 소재 ' + n + '이(가) 필드에 없음'); continue; }
        if (o.lvl !== needLv) st.issue(i, x + ' 소재 ' + n + ' 레벨 ' + o.lvl + ' ≠ ' + needLv);
        removeEq(st.field, o);
        (o.mats || []).forEach(function (mt) { inc(st.gy, mt); });
        got.push(n);
      }
      if (mats.length !== 2) st.issue(i, x + ' 소재 수 ' + mats.length);
      st.field.push({ name: x, lvl: null, mats: got, own_lance: false });
      return true;
    }
    if (kind === '싱크로' || (kind === '특소' && (x === '사이프리트' || x === '클로비스'))) {
      mats = namesIn(mats_s);
      var tot = 0, tuners = 0;
      for (k = 0; k < mats.length; k++) {
        n = mats[k]; o = st.mon(n);
        if (!o) { st.issue(i, '싱크로 소재 ' + n + '이(가) 필드에 없음'); continue; }
        tot += o.lvl || 0;
        if (inMAIN(n) && MAIN[n][4]) tuners += 1;
        st.leave_field_mon(i, o, 'syn');
      }
      if (tot !== EX[x][2]) st.issue(i, x + ' 레벨 합 ' + tot + ' ≠ ' + EX[x][2]);
      if (tuners !== 1) st.issue(i, x + ' 튜너 ' + tuners + '장');
      st.summon(i, x);
      return true;
    }
    if (kind === '링크' || (kind === '특소' && (x === '빌가메스' || x === '제우스'))) {
      mats = namesIn(mats_s);
      for (k = 0; k < mats.length; k++) {
        n = mats[k]; o = st.mon(n);
        if (!o) { st.issue(i, '링크 소재 ' + n + '이(가) 필드에 없음'); continue; }
        st.leave_field_mon(i, o, 'gy');
      }
      if (x === '빌가메스' && mats.length !== 2) st.issue(i, '빌가메스 소재 ' + mats.length + '장');
      if (x === '제우스') {
        var lsm = mats.reduce(function (a, nm) { return a + (inEX(nm) && EX[nm][1] === 'L' ? EX[nm][2] : 1); }, 0);
        if (!(mats.length <= 3 && 3 <= lsm) || mats.length < 2) st.issue(i, '제우스 링크3 소재 불일치 ' + pyList(mats));
      }
      st.summon(i, x);
      if (x === '빌가메스') st.ddonly = true;
      return true;
    }
    if ((kind === '융합' || kind === '특소') && (x === '알프레드' || x === '테무진')) {
      mats = namesIn(mats_s);
      if (full.indexOf('알프레드 효과') >= 0) {
        if (!st.mon('알프레드')) st.issue(i, '알프레드가 필드에 없음');
        st.take_opt(i, '알프레드1');
        for (k = 0; k < mats.length; k++) {
          n = mats[k]; o = st.mon(n);
          if (g(st.ban, n) > 0) { st.ban[n] -= 1; inc(inEX(n) ? st.ex : st.deck, n); }
          else if (o) st.leave_field_mon(i, o, 'deck');
          else if (g(st.hand, n) > 0) { st.hand[n] -= 1; inc(st.deck, n); }
          else st.issue(i, '알프레드 ①: ' + n + '이(가) 패/필드/제외에 없음');
        }
      } else {
        if (g(st.gy, '네크로') <= 0) st.issue(i, '네크로가 묘지에 없음');
        st.take_opt(i, '네크로');
        for (k = 0; k < mats.length; k++) {
          n = mats[k];
          if (g(st.gy, n) > 0) { st.gy[n] -= 1; inc(st.ban, n); }
          else st.issue(i, '네크로 융합 소재 ' + n + '이(가) 묘지에 없음');
        }
      }
      st.summon(i, x);
      return true;
    }
    st.issue(i, '[해석 못함] 엑덱 소환 ' + x + ' ' + kind + ' ' + mats_s);
    return true;
  }

  var STARTERS = {
    A1: ['케플러'], A2: ['케플러'], A3: ['지옥문'], A4: ['지옥문'], A5: ['제로마키나'], A6: ['제로마키나'], A7: ['제로마키나'], B1: ['케플러'],
    B2: ['지옥문'], B3: ['제로마키나'], C1: ['제로마키나'], C2: ['케플러'], C3: ['지옥문'], C4: ['제로마키나'], D1: ['지옥문'], D2: ['지옥문'],
    D3: ['제로마키나'], D4: ['제로마키나'], D5: ['케플러'], D6: ['케플러'], E1: ['케플러', '드롤'], E2: ['지옥문', '드롤'], F1: ['케플러'],
    F2: ['케플러'], F3: ['지옥문'], F4: ['지옥문'], F5: ['제로마키나'], F6: ['제로마키나'], G1: ['제로마키나', '지옥문']
  };

  // ------------------------------------------------------------ 루트 (engine.load_routes)
  var ROUTES = {}, ROUTE_IDS = [];
  routeList.forEach(function (r) {
    var steps = [], orig = [];
    r.steps.forEach(function (s0) {
      var s = s0.split('&#91;').join('[').split('\\]').join(']');
      orig.push(s);
      if (s.indexOf('원문 표기는') < 0) s = s.replace(/\s*\(원문[^)]*\)\s*$/, '');
      s = s.replace(/\s*\((이 턴 덱→패 불가|령왕은 필드에 남음|원본 로그엔 표기 생략)\)\s*$/, '');
      steps.push(s);
    });
    ROUTES[r.id] = { title: r.title, steps: steps, orig: orig };
    ROUTE_IDS.push(r.id);
  });

  // ------------------------------------------------------------ 효과 분류 (engine.classify)
  function classify(raw) {
    var s = norm(raw), m;
    var d = { src: null, loc: 'proc', cats: {}, raw: raw };
    if (s.indexOf('[상대]') === 0 || s.indexOf('내 드롤') === 0) { d.loc = 'opp'; return d; }
    if (/^(\S+) 일반소환/.test(s)) { d.cats.ns = 1; return d; }
    if ((m = /^(\S+) 서치[:(]\s*(\S+) 효과/.exec(s))) { d.src = m[2]; d.loc = m[2] === '지옥문' ? 'spell' : 'mon'; d.cats.search = 1; d.target = m[1]; return d; }
    if (s.indexOf('P존 세팅(자신 1000 데미지)') >= 0) { d.src = '빌가메스'; d.loc = 'mon'; return d; }
    if (s.indexOf('놓기(제로마키나 효과)') >= 0 && s.indexOf('P존에') !== 0) { d.src = '제로마키나'; d.loc = 'pz'; return d; }
    if (s.indexOf('P존에 놓기(제로마키나 효과)') === 0) { d.src = '제로마키나'; d.loc = 'ex'; return d; }
    if ((s.indexOf('알프레드 효과') >= 0 && s.indexOf('놓기') >= 0) || /^(\S+) 놓기$/.test(s)) { d.src = '알프레드'; d.loc = 'ban'; return d; }
    if (s.indexOf('령왕 효과') >= 0) { d.src = '령왕'; d.loc = 'spell'; d.cats.ss_deck = 1; d.cats.ss = 1; return d; }
    if (s.indexOf('랜스 특소') === 0) { d.src = '랜스'; d.loc = 'gy'; d.cats.gy_ss = 1; d.cats.ss = 1; d.gyuse = ['랜스']; return d; }
    if (s.indexOf('토마스 효과:') >= 0) { d.src = '토마스'; d.loc = 'mon'; d.cats.ss_deck = 1; d.cats.ss = 1; return d; }
    if (/^제로마키나 특소/.test(s)) { d.src = '제로마키나'; d.loc = 'ex'; d.cats.ss = 1; return d; }
    if (s === '오르트로스 특소(오르트로스 효과)') { d.src = '오르트로스'; d.loc = 'hand'; d.cats.ss = 1; return d; }
    if ((m = /^(스케일|그리폰) 특소\s*\((스케일|그리폰) 효과\)$/.exec(s)) && m[1] === m[2]) { d.src = m[1]; d.loc = 'hand'; d.cats.ss = 1; return d; }
    if ((m = /^(\S+) (?:소생|특소)\s*\((테무진|클로비스) 효과\)$/.exec(s))) {
      d.src = m[2]; d.loc = 'mon'; d.target = m[1]; d.cats.ss = 1;
      if (m[2] === '테무진') d.cats.gy_ss = 1;
      d.gyuse = [m[1]];
      return d;
    }
    if ((m = /^(\S+) (링크|엑시즈|싱크로|융합|특소)\s*\((.+?)\)$/.exec(s)) && inEX(m[1])) {
      var x = m[1], kind = m[2], mats = m[3];
      if (mats.indexOf('알프레드 효과') >= 0) { d.src = '알프레드'; d.loc = 'mon'; d.cats.ss = 1; }
      else if (kind === '융합' && (x === '알프레드' || x === '테무진')) { d.src = '네크로'; d.loc = 'gy'; d.cats.gy_banish = 1; d.cats.ss = 1; d.gyuse = ['네크로'].concat(namesIn(mats.split(':')[0])); }
      else if (x === '아크크라이시스') d.gyuse = namesIn(mats.split('제외:').join(''));
      d.summon_proc = kind;
      return d;
    }
    if ((m = /^(\S+) 묘지로\s*\((코페르|텔) 효과\)$/.exec(s))) { d.src = m[2]; d.loc = m[2] === '코페르' ? 'mon' : 'gy'; d.cats.send_deck = 1; return d; }
    if (s.indexOf('회수(토마스 효과)') >= 0) { d.src = '토마스'; d.loc = 'pz'; return d; }
    if ((m = /^(\S+) (?:바운스|패로 되돌림)\((스케일|케플러) 효과\)$/.exec(s))) { d.src = m[2]; d.loc = m[2] === '스케일' ? 'gy' : 'mon'; return d; }
    if (/P소환$/.test(s)) { d.cats.ps = 1; return d; }
    if (s.indexOf('제우스 효과') >= 0) { d.src = '제우스'; d.loc = 'mon'; return d; }
    if (s.indexOf('오르트로스 효과') >= 0) { d.src = '오르트로스'; d.loc = 'pz'; return d; }
    if (s === '그리폰 파괴(그리폰 효과)') { d.src = '그리폰'; d.loc = 'pz'; return d; }
    if (s.indexOf('레벨 4로(스케일 효과)') >= 0) { d.src = '스케일'; d.loc = 'mon'; return d; }
    if (s.indexOf('랜스 효과') >= 0) { d.src = '랜스'; d.loc = 'mon'; return d; }
    if (s.indexOf('텔 효과') >= 0) { d.src = '텔'; d.loc = 'mon'; return d; }
    return d;
  }

  function defaultSrc(d, n) {
    if (d.cats.ss_deck) return 'deck';
    if (d.src === '제로마키나' && d.loc === 'ex') return 'exup';
    if ((d.src === '스케일' || d.src === '그리폰' || d.src === '오르트로스') && d.loc === 'hand') return 'hand';
    if (d.src === '테무진' || d.src === '랜스') return 'gy';
    if (d.src === '클로비스') return 'ban';
    if (inEX(n)) return 'ex';
    return null;
  }

  // ------------------------------------------------------------ 몬스터 존 (engine)
  // 배치 하나 = 길이 7 배열(0~4 메인, 5 EX 왼쪽, 6 EX 오른쪽). 집합은 Map(키 → 배열)
  var LINK_ARROWS = { '빌가메스': ['BL', 'BR'], '제우스': ['BL', 'B', 'BR'], '비욘드': ['BL', 'BR'] };
  var EMZ_POINT = { 5: { BL: 0, B: 1, BR: 2 }, 6: { BL: 2, B: 3, BR: 4 } };
  var ZONE_CAP = 300;
  function zkey(cfg) { return cfg.map(function (x) { return x === null ? '\u0000' : x; }).join('\u0001'); }
  function pointed(cfg) {
    var pts = {};
    [5, 6].forEach(function (z) {
      var n = cfg[z];
      if (n && LINK_ARROWS[n]) LINK_ARROWS[n].forEach(function (a) { if (a in EMZ_POINT[z]) pts[EMZ_POINT[z][a]] = 1; });
    });
    return Object.keys(pts).map(Number);
  }
  function restricted(name, src) { if (src === 'exup') return true; return src === 'ex' && !!LINK_ARROWS[name]; }
  function place(cfgs, name, src) {
    var out = new Map();
    cfgs.forEach(function (cfg) {
      var emzUsed = cfg[5] !== null || cfg[6] !== null;
      var slots, z;
      if (restricted(name, src)) {
        slots = pointed(cfg).filter(function (q) { return cfg[q] === null; });
        if (!emzUsed) slots = slots.concat([5, 6]);
      } else {
        slots = []; for (z = 0; z < 5; z++) if (cfg[z] === null) slots.push(z);
        if (src === 'ex' && !emzUsed) slots = slots.concat([5, 6]);
      }
      slots.forEach(function (q) { var c = cfg.slice(); c[q] = name; out.set(zkey(c), c); });
    });
    if (out.size > ZONE_CAP) {
      var arr = Array.from(out.values()).sort(function (a, b) {
        for (var i = 0; i < 7; i++) { var x = a[i] || '', y = b[i] || ''; if (x < y) return -1; if (x > y) return 1; }
        return 0;
      }).slice(0, ZONE_CAP);
      out = new Map(); arr.forEach(function (c) { out.set(zkey(c), c); });
    }
    return out;
  }
  function zremove(cfgs, name) {
    var out = new Map();
    cfgs.forEach(function (cfg) {
      for (var z = 0; z < 7; z++) if (cfg[z] === name) { var c = cfg.slice(); c[z] = null; out.set(zkey(c), c); }
    });
    return out;
  }
  function fieldNames(st) { return cfrom(st.field.map(function (m) { return m.name; })); }
  function zoneReconcile(st) {
    if (!st.zones) { var e = [null, null, null, null, null, null, null]; st.zones = new Map([[zkey(e), e]]); st.zone_names = {}; }
    var cur = fieldNames(st);
    var gone = csub(st.zone_names, cur), nw = csub(cur, st.zone_names);
    var cf = st.zones, n, k;
    for (n in gone) for (k = 0; k < gone[n]; k++) cf = zremove(cf, n);
    for (n in nw) for (k = 0; k < nw[n]; k++) cf = place(cf, n, 'other');
    st.zones = cf; st.zone_names = cur;
  }
  function zoneStep(beforeNames, st, sm) {
    var cur = fieldNames(st);
    var entered = cfrom(sm.map(function (x) { return x[0]; }));
    var gone = csub(beforeNames, csub(cur, entered));
    var cf = st.zones, n, k;
    for (n in gone) for (k = 0; k < gone[n]; k++) cf = zremove(cf, n);
    sm.forEach(function (x) { if (cur[x[0]] !== undefined) cf = place(cf, x[0], x[1]); });
    st.zones = cf; st.zone_names = cur;
    return cf.size > 0;
  }

  // ------------------------------------------------------------ 한 단계 실행 (engine.step)
  var IGNORE = ['[룰확인]', '원문 표기 오류 추정', '출처 없는 덤프'];
  function realIssues(st, start) {
    return st.issues.slice(start).filter(function (x) { return !IGNORE.some(function (k) { return x[1].indexOf(k) >= 0; }); });
  }
  var LOCS = ['deck', 'ex', 'hand', 'gy', 'exup', 'ban'];
  function summonsOf(before, after) {
    var b = cfrom(before.field.map(function (x) { return x.name; }));
    var out = [];
    after.field.forEach(function (x) {
      if (g(b, x.name) > 0) { b[x.name] -= 1; return; }
      var n = x.name, src = null;
      for (var i = 0; i < LOCS.length; i++) if (g(after[LOCS[i]], n) < g(before[LOCS[i]], n)) { src = LOCS[i]; break; }
      if (src === null && inEX(n)) src = 'ex';
      out.push([n, src]);
    });
    return out;
  }
  function step(st, i, raw, strict) {
    if (strict === undefined) strict = true;
    var d = classify(raw);
    var nw = st.clone();
    nw._summoned = [];
    zoneReconcile(nw);
    var zoneBefore = ccopy(nw.zone_names);
    var start = nw.issues.length;
    if (d.loc === 'mon' && d.src) {
      var mm = nw.mon(d.src);
      if (mm === null) nw.issue(i, d.src + ' 필드에 없음');
      else if (mm.neg) nw.issue(i, d.src + ' 효과 무효 상태');
    }
    if (d.loc === 'pz' && d.src && raw.indexOf('재발동') < 0 && !nw.pz.some(function (p) { return p.name === d.src; })) nw.issue(i, d.src + ' P존에 없음');
    var destroyedBefore = nw.last_destroyed.slice();
    nw.last_destroyed = [];
    var mt = /코스트 (\S+)\)/.exec(raw);
    if (mt && raw.indexOf('텔 효과') >= 0) {
      var t = nw.mon('텔');
      if (t && t.mats.indexOf(mt[1]) < 0 && t.mats.length) raw = raw.replace(/: 코스트 \S+\)/g, ')');
    }
    var ok;
    if (norm(raw) === '오르트로스 특소(오르트로스 효과)') {
      if (g(nw.hand, '오르트로스') <= 0) nw.issue(i, '오르트로스가 패에 없음');
      else if (!st.took_damage) nw.issue(i, '오르트로스 ①: 직전에 데미지를 받지 않음');
      else { nw.hand['오르트로스'] -= 1; nw.summon(i, '오르트로스'); }
      ok = true;
    } else ok = handle(nw, i, norm(raw), destroyedBefore);
    nw.took_damage = raw.indexOf('자신 1000 데미지') >= 0;
    if (!ok) nw.issue(i, '[해석 못함] ' + raw);
    var bad = realIssues(nw, start);
    if (bad.length && strict) return [st, false, bad];
    var called = (nw._summoned || []).slice();
    nw._summoned = [];
    var pool = summonsOf(st, nw).slice();
    var sm = [];
    called.forEach(function (n) {
      var hi = -1;
      for (var q = 0; q < pool.length; q++) if (pool[q][0] === n) { hi = q; break; }
      if (hi >= 0) { sm.push(pool[hi]); pool.splice(hi, 1); } else sm.push([n, defaultSrc(d, n)]);
    });
    sm = sm.concat(pool);
    if (!zoneStep(zoneBefore, nw, sm)) {
      nw.issue(i, '몬스터 존 배치 불가(링크 마커·EX 존 제한)');
      if (strict) return [st, false, realIssues(nw, start)];
    }
    nw.sums = (st.sums || 0) + sm.length;
    nw.ss_events = st.ss_events || [];
    if (sm.length && !d.cats.ns) nw.ss_events = nw.ss_events.concat([[i, sm]]);
    return [nw, true, bad];
  }
  function initState(hand) { var s = new State(hand); s.sums = 0; s.ss_events = []; return s; }

  // ------------------------------------------------------------ 점수 (engine)
  var W = { '제우스': 3, '사이프리트': 3, '대왕시져': 3, '데스마키나': 3, '아크크라이시스': 1.5, '솔로몬': 1, '텔': 0.8, '시져': 0.8, '클로비스': 0.6, '테무진': 0.6, '알프레드': 0.6, '빌가메스': 0.4, '제로마키나': 0.8 };
  function wOf(n) { return Object.prototype.hasOwnProperty.call(W, n) ? W[n] : 0.3; }
  function zmReady(st) { return g(st.exup, '제로마키나') > 0 && g(st.opt, '제로마키나1') === 0; }
  function score(st) {
    var s = 0;
    st.field.forEach(function (m) {
      if (m.name === '니비루토큰') return;
      var v = wOf(m.name);
      if (m.name === '데스마키나' && !(m.mats && m.mats.length)) v = 1.5;
      if (m.neg) v *= 0.3;
      s += v;
    });
    if (st.st.indexOf('상암') >= 0 && st.pz.filter(function (p) { return inMAIN(p.name) || inEX(p.name); }).length === 2) s += 2;
    if (zmReady(st) && st.st.length) s += 1.5;
    return round2(s);
  }
  function describe(st) {
    var out = {
      monsters: st.field.map(function (m) { return m.name + (m.neg ? '(무효)' : ''); }),
      contracts: st.st.slice(), pzones: st.pz.map(function (p) { return p.name; }),
      ex_faceup: [], hand: [], zm_ready: zmReady(st)
    };
    var k, j;
    for (k in st.exup) for (j = 0; j < st.exup[k]; j++) out.ex_faceup.push(k);
    for (k in st.hand) if (st.hand[k] > 0) for (j = 0; j < st.hand[k]; j++) out.hand.push(k);
    var intr = [];
    st.field.forEach(function (m) {
      var n = m.name;
      if (m.neg) return;
      if (n === '제우스' && g(st.opt, '제우스2') === 0) intr.push('제우스②(패 몬스터 효과 무효)');
      else if (n === '사이프리트' && g(st.opt, '사이프리트1') === 0) intr.push('사이프리트①(앞면 마함 무효)');
      else if (n === '대왕시져' && m.mats && m.mats.length) intr.push('대왕시져①(특소 포함 효과 무효, 소재 ' + m.mats.length + ')');
      else if (n === '데스마키나') intr.push('데스마키나②(상대 필드 몬스터 효과 흡수)');
    });
    if (zmReady(st)) intr.push('제로마키나①(DDD·계약서 파괴 시 엑덱에서 특소+1장 파괴)');
    if (st.st.indexOf('상암') >= 0 && st.pz.length === 2) intr.push('상암①(몬스터 대상 마함·소재 사용 금지)');
    out.interruptions = intr;
    out.score = score(st);
    return out;
  }

  // ------------------------------------------------------------ 대체 단계 (engine._alts)
  function alts(st, raw, rest) {
    var s = norm(raw), out = [], m, m2;
    var later = rest.join(' ');
    function cost(names) { return names.reduce(function (a, n) { return a + (later.indexOf(n) >= 0 ? 5 : 0) + wOf(n); }, 0); }
    var fieldn = st.field.filter(function (q) { return isDDMon(q.name); }).map(function (q) { return q.name; });
    function pref(names) { return stableSortBy(names, function (n) { return [later.indexOf(n) >= 0 ? 0 : 1, -(inMAIN(n) ? MAIN[n][0] : 0)]; }); }
    var dk = Object.keys(st.deck);
    var deckP = dk.filter(function (n) { return st.deck[n] > 0 && inMAIN(n) && MAIN[n][1] === 'P'; });
    var deckMon = dk.filter(function (n) { return st.deck[n] > 0 && inMAIN(n) && n !== '드롤'; });
    var deckAny = deckMon.concat(dk.filter(function (n) { return st.deck[n] > 0 && inCON(n); }));
    if ((m = /^(.+?) P존 세팅\(자신 1000 데미지\)$/.exec(s))) {
      var orig = namesIn(m[1]);
      var keep = orig.filter(function (n) { return g(st.deck, n) > 0; });
      var pl = pref(deckP.filter(function (n) { return keep.indexOf(n) < 0; }));
      var pairs = keep.length === 1 ? pl.map(function (o) { return [keep[0], o]; }) : combinations(pl, 2);
      pairs.slice(0, 12).forEach(function (p) { out.push(p[0] + '·' + p[1] + ' P존 세팅(자신 1000 데미지)'); });
      return out;
    }
    if ((m = /^(\S+) 서치[:(]\s*(\S+) 효과\)?$/.exec(s)) && g(st.deck, m[1]) <= 0) {
      pref(deckAny.filter(function (n) { return n !== m[1]; })).slice(0, 10).forEach(function (t) { out.push(t + ' 서치(' + m[2] + ' 효과)'); });
      return out;
    }
    if ((m = /^(\S+) 묘지로\s*\((코페르|텔) 효과\)$/.exec(s)) && g(st.deck, m[1]) <= 0) {
      pref(deckAny.filter(function (n) { return n !== m[1] && n !== '코페르'; })).slice(0, 8).forEach(function (t) { out.push(t + ' 묘지로(' + m[2] + ' 효과)'); });
      return out;
    }
    if ((m = /^(\S+?)[·&]오르트로스 파괴\(오르트로스 효과\)$/.exec(s)) && !st.pz.some(function (p) { return p.name === '오르트로스'; }) && g(st.hand, '오르트로스') > 0) {
      out.push('오르트로스 P존 세팅 ;; ' + m[1] + '·오르트로스 파괴(오르트로스 효과)');
    }
    if ((m2 = /^(\S+) 특소\(령왕 효과: (\S+) 파괴\)$/.exec(s)) && g(st.deck, m2[1]) <= 0) {
      pref(deckMon.slice()).slice(0, 6).forEach(function (x) { out.push(x + ' 특소(령왕 효과: ' + m2[2] + ' 파괴)'); });
    }
    m = /^(\S+) 특소\(령왕 효과(?:: (.+?))?\)$/.exec(s) || /^(\S+) 파괴 → (\S+) 특소\(령왕 효과\)$/.exec(s);
    if (m && s.indexOf('령왕 효과') >= 0) {
      var x = s.indexOf('특소(령왕') >= 0 ? m[1] : m[2];
      var cands = stableSortBy(uniq(fieldn.concat(st.pz.map(function (p) { return p.name; }))), function (n) { return cost([n]); });
      cands.forEach(function (y) { out.push(x + ' 특소(령왕 효과: ' + y + ' 파괴)'); });
      return out;
    }
    m = /^(빌가메스|제우스|솔로몬|대왕시져|클로비스|사이프리트) (링크|엑시즈|싱크로|특소)\((.+)\)$/.exec(s) || /^(빌가메스|제우스|솔로몬|대왕시져|클로비스|사이프리트)\((.+)\)$/.exec(s);
    if (m) {
      var xx = m[1];
      var kind = { '빌가메스': '링크', '제우스': '링크', '솔로몬': '엑시즈', '대왕시져': '엑시즈', '클로비스': '싱크로', '사이프리트': '싱크로' }[xx];
      var mons = st.field.filter(function (q) { return isDDMon(q.name); });
      var combos = [];
      [2, 3].forEach(function (r) {
        combinations(mons.map(function (_, j) { return j; }), r).forEach(function (cmb) {
          var ms = cmb.map(function (j) { return mons[j]; });
          var names = ms.map(function (q) { return q.name; });
          if (xx === '빌가메스' && r === 2) combos.push(names);
          else if (xx === '제우스') {
            var rating = names.reduce(function (a, n) { return a + (inEX(n) && EX[n][1] === 'L' ? EX[n][2] : 1); }, 0);
            if ((r === 2 && rating >= 3) || r === 3) combos.push(names);
          } else if (xx === '솔로몬' && r === 2 && ms.every(function (q) { return q.lvl === 4; })) combos.push(names);
          else if (xx === '대왕시져' && r === 2 && ms.every(function (q) { return q.lvl === 6; })) combos.push(names);
          else if (xx === '클로비스' || xx === '사이프리트') {
            var tun = ms.filter(function (q) { return inMAIN(q.name) && MAIN[q.name][4]; });
            var tot = ms.reduce(function (a, q) { return a + (q.lvl || 0); }, 0);
            if (tun.length === 1 && tot === EX[xx][2]) combos.push(names);
          }
        });
      });
      stableSortBy(combos, cost).forEach(function (names) { out.push(xx + ' ' + kind + '(' + names.join('+') + ')'); });
      return out;
    }
    if ((m = /^(.+?) ?P소환$/.exec(s))) {
      var listed = namesIn(m[1]).slice().sort();
      var nset = uniq(Object.keys(st.hand).concat(Object.keys(st.exup)).filter(function (n) { return inMAIN(n) && MAIN[n][1] === 'P'; })).sort();
      var pool = [];
      nset.forEach(function (n) { var c = g(st.hand, n) + g(st.exup, n); for (var q = 0; q < c; q++) pool.push(n); });
      var seen = {};
      for (var r = Math.min(pool.length, 5); r > 0; r--) {
        var cs = combinations(pool, r);
        for (var ci = 0; ci < cs.length; ci++) {
          var key = cs[ci].slice().sort();
          var ks = key.join('|');
          if (seen[ks] || key.join('|') === listed.join('|')) continue;
          seen[ks] = 1;
          out.push(cs[ci].join('·') + ' P소환');
          if (out.length >= 24) return out;
        }
      }
      return out;
    }
    if ((m = /^랜스 특소\s*\((?:랜스 효과: )?(\S+) 파괴\)$/.exec(s))) {
      st.st.forEach(function (c) { if (c !== m[1]) out.push('랜스 특소(랜스 효과: ' + c + ' 파괴)'); });
      return out;
    }
    if ((m = /^(\S+?)[·&](\S+?) 파괴\(오르트로스 효과\)$/.exec(s))) {
      st.st.concat(st.field.filter(function (q) { return isDDMon(q.name); }).map(function (q) { return q.name; })).forEach(function (c) {
        if (c !== '오르트로스') out.push(c + '·오르트로스 파괴(오르트로스 효과)');
      });
      return out;
    }
    if ((m = /^추가 P소환권\(제우스 효과: (\S+) 파괴\)$/.exec(s) || /^(\S+) 파괴 → 추가 P소환권\(제우스 효과\)$/.exec(s))) {
      var cz = st.st.concat(st.pz.map(function (p) { return p.name; }), st.field.filter(function (q) { return isDDMon(q.name) && q.name !== '제우스'; }).map(function (q) { return q.name; }));
      stableSortBy(uniq(cz), function (n) { return cost([n]); }).forEach(function (c) { out.push('추가 P소환권(제우스 효과: ' + c + ' 파괴)'); });
      return out;
    }
    if ((m = /^(텔|데스마키나) 엑시즈\((\S+?)(?: 위 겹침)?\)$/.exec(s) || /^(데스마키나)\((\S+?)(?:①|②)? 위 겹침\)$/.exec(s))) {
      var xt = m[1];
      var bases = xt === '텔' ? st.field.filter(function (q) { return q.name === '솔로몬' || q.name === '시져'; }).map(function (q) { return q.name; })
        : st.field.filter(function (q) { return isDDD(q.name) && q.name !== '데스마키나'; }).map(function (q) { return q.name; });
      stableSortBy(uniq(bases), function (n) { return cost([n]); }).forEach(function (b) { out.push(xt + ' 엑시즈(' + b + ')'); });
    }
    return out;
  }

  function insertOptions(st) {
    var opts = [];
    var hit = st.last_destroyed.some(function (d) { return d[0] === 'C' || ((d[0] === 'P' || d[0] === 'M') && isDDD(d[1]) && d[1] !== '제로마키나'); });
    if (hit && zmReady(st)) opts.push('제로마키나 특소(제로마키나 효과)');
    if (st.took_damage && g(st.hand, '오르트로스') > 0) opts.push('오르트로스 특소(오르트로스 효과)');
    return opts;
  }

  // ------------------------------------------------------------ 수순 재생 (engine.run_steps)
  var deadline = Infinity;
  function checkTime() { if (Date.now() > deadline) throw new Error('DD_CALC_TIMEOUT'); }
  function runSteps(st, steps, offset, label, lookahead, repair, maxBranch) {
    if (offset === undefined) offset = 1;
    if (repair === undefined) repair = true;
    if (maxBranch === undefined) maxBranch = 4;
    var done = [], skipped = [];
    var k = 0;
    while (k < steps.length) {
      checkTime();
      var raw = steps[k], i = offset + k;
      if (label && (raw.indexOf('[상대]') === 0 || raw.indexOf('내 드롤') === 0 || raw.indexOf('니비루 무효') >= 0)) { k++; continue; }
      var options = [];
      var r0 = step(st, i, raw);
      if (r0[1]) options.push([r0[0], [[label, i, raw]]]);
      if (repair && (!r0[1] || (lookahead && /P소환$/.test(raw)))) {
        var al = alts(st, raw, steps.slice(k + 1));
        for (var a = 0; a < al.length; a++) {
          var cur = st, ok2 = true, parts = al[a].split(' ;; '), lines = [];
          for (var p = 0; p < parts.length; p++) {
            var rr = step(cur, i, parts[p]);
            cur = rr[0]; ok2 = rr[1];
            if (!ok2) break;
            lines.push([label, i, parts[p] + ' (대체)']);
          }
          if (ok2) {
            options.push([cur, lines]);
            if (!lookahead || options.length > maxBranch) break;
          }
        }
      }
      if (!options.length) {
        var info = r0[2];
        skipped.push([label, i, raw, info && info.length ? info[0][1] : '']);
        k++; continue;
      }
      if (lookahead) {
        var extra = [];
        options.forEach(function (o) {
          insertOptions(o[0]).forEach(function (t) {
            var s2 = step(o[0], i, t);
            if (s2[1]) extra.push([s2[0], o[1].concat([[label, i, t + ' (추가)']])]);
          });
        });
        options = options.concat(extra);
      }
      if (options.length === 1 || !lookahead) { st = options[0][0]; done = done.concat(options[0][1]); k++; continue; }
      var best = null;
      var lim = options.slice(0, maxBranch * 2);
      for (var b = 0; b < lim.length; b++) {
        var fin = runSteps(lim[b][0], steps.slice(k + 1), i + 1, label, false)[0];
        var sc = score(fin);
        if (best === null || sc > best[0] + 1e-9) best = [sc, lim[b][0], lim[b][1]];
      }
      st = best[1]; done = done.concat(best[2]); k++;
    }
    return [st, done, skipped];
  }

  // ------------------------------------------------------------ 위치 비교와 이어 붙이기
  function prefixStates(rid, hand) {
    var r = ROUTES[rid];
    var st = initState(hand || STARTERS[rid]);
    var states = [st];
    for (var k = 1; k <= r.steps.length; k++) { st = step(st, k, r.steps[k - 1], false)[0]; states.push(st); }
    return states;
  }
  // 거리 가중치는 10배 정수로 계산해서 같은 거리끼리 정확히 같게 만든다(Python 은 float 합)
  var DW = { F: 10, P: 10, C: 10, H: 8, G: 4, E: 4, O: 6, N: 10 };
  function sig(st) {
    var c = {}, k;
    st.field.forEach(function (m) { inc(c, 'F:' + m.name); });
    st.pz.forEach(function (p) { inc(c, 'P:' + p.name); });
    st.st.forEach(function (x) { inc(c, 'C:' + x); });
    for (k in st.hand) if (st.hand[k] > 0) inc(c, 'H:' + k, st.hand[k]);
    for (k in st.gy) if (st.gy[k] > 0) inc(c, 'G:' + k, st.gy[k]);
    for (k in st.exup) if (st.exup[k] > 0) inc(c, 'E:' + k, st.exup[k]);
    for (k in st.opt) if (st.opt[k] > 0) inc(c, 'O:' + k);
    c.NS = st.ns;
    return c;
  }
  function dist(a, b) {
    var s = 0, k;
    for (k in a) s += Math.abs(a[k] - (b[k] || 0)) * DW[k[0]];
    for (k in b) if (!(k in a)) s += Math.abs(b[k]) * DW[k[0]];
    return s;
  }
  var PREFIX = {}, POS = [];
  ROUTE_IDS.forEach(function (rid) { PREFIX[rid] = prefixStates(rid); });
  ROUTE_IDS.forEach(function (rid) { PREFIX[rid].forEach(function (s, k) { POS.push([rid, k, sig(s)]); }); });

  // 같은 상태에서 여러 번 이어 붙일 때(패 하나에 루트별 호출) 위치 비교와 재생 결과를 한 번만 만든다.
  // 후보·선택 규칙은 그대로라 결과는 매번 따로 부를 때와 같다(fixtures/hands.json 으로 확인).
  function contCtx(st) {
    var sg = sig(st);
    var bestpos = {}, order = [];
    POS.forEach(function (p) {
      var rid = p[0], k = p[1];
      if (k >= ROUTES[rid].steps.length) return;
      var dd = dist(sg, p[2]);
      if (!(rid in bestpos)) { bestpos[rid] = [dd, k]; order.push(rid); }
      else if (dd < bestpos[rid][0]) bestpos[rid] = [dd, k];
    });
    return { st: st, bestpos: bestpos, ranked: stableSortBy(order, function (rid) { return bestpos[rid][0]; }), runs: {}, looks: {} };
  }
  function bestContinuation(st, own, topk, extraFirst, ctx) {
    if (topk === undefined) topk = 29;
    extraFirst = extraFirst || [];
    if (!ctx || ctx.st !== st || extraFirst.length) ctx = contCtx(st);
    var memo = !extraFirst.length;
    var cands = [];
    if (own) cands.push([own[0], own[1]]);
    var bestpos = ctx.bestpos;
    var ranked = ctx.ranked.slice(0, topk);
    var seen = {};
    ranked.forEach(function (rid) {
      var k = bestpos[rid][1];
      var key = ROUTES[rid].steps.slice(k).join('\u0001');
      if (seen[key]) return;
      seen[key] = 1;
      cands.push([rid, k + 1]);
    });
    var best = null, runs = [];
    cands.forEach(function (c) {
      var rid = c[0], fr = c[1], mk = rid + ':' + fr;
      var steps = ROUTES[rid].steps.slice(fr - 1);
      var pre = [], s0 = st, res;
      if (memo && ctx.runs[mk]) res = ctx.runs[mk];
      else {
        extraFirst.forEach(function (raw) { var r = step(s0, 0, raw); if (r[1]) { s0 = r[0]; pre.push(raw); } });
        res = runSteps(s0, steps, fr, rid, false);
        if (memo) ctx.runs[mk] = res;
      }
      var sc = score(res[0]);
      runs.push([sc, rid, fr, s0, pre, steps]);
      var cand = { route: rid, from: fr, pre: pre, done: res[1], skipped: res[2], state: res[0], score: sc };
      if (best === null || sc > best.score + 1e-9 || (Math.abs(sc - best.score) < 1e-9 && own && rid === own[0] && best.route !== own[0])) best = cand;
    });
    if (runs.length) {
      var top = stableSortBy(runs, function (x) { return -x[0]; }).slice(0, 2);
      top.forEach(function (x) {
        var mk = x[1] + ':' + x[2], res;
        if (memo && ctx.looks[mk]) res = ctx.looks[mk];
        else { res = runSteps(x[3], x[5], x[2], x[1], true); if (memo) ctx.looks[mk] = res; }
        var sc = score(res[0]);
        if (sc > best.score + 1e-9) best = { route: x[1], from: x[2], pre: x[4], done: res[1], skipped: res[2], state: res[0], score: sc };
      });
    }
    return best;
  }

  // ------------------------------------------------------------ 패트랩 (hits.py)
  var TRAPS = {
    ash: ['하루 우라라', 'hand_mon'], maxxc: ['증식의 G', 'hand_mon'], fuwalos: ['마루챠미 후와로스', 'hand_mon'], nibiru: ['원시생명태 니비루', 'hand_mon'],
    imperm: ['무한포영', 'trap'], veiler: ['이펙트 뵐러', 'hand_mon'], dominus: ['도미나스 임펄스', 'trap'], droll: ['드롤 & 로크 버드', 'hand_mon'],
    ogre: ['유령토끼', 'hand_mon'], belle: ['저택 와라시', 'hand_mon'], gyban: ['묘지 제외(바이스테어류·D.D. 크로우)', 'hand_mon']
  };
  var DOC = [
    ['droll', /^제로마키나 서치.?지옥문/, '지옥문', 'D1·D2', null], ['droll', /^코페르 서치\(카운트/, '제로마키나', 'D3', null],
    ['droll', /^케플러 서치\(카운트/, '제로마키나', 'D4', null], ['droll', /^령왕 서치\(케플러/, '케플러', 'D5·D6', null],
    ['maxxc', /령왕 효과/, '케플러', 'E1', '드롤'], ['maxxc', /령왕 효과/, '지옥문', 'E2', '드롤'], ['dominus', /령왕 효과/, '제로마키나', 'G1', '지옥문']
  ];
  var F_DOC = { A2: 'F1·F2', A4: 'F3·F4', A7: 'F5·F6' };
  var NIB_DOC = { A1: 1, A3: 1, A5: 1, A6: 1 };
  function docRef(rid, k, trap, raw) {
    var s0 = STARTERS[rid][0];
    for (var i = 0; i < DOC.length; i++) { var dd = DOC[i]; if (dd[0] === trap && dd[2] === s0 && dd[1].test(raw) && k <= 6) return [dd[3], dd[4]]; }
    if ((trap === 'imperm' || trap === 'veiler') && F_DOC[rid] && raw.indexOf('P존 세팅(자신 1000 데미지)') >= 0 && k < 20) return [F_DOC[rid], null];
    return [null, null];
  }
  function zeusOptions(st) {
    var z = st.mon('제우스');
    if (!z || z.neg || g(st.opt, '제우스2') > 0) return [];
    var mons = Object.keys(st.gy).filter(function (n) { return st.gy[n] > 0 && isDDMon(n); });
    var cons = Object.keys(st.gy).filter(function (n) { return st.gy[n] > 0 && inCON(n); });
    var out = [];
    mons.forEach(function (m) {
      cons.forEach(function (c) {
        var s = st.clone();
        s.gy[m] -= 1; s.gy[c] -= 1; inc(s.ban, m); inc(s.ban, c); inc(s.opt, '제우스2');
        out.push(['제우스 ②로 무효(코스트: 묘지 ' + m + '+' + c + ' 제외)', s]);
      });
    });
    return out;
  }
  function caesarOption(st) {
    var m = st.mon('대왕시져');
    if (!m || m.neg || !(m.mats && m.mats.length)) return [];
    var s = st.clone();
    var mm = s.mon('대왕시져');
    inc(s.gy, mm.mats.pop());
    return [['대왕시져 ①로 무효(소재 1개)', s]];
  }
  function optDiffOf(st, k, raw) {
    var tmp = step(st, k, raw, false)[0];
    var nw = st.clone();
    for (var key in tmp.opt) if (tmp.opt[key] > g(nw.opt, key)) nw.opt[key] = tmp.opt[key];
    if (raw.indexOf('지옥문 효과') >= 0 && nw.st.indexOf('지옥문') < 0 && g(nw.hand, '지옥문') > 0) { nw.hand['지옥문'] -= 1; nw.st.push('지옥문'); }
    if (raw.indexOf('령왕 효과') >= 0) {
      nw.ddonly = true;
      if (nw.st.indexOf('령왕') < 0 && g(nw.hand, '령왕') > 0) { nw.hand['령왕'] -= 1; nw.st.push('령왕'); }
    }
    if (raw.indexOf('P존 세팅(자신 1000 데미지)') >= 0) nw.ddonly = true;
    var m;
    if (raw.indexOf('솔로몬 효과') >= 0) { m = nw.mon('솔로몬'); if (m && m.mats.length) inc(nw.gy, m.mats.shift()); }
    if (raw.indexOf('텔 효과') >= 0 && raw.indexOf('데미지') >= 0) { m = nw.mon('텔'); if (m && m.mats.length) inc(nw.gy, m.mats.shift()); }
    nw.last_destroyed = [];
    return nw;
  }
  function negMon(st, name) { var s = st.clone(); var m = s.mon(name); if (m) m.neg = true; return s; }
  function tributeAll(st) {
    var s = st.clone();
    s.field.slice().forEach(function (m) { s.leave_field_mon(0, m, 'gy'); });
    s.field.push({ name: '니비루토큰', lvl: 11, mats: [], own_lance: false });
    s.last_destroyed = [];
    return s;
  }
  function destroyCard(st, name) { var s = st.clone(); s.last_destroyed = s.last_destroyed.slice(); var ok = s.destroy(0, name); return ok ? s : null; }
  function cont(state, rid, fr, extraFirst, topk) { return bestContinuation(state, [rid, fr], topk === undefined ? 29 : topk, extraFirst); }
  function pack(b) {
    return {
      route: b.route, from: b.from, pre: b.pre,
      skipped: b.skipped.map(function (x) { return { step: x[1], text: x[2], why: x[3] }; }),
      executed: b.done.map(function (x) { return x[2]; }), state: b.state, final: describe(b.state), score: b.score
    };
  }
  function maxBy(list, f) { var best = null; list.forEach(function (x) { if (best === null || f(x) > f(best)) best = x; }); return best; }

  // pre: 그 패로 만든 루트 단계별 상태(prefixStates). hand: 그 패(드롤 변형용)
  function simulate(rid, k, trap, pre, hand) {
    pre = pre || PREFIX[rid];
    var before = pre[k - 1], after = pre[k];
    var raw = ROUTES[rid].steps[k - 1];
    var d = classify(raw);
    var out, counters;
    if (['ash', 'imperm', 'veiler', 'dominus', 'belle'].indexOf(trap) >= 0) {
      var ns = optDiffOf(before, k, raw);
      if ((trap === 'imperm' || trap === 'veiler') && d.src) ns = negMon(ns, d.src);
      out = { effect: 'negated', response: pack(cont(ns, rid, k + 1)) };
      counters = [];
      if (TRAPS[trap][1] === 'hand_mon') zeusOptions(before).forEach(function (zo) {
        var r = step(zo[1], k, raw);
        if (r[1]) counters.push({ label: zo[0], response: pack(cont(r[0], rid, k + 1)) });
      });
      if (counters.length) out.counter = maxBy(counters, function (c) { return c.response.score; });
      return out;
    }
    if (trap === 'ogre') {
      var src = d.src;
      if (src === '지옥문' && after.st.indexOf('지옥문') < 0) return null;
      var s2 = destroyCard(after, src);
      if (s2 === null) {
        var onBefore = before.mon(src) || before.pz.some(function (p) { return p.name === src; }) || before.st.indexOf(src) >= 0;
        if (!onBefore) return null;
        return { effect: src + josa(src, '은', '는') + ' 이 효과로 어차피 파괴되는 카드라 영향 거의 없음(효과는 남은 대상에 처리)', response: pack(cont(after, rid, k + 1)) };
      }
      var extra = [];
      if (zmReady(s2) && src !== '제로마키나' && (isDDD(src) || inCON(src))) extra = ['제로마키나 특소(제로마키나 효과)'];
      var cands = [pack(cont(s2, rid, k + 1))];
      if (extra.length) cands.push(pack(cont(s2, rid, k + 1, extra)));
      out = { effect: src + ' 파괴(효과는 처리됨)', response: maxBy(cands, function (p) { return p.score; }) };
      counters = [];
      zeusOptions(before).forEach(function (zo) {
        var r = step(zo[1], k, raw);
        if (r[1]) counters.push({ label: zo[0], response: pack(cont(r[0], rid, k + 1)) });
      });
      if (counters.length) out.counter = maxBy(counters, function (c) { return c.response.score; });
      return out;
    }
    if (trap === 'droll') {
      var sd = after.clone(); sd.droll = true;
      out = { effect: '이후 덱→패 불가', response: pack(cont(sd, rid, k + 1)) };
      counters = zeusOptions(after).map(function (zo) { return { label: zo[0], response: pack(cont(zo[1], rid, k + 1)) }; });
      if (counters.length) out.counter = maxBy(counters, function (c) { return c.response.score; });
      return out;
    }
    if (trap === 'nibiru') {
      out = { effect: '필드 몬스터 전부 릴리스, 내 필드에 니비루 토큰', response: pack(cont(tributeAll(after), rid, k + 1)) };
      counters = zeusOptions(after).concat(caesarOption(after)).map(function (zo) { return { label: zo[0], response: pack(cont(zo[1], rid, k + 1)) }; });
      if (counters.length) out.counter = maxBy(counters, function (c) { return c.response.score; });
      return out;
    }
    if (trap === 'gyban') {
      var targets = (d.gyuse || []).filter(function (n) { return g(before.gy, n) > 0; });
      if (d.src === '클로비스' && g(before.ban, d.target || '') > 0) targets = targets.filter(function (n) { return n !== d.target; });
      if (!targets.length) return null;
      var worst = null;
      uniq(targets).sort().forEach(function (t) {
        var s = before.clone(); s.gy[t] -= 1; inc(s.ban, t);
        var p = pack(cont(s, rid, k));
        if (worst === null || p.score < worst[1].score) worst = [t, p];
      });
      out = { effect: '묘지의 ' + worst[0] + ' 제외', target: worst[0], response: worst[1] };
      counters = zeusOptions(before).concat(caesarOption(before)).map(function (zo) { return { label: zo[0], response: pack(cont(zo[1], rid, k)) }; });
      if (counters.length) out.counter = maxBy(counters, function (c) { return c.response.score; });
      return out;
    }
    if (trap === 'maxxc' || trap === 'fuwalos') {
      var full = pre[pre.length - 1];
      var evs = full.ss_events.filter(function (e) { return e[0] >= k; });
      if (trap === 'fuwalos') evs = evs.map(function (e) { return [e[0], e[1].filter(function (x) { return x[1] === 'deck' || x[1] === 'ex' || x[1] === 'exup'; })]; }).filter(function (e) { return e[1].length; });
      out = { effect: '이후 특소 ' + evs.length + '회 → 상대 ' + evs.length + '장 드로우', draws: evs.length, draw_steps: evs.map(function (e) { return e[0]; }), stop_now: describe(before) };
      if (evs.length) {
        var hv = (hand || STARTERS[rid]).slice();
        if (!hand || hv.indexOf('드롤') < 0) hv.push('드롤');
        var preD = prefixStates(rid, hv);
        var opts = [];
        evs.forEach(function (e, idx) {
          var j = e[0];
          var s = preD[j].clone();
          s.droll = true; inc(s.hand, '드롤', -1); inc(s.gy, '드롤');
          var fin = runSteps(s, ROUTES[rid].steps.slice(j), j + 1, rid, false)[0];
          opts.push([idx + 1, j, score(fin), s]);
        });
        var bestSc = Math.max.apply(null, opts.map(function (o) { return o[2]; }));
        var pick = null;
        opts.forEach(function (o) { if (o[2] >= bestSc - 1e-9 && (pick === null || o[0] < pick[0])) pick = o; });
        var early = opts[0];
        var chosen = [];
        (early !== pick ? [early] : []).concat([pick]).forEach(function (o) {
          chosen.push({ droll_after_step: o[1], opp_draws: o[0], response: pack(cont(o[3], rid, o[1] + 1)) });
        });
        out.with_droll = chosen;
      }
      var cs = [];
      zeusOptions(before).forEach(function (zo) {
        var r = step(zo[1], k, raw);
        if (r[1]) {
          var fin = runSteps(r[0], ROUTES[rid].steps.slice(k), k + 1, rid, false)[0];
          cs.push([score(fin), zo[0], zo[1], r[0]]);
        }
      });
      if (cs.length) {
        var bc = maxBy(cs, function (c) { return c[0]; });
        out.counter = { label: bc[1], response: pack(cont(bc[3], rid, k + 1)) };
      }
      return out;
    }
    return null;
  }

  function applicable(rid, k, pre) {
    pre = pre || PREFIX[rid];
    var raw = ROUTES[rid].steps[k - 1];
    var d = classify(raw);
    var before = pre[k - 1], after = pre[k];
    var traps = [];
    if (d.loc === 'opp') return traps;
    if (d.cats.search || d.cats.ss_deck || d.cats.send_deck) traps.push('ash');
    if (d.cats.search) traps.push('droll');
    if (d.loc === 'mon' && d.src && before.mon(d.src)) traps.push('imperm', 'veiler');
    if (d.cats.ss && d.loc !== 'proc') traps.push('dominus');
    if (d.loc === 'mon' && d.src && before.mon(d.src)) traps.push('ogre');
    if ((d.loc === 'spell' || d.loc === 'pz') && d.src) traps.push('ogre');
    var gySs = d.cats.gy_ss || (d.src === '클로비스' && g(before.ban, d.target || '') === 0);
    if (gySs || d.cats.gy_banish) traps.push('belle');
    if ((d.gyuse || []).some(function (n) { return g(before.gy, n) > 0; })) traps.push('gyban');
    if (summonsOf(before, after).length && !d.cats.ns) traps.push('maxxc', 'fuwalos');
    if (after.sums >= 5) traps.push('nibiru');
    return traps;
  }

  // ------------------------------------------------------------ 사이트용 출력(dd-handtraps.json 형식에 맞춤)
  var NAMEFIX = [['아크크라이시스', '아크 크라이시스'], ['니비루토큰', '니비루 토큰']];
  function nm(x) { NAMEFIX.forEach(function (p) { x = x.split(p[0]).join(p[1]); }); return x; }
  function fieldOf(st) {
    return {
      monsters: st.field.map(function (m) { return nm(m.name); }),
      negated_monsters: st.field.filter(function (m) { return m.neg; }).map(function (m) { return nm(m.name); })
    };
  }
  function finalOf(st) {
    var dsc = describe(st), f = fieldOf(st);
    return { monsters: f.monsters, negated_monsters: f.negated_monsters, contracts: dsc.contracts, pzones: dsc.pzones,
      zero_machinex_waiting_in_extra: dsc.zm_ready, interruptions: dsc.interruptions, score: dsc.score };
  }
  function planOf(p) {
    var steps = p.pre.map(function (s) { return nm(s) + ' (추가)'; }).concat(p.executed.map(nm));
    return { base_route: p.route, resume_from_step: p.from, steps: steps,
      skipped_original_steps: p.skipped.map(function (x) { return { step: x.step, text: nm(ROUTES[p.route].orig[x.step - 1] || x.text), why: x.why }; }),
      final: finalOf(p.state) };
  }
  function stateOf(st) {
    var dsc = describe(st), f = fieldOf(st);
    return { monsters: f.monsters, negated_monsters: f.negated_monsters, contracts: dsc.contracts, pzones: dsc.pzones, hand: dsc.hand, extra_faceup: dsc.ex_faceup };
  }
  // 한 레코드 계산: hand 가 없으면 루트 시작 패 기준(미리 만든 데이터와 같은 조건)
  function record(rid, k, trap, hand) {
    var pre = hand ? prefixStates(rid, hand) : PREFIX[rid];
    var raw = ROUTES[rid].steps[k - 1];
    var before = pre[k - 1], after = pre[k];
    var row = { route: rid, step: k, step_text: ROUTES[rid].orig[k - 1], trap: trap, trap_name: TRAPS[trap][0],
      monsters_summoned_so_far: after.sums, state_at_hit: stateOf(trap === 'droll' || trap === 'nibiru' ? after : before), computed: true };
    var applies = applicable(rid, k, pre);
    if (applies.indexOf(trap) < 0) { row.not_applicable = true; return row; }
    var dr = docRef(rid, k, trap, raw), ref = dr[0], cond = dr[1];
    if (trap === 'nibiru' && NIB_DOC[rid] && after.sums === 5) ref = '문서: 5체째 제우스 ②로 무효';
    if (ref && ref.split('·').join(' ').split(/\s+/).indexOf(rid) >= 0) { row.documented = '이 루트(' + rid + ') 자체가 이 상황의 대응 루트'; return row; }
    if (ref && !cond) { row.documented = ref; return row; }
    var r = simulate(rid, k, trap, pre, hand);
    if (r === null) { row.not_applicable = true; return row; }
    row.hit_effect = r.effect;
    if (r.target) row.banished_target = r.target;
    if (r.response) row.plan = planOf(r.response);
    if (r.counter) row.counter = { how: r.counter.label, plan: planOf(r.counter.response) };
    if (r.draws !== undefined) {
      row.opp_draws_if_continue = r.draws; row.draw_steps = r.draw_steps;
      row.with_my_droll = (r.with_droll || []).map(function (w) { return { activate_after_step: w.droll_after_step, opp_draws: w.opp_draws, plan: planOf(w.response) }; });
    }
    if (ref && cond) row.documented = '패에 ' + cond + '이 있으면 문서 루트 ' + ref;
    return row;
  }

  // 패 → 최고 수순 (fillgaps.solve 와 같은 방식). shared=false 면 루트마다 위치 비교·재생을 새로 한다(비교 시험용)
  function solveHand(mh, banish, allowNoStarter, shared) {
    var st = initState(mh);
    (banish || []).forEach(function (b) { if (g(st.deck, b) > 0) { st.deck[b] -= 1; inc(st.ban, b); } });
    var ctx = shared === false ? null : contCtx(st);
    var hc = cfrom(mh), best = null, tried = [];
    ROUTE_IDS.forEach(function (rid) {
      var need = cfrom(STARTERS[rid]);
      for (var c in need) if (g(hc, c) < need[c]) return;
      var b = bestContinuation(st, [rid, 1], 29, null, ctx);
      tried.push(rid);
      if (best === null || b.score > best.score) best = b;
    });
    if (best === null && allowNoStarter !== false) ROUTE_IDS.forEach(function (rid) {
      var b = bestContinuation(st, [rid, 1], 10, null, ctx);
      if (best === null || b.score > best.score) best = b;
    });
    return { best: best, tried: tried };
  }
  function solveHandOut(mh, banish, allowNoStarter) {
    var r = solveHand(mh, banish, allowNoStarter);
    if (!r.best) return null;
    var p = pack(r.best);
    return { hand: mh, tried: r.tried, plan: planOf(p), score: p.score };
  }

  var MODEL = {}; Object.keys(MAIN).concat(Object.keys(CONTRACTS)).forEach(function (n) { MODEL[n] = 1; });
  // 실제 패 전체(모델에 없는 카드 포함)로 수순 계산.
  // sw: 스몰 월드 후보 [{reveal, bridge, target}] — 사이트가 dd-smallworld.json 경로를 dd-planlib.json 장수 검사로 골라 넘긴 것만 계산한다
  function solveFull(full, sw) {
    var modeled = full.filter(function (n) { return MODEL[n]; }).sort();
    var res = { modeled: modeled, base: null, smallWorld: [], note: '' };
    var hasStarter = ROUTE_IDS.some(function (rid) { var need = cfrom(STARTERS[rid]), hc = cfrom(modeled); for (var c in need) if (g(hc, c) < need[c]) return false; return true; });
    if (hasStarter) res.base = solveHandOut(modeled);
    var seen = {};
    (sw || []).forEach(function (p) {
      if (full.indexOf(p.reveal) < 0 || full.indexOf('스몰월드') < 0) return;
      var h2 = full.slice(); h2.splice(h2.indexOf(p.reveal), 1); h2.splice(h2.indexOf('스몰월드'), 1); h2.push(p.target);
      var m2 = h2.filter(function (n) { return MODEL[n]; }).sort();
      var ban = MODEL[p.bridge] ? [p.bridge] : [];
      var key = m2.join('+') + '|' + ban.join('');
      if (seen[key]) return;
      seen[key] = { reveal: p.reveal, bridge: p.bridge, target: p.target, planlibScore: p.planlibScore, result: solveHandOut(m2, ban) };
      res.smallWorld.push(seen[key]);
    });
    if (!res.base && !res.smallWorld.length) res.note = modeled.length ? '이니시(루트 시작 카드)가 패에 없고, 스몰 월드로 갈 수 있는 수순도 없어 계산하지 않았다' : '계산기에 들어가는 카드가 패에 없다';
    return res;
  }

  return {
    ROUTES: ROUTES, ROUTE_IDS: ROUTE_IDS, STARTERS: STARTERS, PREFIX: PREFIX, TRAPS: TRAPS, MODELED: Object.keys(MAIN).concat(Object.keys(CONTRACTS)),
    initState: initState, step: step, runSteps: runSteps, bestContinuation: bestContinuation, score: score, describe: describe,
    prefixStates: prefixStates, simulate: simulate, applicable: applicable, record: record, solveHand: solveHand, solveHandOut: solveHandOut,
    solveFull: solveFull,
    classify: classify, alts: alts, namesIn: namesIn, norm: norm,
    setDeadline: function (ms) { deadline = ms ? Date.now() + ms : Infinity; }
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = DD_CALC_FACTORY;
