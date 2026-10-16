/* DD4 전개 도우미 — 바닐라 JS. 데이터는 data/dd-data.js(window.DD_DATA)에서 읽는다. */
(function () {
  'use strict';

  var D = window.DD_DATA;
  var app = document.getElementById('app');
  if (!D) {
    app.innerHTML = '<div class="panel"><h2>데이터를 못 불러왔다</h2><p>data/dd-data.js 파일이 없거나 깨졌다. ' +
      'README.md의 "데이터 다시 만들기" 명령을 실행한 뒤 새로고침해줘.</p></div>';
    return;
  }
  var C = D.config;
  var HAND_MAX = 6;

  // ------------------------------------------------------------ 색인
  var cardsByName = {}, routesById = {}, effectsByCard = {}, ffByCard = {}, groupsById = {};
  D.cards.forEach(function (c) { cardsByName[c.name] = c; });
  D.routes.forEach(function (r) { routesById[r.id] = r; });
  D.cardEffects.forEach(function (e) { effectsByCard[e.card] = e; });
  D.finalField.rows.forEach(function (f) { ffByCard[f.card] = f; });
  D.groups.forEach(function (g) { groupsById[g.id] = g; });
  var mainCards = D.cards.filter(function (c) { return c.zone === '메인'; });

  function short(name) { return (cardsByName[name] && cardsByName[name].short) || name; }

  // ------------------------------------------------------------ 저장(localStorage, 실패해도 동작)
  var KEY = 'dd4-helper-v1';
  function loadState() {
    try { return JSON.parse(window.localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
  }
  var state = Object.assign({ tab: 'hand', hand: {}, concern: 'none', routeId: null, checks: {}, trap: null, rev: 'handMonster', theme: 'auto' }, loadState());
  // 저장된 값 정리(덱이 바뀌었을 때 대비)
  Object.keys(state.hand).forEach(function (n) {
    var c = cardsByName[n];
    if (!c || c.zone !== '메인' || !(state.hand[n] > 0)) delete state.hand[n];
    else state.hand[n] = Math.min(state.hand[n], c.count);
  });
  if (state.routeId && !routesById[state.routeId]) state.routeId = null;

  // ------------------------------------------------------------ 문자열 도우미
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  var MARK_RE = /(원문 생략|미검증|미확인|추정|해석|보완|생략)/g;
  function hl(s) { return esc(s).replace(MARK_RE, '<mark class="m">$1</mark>'); }
  // 문장 속 루트 ID를 누르면 그 루트를 여는 버튼으로 바꾼다
  function linkIds(htmlText) {
    return htmlText.replace(/(^|[^A-Za-z0-9])([A-G]\d{1,2})(?![0-9A-Za-z])/g, function (m, pre, id) {
      return routesById[id] ? pre + '<button class="rid" data-act="open-route" data-id="' + id + '">' + id + '</button>' : m;
    });
  }
  function inline(s) {
    var h = hl(s);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return h;
  }
  function textBlock(s) { return linkIds(inline(s)); }

  // 아주 작은 마크다운 렌더러(문서 탭용): 제목, 표, 목록, 문단
  function md(src) {
    var lines = String(src || '').split('\n'), out = '', i = 0;
    function isBlockStart(l) { return /^#{1,4}\s/.test(l) || /^- /.test(l) || /^\d+\.\s/.test(l) || /^\s*\|/.test(l); }
    while (i < lines.length) {
      var l = lines[i];
      if (!l.trim()) { i++; continue; }
      var m = l.match(/^(#{1,4})\s+(.*)$/);
      if (m) { var lv = Math.min(m[1].length + 2, 6); out += '<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>'; i++; continue; }
      if (/^\s*\|/.test(l) && lines[i + 1] && /^\s*\|\s*-/.test(lines[i + 1])) {
        var head = cells(l); i += 2; var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out += table(head, rows);
        continue;
      }
      if (/^- /.test(l)) {
        out += '<ul>';
        while (i < lines.length && /^- /.test(lines[i])) { out += '<li>' + textBlock(lines[i].slice(2)) + '</li>'; i++; }
        out += '</ul>'; continue;
      }
      if (/^\d+\.\s/.test(l)) {
        out += '<ol>';
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) { out += '<li>' + textBlock(lines[i].replace(/^\d+\.\s+/, '')) + '</li>'; i++; }
        out += '</ol>'; continue;
      }
      var buf = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { buf.push(lines[i].trim()); i++; }
      out += '<p>' + textBlock(buf.join(' ')) + '</p>';
    }
    return out;
  }
  function cells(line) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
  function table(head, rows) {
    var h = '<table class="doc"><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>' + head.map(function (hd, k) { return '<td data-label="' + esc(hd) + '">' + textBlock(r[k] || '') + '</td>'; }).join('') + '</tr>';
    });
    return h + '</tbody></table>';
  }
  function quote(q) {
    if (!q) return '';
    return '<blockquote class="q">' + textBlock(q.text) + '<span class="src">dd-guide.md · ' + esc(q.section) + '</span></blockquote>';
  }
  function routeTitle(r) { return '<button class="rid" data-act="open-route" data-id="' + r.id + '">' + r.id + '</button> ' + hl(r.name); }

  // ------------------------------------------------------------ 패 계산
  function handSize(hand) { return Object.keys(hand).reduce(function (a, k) { return a + hand[k]; }, 0); }
  function cnt(hand, name) { return hand[name] || 0; }
  function deckLeft(hand, name) { return (cardsByName[name] ? cardsByName[name].count : 0) - cnt(hand, name); }
  function initiatorCount(hand) { return C.initiatorCards.reduce(function (a, c) { return a + cnt(hand, c); }, 0); }

  // 조건 목록(requires)을 서로 다른 카드로 채울 수 있는지
  function satisfies(reqs, hand) {
    var pool = Object.assign({}, hand), used = [];
    for (var i = 0; i < reqs.length; i++) {
      var r = reqs[i], pick = null;
      if (r.kind === 'initiatorCount') { if (initiatorCount(hand) < r.min) return null; continue; }
      var keys = Object.keys(pool).filter(function (k) { return pool[k] > 0; });
      if (r.kind === 'anyOf') pick = r.cards.filter(function (c) { return pool[c] > 0; })[0];
      else if (r.kind === 'otherDD') pick = keys.filter(function (k) { return cardsByName[k] && cardsByName[k].isDD; })[0];
      else if (r.kind === 'any') pick = keys[0];
      if (!pick) return null;
      pool[pick]--; used.push(pick);
    }
    return used;
  }

  var IT = D.initiatorTable;
  var KIND_LABEL = {
    'default': IT.header[1], solomon: IT.header[2], thomas: IT.header[3],
    lookup: '조회표 1단계에 있음', variant: '기타 변형'
  };
  var variantBullet = (IT.bullets || []).filter(function (b) { return b.indexOf('C1은') === 0; })[0] || '';

  function routesForInitiator(init) {
    var row = IT.rows.filter(function (r) { return r.initiator === init; })[0];
    var items = [], seen = {};
    function add(id, kind) { if (!seen[id] && routesById[id]) { seen[id] = 1; items.push({ id: id, kind: kind }); } }
    if (row) {
      row['default'].ids.forEach(function (id) { add(id, 'default'); });
      row.solomon.ids.forEach(function (id) { add(id, 'solomon'); });
      row.thomas.ids.forEach(function (id) { add(id, 'thomas'); });
    }
    D.lookup.step1.rows.forEach(function (r) {
      if (r.cards.length === 1 && r.cards[0] === init) r.ids.forEach(function (id) { add(id, 'lookup'); });
    });
    D.routes.forEach(function (r) {
      if (r.group === 'C' && r.initiator.length === 1 && r.initiator[0] === init) add(r.id, 'variant');
    });
    return { row: row, items: items };
  }

  function rankOf(item, hand, concern) {
    var base = { 'default': 1, solomon: 2, thomas: 3, lookup: 4, variant: 5 }[item.kind];
    if (concern === 'negate' && item.kind === 'solomon') base = 0.5;
    if (cnt(hand, 'DD 마도현자 토마스') > 0 && item.kind === 'thomas') base = 0.2;
    return base;
  }

  function decorate(item, hand) {
    var r = routesById[item.id], tags = [], blocked = [], cautions = [];
    tags.push({ t: KIND_LABEL[item.kind], cls: 'accent' });
    if (C.routeSets['5체째 제우스'].indexOf(r.id) >= 0) tags.push({ t: '니비루 걱정이면 이쪽', cls: '' });
    if (C.routeSets['솔로몬 선출'].indexOf(r.id) >= 0) tags.push({ t: '단일 무효 걱정이면 이쪽', cls: '' });
    if (item.kind === 'thomas') tags.push({ t: '(해석)', cls: 'warn' });
    (D.lookup.step3.rows || []).forEach(function (row) {
      if (!row.card || cnt(hand, row.card) === 0) return;
      if (row.blockedIds.indexOf(r.id) >= 0) blocked.push(row);
      else if ((row.autoDetectedIds || []).indexOf(r.id) >= 0)
        cautions.push('자동 검출: 이 루트도 ' + short(row.card) + '을(를) 덱에서 부르는 단계가 있다. 3단계 표 목록에는 없는 루트.');
    });
    r.requiredHand.forEach(function (q) {
      if (q.reason !== '루트 이름의 시작 카드' && cnt(hand, q.card) === 0) cautions.push('필요한 패: ' + short(q.card) + ' (' + q.reason + ')');
    });
    return { id: r.id, kind: item.kind, tags: tags, blocked: blocked, cautions: cautions };
  }

  function evaluate(hand, concern) {
    var res = { plans: [], combos: [], convInfo: [], parts: [], inits: [], responses: [] };
    var inits = C.initiatorCards.filter(function (c) { return cnt(hand, c) > 0; });
    res.inits = inits;
    function plan(kind, title, detail, init) {
      var rf = routesForInitiator(init);
      var items = rf.items.map(function (it) { return decorate(it, hand); });
      items.sort(function (a, b) { return rankOf(a, hand, concern) - rankOf(b, hand, concern); });
      res.plans.push({ kind: kind, title: title, detail: detail, init: init, start: rf.row ? rf.row.start : '', items: items });
    }
    inits.forEach(function (init) { plan('initiator', '이니시: ' + short(init) + ' (' + cnt(hand, init) + '장)', '', init); });
    // 1단계 조회표의 2장 행(제로 마키나 + 지옥문)
    D.lookup.step1.rows.forEach(function (r) {
      if (r.cards.length > 1 && r.cards.every(function (c) { return cnt(hand, c) > 0; })) {
        res.combos.push({ title: '조회표 1단계: ' + r.hand, text: r.routes, basis: '' });
      }
    });
    // 2장 이상 조합 표
    D.combos.rows.forEach(function (c) {
      if (satisfies(c.requires, hand)) res.combos.push({ title: '2장 조합 표: ' + c.combo, text: c.action, basis: c.basis });
    });
    // 이니시가 없으면 변환 수단
    if (!inits.length) {
      D.lookup.step2.rows.forEach(function (cv) {
        var used = satisfies(cv.requires, hand);
        if (!used) return;
        var bridgeOk = !cv.bridge || deckLeft(hand, cv.bridge) > 0;
        if (cv.resultInitiators.length && bridgeOk) {
          cv.resultInitiators.forEach(function (init) {
            plan('conversion', '변환: ' + cv.hand + ' → ' + short(init) + ' 루트', cv.conversion + (cv.result.indexOf('참고') >= 0 ? ' (결과: ' + cv.result + ')' : ''), init);
          });
        } else {
          res.convInfo.push({ cv: cv, bridgeOk: bridgeOk });
        }
      });
    }
    // 3단계: 1장뿐인 부품
    (D.lookup.step3.rows || []).forEach(function (row) { if (row.card && cnt(hand, row.card) > 0) res.parts.push(row); });
    // 갈아탈 루트(D~G)
    var initSet = {};
    res.plans.forEach(function (p) { initSet[p.init] = 1; });
    D.handTrapResponses.rows.forEach(function (row) {
      var ids = row.ids.filter(function (id) { var r = routesById[id]; return r && 'DEFG'.indexOf(r.group) >= 0 && initSet[r.initiator[0]]; });
      if (ids.length) res.responses.push({ row: row, ids: ids });
    });
    return res;
  }
  function viable(res) { return res.plans.some(function (p) { return p.items.some(function (i) { return !i.blocked.length; }); }); }

  function oneMore(hand, concern) {
    var out = [];
    mainCards.forEach(function (c) {
      if (deckLeft(hand, c.name) <= 0) return;
      var h2 = Object.assign({}, hand); h2[c.name] = cnt(h2, c.name) + 1;
      var r2 = evaluate(h2, concern);
      if (!viable(r2)) return;
      var via = r2.plans.filter(function (p) { return p.items.some(function (i) { return !i.blocked.length; }); }).map(function (p) {
        return { title: p.title, detail: p.detail, ids: p.items.filter(function (i) { return !i.blocked.length; }).map(function (i) { return i.id; }) };
      });
      out.push({ card: c, via: via });
    });
    return out;
  }

  // ------------------------------------------------------------ 패트랩 대응
  function summonsUpTo(route, n) { return route.steps.filter(function (s) { return s.n <= n && s.isSummon; }).length; }
  function currentStep(route) {
    var done = state.checks[route.id] || [];
    var s = route.steps.filter(function (st) { return done.indexOf(st.n) < 0; })[0];
    return s ? s.n : route.steps.length;
  }
  function commonPrefix(a, b) {
    var k = 0;
    while (k < a.steps.length && k < b.steps.length && a.steps[k].text === b.steps[k].text) k++;
    return k;
  }
  function branchInfo(cur, t) {
    var opp = t.steps.filter(function (s) { return s.opponent; })[0];
    return { target: t, opp: opp, from: opp ? opp.n + 1 : 1, prefix: commonPrefix(cur, t) };
  }

  function respond(key, route, stepN) {
    var btn = C.handTrapButtons.filter(function (b) { return b.key === key; })[0];
    var rows = D.handTrapResponses.rows.filter(function (r) { return btn.rows.some(function (k) { return r.action.indexOf(k) >= 0; }); });
    var out = { btn: btn, rows: rows, matches: [], hints: [], mismatch: [] };
    rows.forEach(function (row) {
      var rule = C.responseRules.filter(function (u) { return row.action.indexOf(u.action) >= 0 && row.timing.indexOf(u.timing) >= 0; })[0];
      if (!rule) return;
      if (rule.type === 'afterNthSummon') {
        if (rule.appliesOn.indexOf(route.id) < 0) return;
        var k = summonsUpTo(route, stepN);
        var zs = route.steps.filter(function (s) { return s.summonIndex === rule.n; })[0];
        if (k >= rule.n) out.matches.push({ row: row, rule: rule, mode: 'continue', k: k, zstep: zs });
        else out.hints.push({ row: row, step: zs ? zs.n : null, text: (zs ? zs.n + '단계(' + rule.n + '번째 소환: ' + zs.text + ')' : rule.n + '번째 소환') + ' 이후' });
        return;
      }
      if (rule.appliesOnSet && C.routeSets[rule.appliesOnSet].indexOf(route.id) < 0) return;
      var re = new RegExp(rule.pattern);
      var hits = route.steps.filter(function (s) { return !s.opponent && re.test(s.text); });
      if (rule.firstMatchOnly) hits = hits.slice(0, 1);
      if (!hits.length) return;
      var targets = row.ids.map(function (id) { return routesById[id]; }).filter(function (t) { return t && t.initiator.indexOf(route.initiator[0]) >= 0; });
      var hitHere = hits.some(function (h) { return h.n === stepN; });
      if (!targets.length) { if (hitHere) out.mismatch.push({ row: row }); return; }
      if (hitHere) out.matches.push({ row: row, rule: rule, mode: 'switch', targets: targets.map(function (t) { return branchInfo(route, t); }) });
      else out.hints.push({ row: row, step: hits[0].n, text: hits[0].n + '단계(' + hits[0].text + ') 직후' });
    });
    return out;
  }

  // ------------------------------------------------------------ 렌더: 패 선택
  function renderHand() {
    var hand = state.hand, size = handSize(hand);
    var groups = ['몬스터', '마법', '함정'];
    var h = '<div class="grid-2"><section class="panel"><h2>패 고르기</h2>' +
      '<p class="small muted">카드를 누르면 패에 들어간다. 최대 ' + HAND_MAX + '장, 카드별로 덱 장수까지. 오른쪽 위 숫자 = 패/덱 장수.</p>' +
      '<div class="hand-bar" aria-live="polite"><strong>패 ' + size + '/' + HAND_MAX + '</strong>';
    if (!size) h += '<span class="muted small">비어 있음</span>';
    Object.keys(hand).forEach(function (n) {
      for (var i = 0; i < hand[n]; i++) h += '<span class="chip accent">' + esc(short(n)) + '<button data-act="hand-del" data-name="' + esc(n) + '" aria-label="' + esc(short(n)) + ' 빼기">×</button></span>';
    });
    if (size) h += '<button class="btn small" data-act="hand-clear">비우기</button>';
    h += '</div>';
    groups.forEach(function (g) {
      h += '<div class="card-group"><h4>' + g + '</h4><div class="card-grid">';
      mainCards.filter(function (c) { return c.category === g; }).forEach(function (c) {
        var n = cnt(hand, c.name), dis = n >= c.count || size >= HAND_MAX;
        h += '<button class="card-btn' + (n ? ' in-hand' : '') + (c.isInitiator ? ' init' : '') + '" data-act="hand-add" data-name="' + esc(c.name) + '"' + (dis ? ' disabled' : '') +
          ' title="' + esc(c.name + (c.note ? ' · ' + c.note : '')) + '"><span class="cnt">' + n + '/' + c.count + '</span><span class="s">' + esc(c.short) + '</span><span class="f">' + esc(c.name) + '</span></button>';
      });
      h += '</div></div>';
    });
    h += '<details class="inner"><summary>EX 덱 (패에 넣지 않음)</summary><p class="small">' +
      D.cards.filter(function (c) { return c.zone === 'EX'; }).map(function (c) { return esc(c.name) + ' ×' + c.count + ' <span class="muted">(' + esc(c.note) + ')</span>'; }).join('<br>') + '</p></details>';
    h += '</section><section class="panel" id="recs">' + renderRecs() + '</section></div>';
    return h;
  }

  function concernSel() {
    return '<div class="seg" role="radiogroup" aria-label="상대 유발 예상">' + C.concernOptions.map(function (o) {
      return '<label><input type="radio" name="concern" value="' + o.key + '"' + (state.concern === o.key ? ' checked' : '') + ' data-act="concern"><span>' + esc(o.label) + '</span></label>';
    }).join('') + '</div>' + quote(D.quotes.step4);
  }

  function routeItemHtml(it) {
    var r = routesById[it.id];
    var h = '<div class="route-item' + (it.blocked.length ? ' blocked' : '') + '"><div class="head"><div class="title">' + routeTitle(r) + '</div>' +
      (it.blocked.length ? '<span class="tag bad">이 패로는 막힘</span>' : '<button class="btn primary small" data-act="start-route" data-id="' + r.id + '">이 루트로 진행</button>') + '</div><div>';
    it.tags.forEach(function (t) { h += '<span class="tag ' + t.cls + '">' + hl(t.t) + '</span>'; });
    h += '</div><div class="small muted">최종: ' + hl(r.finalText) + (r.source ? ' · <a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a>' : '') + '</div>';
    if (it.kind === 'variant' && variantBullet) h += '<div class="small">' + textBlock(variantBullet) + '</div>';
    it.blocked.forEach(function (b) {
      h += '<div class="box bad small"><strong>' + esc(b.cardText) + '이(가) 패에 있음</strong> — ' + textBlock(b.effect) + '<br>대응: ' + textBlock(b.response) + ' <span class="muted">(조회표 3단계)</span></div>';
    });
    it.cautions.forEach(function (c) { h += '<div class="box warn small">' + textBlock(c) + '</div>'; });
    return h + '</div>';
  }

  function renderRecs() {
    var hand = state.hand, size = handSize(hand);
    var h = '<h2>추천 루트</h2>';
    h += '<h4>상대 유발 예상</h4>' + concernSel();
    if (!size) return h + '<div class="empty">왼쪽에서 패를 고르면 문서의 조회표·1장/2장 조합 기준으로 루트를 보여준다.</div>';
    var res = evaluate(hand, state.concern);
    var ok = viable(res);
    if (res.plans.length) {
      res.plans.forEach(function (p) {
        var good = p.items.filter(function (i) { return !i.blocked.length; }), bad = p.items.filter(function (i) { return i.blocked.length; });
        h += '<div class="plan' + (p.kind === 'conversion' ? ' conv' : '') + '"><h3>' + hl(p.title) + '</h3>';
        if (p.detail) h += '<p class="small">' + textBlock(p.detail) + '</p>';
        if (p.start) h += '<p class="small"><span class="muted">시작 동작:</span> ' + textBlock(p.start) + '</p>';
        good.forEach(function (i) { h += routeItemHtml(i); });
        if (bad.length) h += '<details class="inner"><summary>막힌 루트 ' + bad.length + '개</summary>' + bad.map(routeItemHtml).join('') + '</details>';
        h += '</div>';
      });
    }
    if (!ok) {
      h += '<div class="box bad"><h4>이 패로 기록된 루트 없음</h4><p class="small">이니시(케플러·지옥문·제로 마키나)와 변환 수단(스몰 월드·다크 오컬티즘·카운트 조합) 중 이 패로 성립하는 루트가 문서에 없다.</p></div>';
      var more = oneMore(hand, state.concern);
      h += '<h3>카드 1장만 더 있으면 되는 루트</h3>';
      if (size >= HAND_MAX) h += '<p class="small muted">지금 패가 ' + size + '장이라 1장을 더하면 ' + (size + 1) + '장이 된다(계산은 그냥 1장 추가 기준).</p>';
      if (!more.length) h += '<p class="muted">1장 추가로 성립하는 기록도 없다.</p>';
      more.forEach(function (m) {
        h += '<div class="route-item"><div class="title">+ ' + esc(m.card.short) + ' <span class="muted small">' + esc(m.card.name) + ' · 덱에 ' + deckLeft(hand, m.card.name) + '장 남음</span></div>';
        m.via.forEach(function (v) {
          h += '<div class="small">' + hl(v.title) + (v.detail ? ' — ' + textBlock(v.detail) : '') + '<br>' + v.ids.map(function (id) { return '<button class="rid" data-act="open-route" data-id="' + id + '">' + id + '</button>'; }).join(' ') + '</div>';
        });
        h += '</div>';
      });
    }
    if (res.convInfo.length) {
      h += '<h4>변환 표에 있지만 이니시로 못 가는 경우</h4>';
      res.convInfo.forEach(function (ci) {
        h += '<div class="box warn small"><strong>' + hl(ci.cv.hand) + '</strong> — ' + textBlock(ci.cv.conversion) + ' → ' + hl(ci.cv.result) +
          (!ci.bridgeOk ? '<br>다리 카드 ' + esc(short(ci.cv.bridge)) + '가 덱에 남아 있지 않다(전부 패에 있음).' : '') + '</div>';
      });
    }
    if (res.combos.length) {
      h += '<h4>패에 해당하는 조합 기록</h4>';
      res.combos.forEach(function (c) { h += '<div class="box small"><strong>' + hl(c.title) + '</strong><br>' + textBlock(c.text) + (c.basis ? ' <span class="tag">근거: ' + hl(c.basis) + '</span>' : '') + '</div>'; });
    }
    if (res.parts.length) {
      h += '<h4>1장뿐인 부품이 패에 있음 (조회표 3단계)</h4>';
      res.parts.forEach(function (p) {
        h += '<div class="box warn small"><strong>' + esc(p.cardText) + '</strong> — ' + textBlock(p.effect) + '<br>대응: ' + textBlock(p.response) + '</div>';
      });
    }
    if (res.responses.length) {
      h += '<h4>맞았을 때 갈아탈 루트 (이 이니시 기준)</h4><ul class="small">';
      res.responses.forEach(function (x) {
        h += '<li><strong>' + hl(x.row.action) + '</strong> · ' + hl(x.row.timing) + ' → ' + x.ids.map(function (id) { return '<button class="rid" data-act="open-route" data-id="' + id + '">' + id + '</button>'; }).join(' ') + ' <span class="muted">(최종: ' + hl(x.row.final) + ')</span></li>';
      });
      h += '</ul>';
    }
    var notes = [];
    if (initiatorCount(hand) >= 2) notes.push(D.quotes.twoInitiators);
    if (cnt(hand, '도미나스 임펄스') > 0) notes.push(D.quotes.dominusSelf);
    if (size) notes.push(D.quotes.leftovers);
    if (notes.length) h += '<h4>문서 메모</h4>' + notes.map(quote).join('');
    return h;
  }

  // ------------------------------------------------------------ 렌더: 루트 진행
  function renderRoute() {
    var r = routesById[state.routeId];
    if (!r) return '<div class="panel empty">진행 중인 루트가 없다. <button class="btn" data-act="tab" data-tab="hand">패 선택</button> 또는 <button class="btn" data-act="tab" data-tab="all">전체 루트</button>에서 골라줘.</div>';
    var g = groupsById[r.group], done = state.checks[r.id] || [], cur = currentStep(r);
    var allDone = done.length >= r.steps.length;
    var pct = Math.round(done.length / r.steps.length * 100);
    var picked = state.trap && state.trap.routeId === r.id ? state.trap.step : null;
    var h = '<div class="grid-2 grid-route"><section class="panel"><h2>' + routeTitle(r) + '</h2>' +
      '<p class="small muted">' + esc(g.id + '. ' + g.title) + (g.headerFinal ? ' — 그룹 최종: ' + hl(g.headerFinal) : '') + '</p>';
    h += '<p class="small"><span class="muted">필요한 패:</span> ' + r.requiredHand.map(function (q) {
      var have = cnt(state.hand, q.card) > 0, entered = handSize(state.hand) > 0;
      return '<span class="chip ' + (!entered ? '' : have ? 'ok' : 'bad') + '" title="' + esc(q.reason) + '">' + esc(short(q.card)) + (entered ? (have ? ' ✓' : ' 패에 없음') : '') + '</span>';
    }).join(' ') + '</p>';
    h += '<p class="small"><span class="muted">최종:</span> ' + hl(r.finalText) + (r.source ? ' · 출처 <a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a>' : '') + '</p>';
    h += '<div class="progress" aria-hidden="true"><div style="width:' + pct + '%"></div></div><p class="small">' + done.length + ' / ' + r.steps.length + ' 단계 완료' + (allDone ? ' — 끝!' : ' · 현재 ' + cur + '단계') + '</p>';
    h += '<div class="btn-row"><button class="btn primary" data-act="next-step"' + (allDone ? ' disabled' : '') + '>현재 단계 완료</button><button class="btn" data-act="undo-step"' + (done.length ? '' : ' disabled') + '>한 단계 되돌리기</button><button class="btn" data-act="reset-steps">처음부터</button></div>';
    h += '<ol class="steps">';
    r.steps.forEach(function (s) {
      var isDone = done.indexOf(s.n) >= 0;
      var cls = (isDone ? 'done ' : '') + (!allDone && s.n === cur ? 'current ' : '') + (s.opponent ? 'opp ' : '') + (picked === s.n ? 'picked' : '');
      h += '<li class="' + cls + '" id="step-' + s.n + '"><input type="checkbox" id="cb-' + s.n + '" data-act="toggle-step" data-n="' + s.n + '"' + (isDone ? ' checked' : '') + ' aria-label="' + s.n + '단계 완료">' +
        '<span class="num">' + s.n + '</span><label class="txt" for="cb-' + s.n + '">' + hl(s.text) + '<span class="meta">' +
        (s.opponent ? '<span class="tag bad">상대 행동</span>' : '') +
        (s.isSummon ? '<span class="tag">소환 ' + s.summonIndex + '번째</span>' : '') +
        (picked === s.n ? '<span class="tag bad">여기서 맞음</span>' : '') + '</span></label></li>';
    });
    h += '</ol><p class="small muted">"소환 n번째"는 앱이 단계 문장(일반소환·특소·링크·엑시즈·융합·싱크로·소생·P소환)으로 센 참고값이다. 한 단계에 여러 장 P소환해도 1번으로 센다.</p></section>';

    h += '<div class="side"><section class="panel" id="trapPanel">' + renderTrapPanel(r) + '</section>';
    h += '<section class="panel">' + renderFinal(r) + '</section>';
    h += '<section class="panel">' + renderReverse(r) + '</section>';
    h += '<section class="panel">' + renderNotes(r) + '</section></div></div>';
    return h;
  }

  function renderTrapPanel(r) {
    var h = '<h2>패트랩 맞음</h2><p class="small muted">맞은 방해를 누르고, 몇 번째 단계에서 맞았는지 고른다.</p><div class="trap-grid">';
    C.handTrapButtons.forEach(function (b) {
      var on = state.trap && state.trap.key === b.key && state.trap.routeId === r.id;
      h += '<button class="trap-btn" data-act="trap" data-key="' + b.key + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(b.label) + '</button>';
    });
    h += '</div>';
    if (!state.trap || state.trap.routeId !== r.id) return h;
    var t = state.trap;
    h += '<h4>몇 번째 단계에서 맞았나</h4><select class="full" data-act="trap-step" aria-label="맞은 단계">';
    r.steps.forEach(function (s) {
      h += '<option value="' + s.n + '"' + (s.n === t.step ? ' selected' : '') + '>' + s.n + '. ' + esc(s.text) + (s.isSummon ? ' [소환 ' + s.summonIndex + ']' : '') + '</option>';
    });
    h += '</select>';
    var out = respond(t.key, r, t.step);
    var step = r.steps.filter(function (s) { return s.n === t.step; })[0];
    h += '<p class="small">' + esc(out.btn.label) + ' → ' + t.step + '단계 "' + hl(step.text) + '"' + ' · 여기까지 소환 ' + summonsUpTo(r, t.step) + '번</p>';
    if (out.matches.length) {
      out.matches.forEach(function (m) {
        h += '<div class="box ok"><h4>문서 대응 있음</h4><p class="small"><strong>' + hl(m.row.action) + '</strong> · 맞는 지점: ' + hl(m.row.timing) + '</p>' +
          '<p>' + textBlock(m.row.response) + '</p><p class="small muted">문서 최종: ' + hl(m.row.final) + '</p>';
        if (m.mode === 'continue') {
          var ff = ffByCard[m.rule.fieldCard];
          h += '<p><strong>' + esc(m.rule.continueText) + '</strong></p>';
          if (m.zstep) h += '<p class="small">이 루트에서 제우스가 나오는 곳: ' + m.zstep.n + '단계 "' + hl(m.zstep.text) + '" (소환 ' + m.zstep.summonIndex + '번째)</p>';
          if (ff) h += '<dl class="kv"><dt>막는 것</dt><dd>' + hl(ff.blocks) + '</dd><dt>비용·제약</dt><dd>' + hl(ff.cost) + '</dd></dl><p class="small muted">최종 필드 표 · ' + esc(ff.label) + '</p>';
          var ex = routesById[m.rule.exampleRoute];
          if (ex) {
            var exs = ex.steps.filter(function (s) { return s.text.indexOf(m.rule.examplePattern) >= 0; });
            if (exs.length) h += '<p class="small">문서 예시(' + ex.id + '):</p><ul class="small">' + exs.map(function (s) { return '<li>' + ex.id + ' ' + s.n + '. ' + hl(s.text) + '</li>'; }).join('') + '</ul>';
          }
        } else {
          m.targets.forEach(function (b) {
            var tr = b.target;
            h += '<div class="route-item"><div class="title">' + routeTitle(tr) + '</div>';
            if (tr.id === r.id) h += '<p class="small">지금 루트가 바로 이 상황의 대응 루트다' + (b.opp ? ' (' + b.opp.n + '단계: ' + hl(b.opp.text) + ')' : '') + '.</p>';
            else {
              h += '<p class="small">' + (b.opp ? tr.id + ' ' + b.opp.n + '단계가 "' + hl(b.opp.text) + '" → <strong>' + b.from + '단계부터</strong> 이어감.' : '') +
                ' 현재 루트와 앞 ' + b.prefix + '단계 문장이 같다.</p><p class="small muted">최종: ' + hl(tr.finalText) + '</p>' +
                '<button class="btn primary small" data-act="switch-route" data-id="' + tr.id + '" data-upto="' + (b.opp ? b.opp.n : 0) + '">' + tr.id + '로 전환 (1~' + (b.opp ? b.opp.n : 0) + '단계 완료 처리)</button>';
            }
            h += '</div>';
          });
        }
        (m.rule.needsHand || []).forEach(function (nh) {
          var c = cnt(state.hand, nh.card), entered = handSize(state.hand) > 0;
          h += '<div class="box ' + (!entered ? '' : c ? 'ok' : 'bad') + ' small">조건: 패에 ' + esc(short(nh.card)) + ' — ' + textBlock(nh.why) + '<br>현재 선택한 패: ' + (entered ? c + '장' : '패 미입력') + '</div>';
        });
        h += '</div>';
      });
    } else {
      h += '<div class="box warn"><h4>문서에 대응 기록 없음</h4><p class="small">' + esc(out.btn.label) + '을(를) ' + t.step + '단계에서 맞은 경우의 대응은 dd-guide.md·dd-routes.md에 없다.</p>';
      out.mismatch.forEach(function (mm) {
        h += '<p class="small">이 시점(' + hl(mm.row.timing) + ')의 대응 루트 ' + linkIds(esc(mm.row.ids.join('·'))) + '는 시작 이니시가 ' +
          esc(mm.row.ids.map(function (id) { return short(routesById[id].initiator[0]); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join('·')) +
          '라서, ' + esc(short(r.initiator[0])) + '로 시작한 이 루트에 그대로 쓸 수 있는지는 문서에 없다.</p>';
      });
      if (out.hints.length) {
        h += '<p class="small"><strong>이 루트에서 문서 기록이 있는 시점:</strong></p><ul class="small">' + out.hints.map(function (x) {
          return '<li>' + (x.step ? '<button class="btn small" data-act="trap-step-set" data-n="' + x.step + '">' + x.step + '단계로</button> ' : '') + hl(x.row.timing) + ' — ' + hl(x.text) + '</li>';
        }).join('') + '</ul>';
      }
      h += '</div>';
      var qs = out.btn.quotes.map(function (k) { return D.quotes[k]; }).filter(Boolean);
      if (qs.length) h += '<h4>일반 원칙 (문서)</h4>' + qs.map(quote).join('');
      var others = C.initiatorCards.filter(function (c) { return cnt(state.hand, c) > 0; });
      if (handSize(state.hand)) {
        var n = initiatorCount(state.hand);
        h += '<p class="small">현재 선택한 패의 이니시: ' + (n ? others.map(function (c) { return esc(short(c)) + ' ' + cnt(state.hand, c) + '장'; }).join(', ') + ' (총 ' + n + '장' + (n >= 2 ? ', 이번 루트에 쓴 1장 외 예비가 있다' : ', 예비 이니시 없음') + ')' : '없음') + '</p>';
      }
    }
    if (out.rows.length) {
      h += '<details class="inner"><summary>같은 상대 행동의 문서 기록 전체 (' + out.rows.length + ')</summary>' +
        table(['상대 행동', '맞는 지점', '대응 루트', '최종'], out.rows.map(function (x) { return [x.action, x.timing, x.response, x.final]; })) + '</details>';
    }
    return h;
  }

  function finalCardsOf(r) {
    var list = r.finalCards.map(function (c) { return { card: c, zone: '필드' }; });
    r.finalExtra.forEach(function (x) { list.push({ card: x.card, zone: x.zone, from: x.from }); });
    return list;
  }

  function renderFinal(r) {
    var h = '<h2>최종 필드</h2><p class="small">' + hl(r.finalText) + '</p>';
    finalCardsOf(r).forEach(function (fc) {
      var ff = ffByCard[fc.card], ef = effectsByCard[fc.card];
      h += '<div class="ff-card"><div class="name">' + esc(fc.card) + ' <span class="tag">' + esc(fc.zone) + '</span></div>';
      if (ff) h += '<dl class="kv"><dt>막는 것</dt><dd>' + hl(ff.blocks) + '</dd><dt>비용·제약</dt><dd>' + hl(ff.cost) + '</dd></dl>';
      else h += '<p class="small"><span class="tag warn">최종 필드 표에 항목 없음</span></p>';
      if (ef) h += '<p class="small muted">카드 효과 요약: ' + hl(ef.effect) + '</p>';
      if (fc.from) h += '<p class="small muted">근거: ' + hl(fc.from) + '</p>';
      h += '</div>';
    });
    h += '<details class="inner"><summary>최종 필드 문서 메모</summary>' + '<p class="small">' + textBlock(D.finalField.intro) + '</p>' +
      D.finalField.notes.map(function (n) { return '<p class="small">' + textBlock(n) + '</p>'; }).join('') + '</details>';
    return h;
  }

  function renderReverse(r) {
    var present = {};
    finalCardsOf(r).forEach(function (fc) { present[fc.card] = fc.zone; });
    var item = C.reverseLookup.filter(function (x) { return x.key === state.rev; })[0] || C.reverseLookup[0];
    var h = '<h2>상대 행동 → 무엇으로 막나</h2><p class="small muted">이 루트 최종 필드 기준. 문서의 최종 필드 표·카드 효과 요약 문장만 근거로 쓴다.</p>' +
      '<select class="full" data-act="rev" aria-label="상대 행동">' + C.reverseLookup.map(function (x) { return '<option value="' + x.key + '"' + (x.key === item.key ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select>';
    var any = false;
    item.cards.forEach(function (c) {
      var here = present[c.card] && (!c.zone || present[c.card] === c.zone);
      if (here) any = true;
      var ff = ffByCard[c.card], ef = effectsByCard[c.card];
      h += '<div class="ff-card' + (here ? '' : ' absent') + '"><div class="name">' + esc(c.card) + ' ' + (here ? '<span class="tag ok">이 필드에 있음</span>' : '<span class="tag">이 루트 최종 필드에 없음</span>') +
        ' <span class="tag ' + (c.basis === '명시' ? 'accent' : 'warn') + '">' + hl(c.basis) + '</span></div><p class="small">' + hl(c.why) + '</p>';
      if (ff) h += '<blockquote class="q">막는 것: ' + hl(ff.blocks) + '<br>비용·제약: ' + hl(ff.cost) + '<span class="src">dd-guide.md · 최종 필드와 방해 수 · ' + esc(ff.label) + '</span></blockquote>';
      if (ef) h += '<blockquote class="q">' + hl(ef.effect) + '<span class="src">dd-guide.md · 핵심 카드 효과 요약 · ' + esc(ef.raw) + '</span></blockquote>';
      h += '</div>';
    });
    if (!any) h += '<div class="box warn small">이 루트 최종 필드에는 이 행동을 막는다고 문서에 적힌 카드가 없다.</div>';
    if (item.note) h += '<p class="small muted">' + hl(item.note) + '</p>';
    h += '<p class="small muted">"명시" = 문서 문장이 그 행동을 직접 말함. "포괄(해석)" = 문장이 넓게 적혀 있어 포함된다고 앱이 읽은 것.</p>';
    return h;
  }

  function renderNotes(r) {
    var h = '<h2>출처·주석</h2>';
    if (r.source) h += '<p>원문: <a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a> <span class="small muted">' + esc(r.source.url) + '</span></p>';
    if (!r.notes.length) h += '<p class="muted">주석 없음</p>';
    h += '<ul class="small">' + r.notes.map(function (n) { return '<li><span class="tag">' + hl(n.kind) + '</span> ' + textBlock(n.text) + '</li>'; }).join('') + '</ul>';
    return h;
  }

  // ------------------------------------------------------------ 렌더: 전체 루트
  function renderAll() {
    var h = '<section class="panel"><h2>전체 루트 ' + D.routes.length + '개</h2><div class="mdoc small">' + md(D.routesIntroMarkdown) + '</div></section>';
    D.groups.forEach(function (g) {
      h += '<section class="panel"><h3>' + esc(g.id + '. ' + g.title) + '</h3>' + (g.headerFinal ? '<p class="small muted">그룹 최종: ' + hl(g.headerFinal) + '</p>' : '');
      g.routeIds.forEach(function (id) {
        var r = routesById[id], done = (state.checks[id] || []).length;
        h += '<div class="route-item"><div class="head"><div class="title">' + routeTitle(r) + '</div><button class="btn small" data-act="start-route" data-id="' + id + '">진행</button></div>' +
          '<div class="small muted">이니시: ' + esc(r.initiator.map(short).join(' + ')) + ' · ' + r.steps.length + '단계' + (done ? ' · 체크 ' + done + '개' : '') + ' · 최종: ' + hl(r.finalText) +
          (r.source ? ' · <a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a>' : '') + '</div></div>';
      });
      h += '</section>';
    });
    return h;
  }

  // ------------------------------------------------------------ 렌더: 문서·검사
  function renderDoc() {
    var v = D.validation, fails = v.checks.filter(function (c) { return !c.ok; });
    var h = '<section class="panel"><h2>데이터 검사 결과</h2><p>' + (fails.length ? '<span class="tag bad">실패 ' + fails.length + '개</span>' : '<span class="tag ok">검사 ' + v.checks.length + '개 모두 통과</span>') +
      ' <span class="small muted">생성: ' + esc(D.meta.generatedAt) + '</span></p>' +
      '<details class="inner"' + (fails.length ? ' open' : '') + '><summary>검사 항목</summary><ul class="check-list">' +
      v.checks.map(function (c) { return '<li>' + (c.ok ? '✅' : '❌') + ' ' + hl(c.name) + (c.detail ? ' <span class="muted">— ' + hl(c.detail) + '</span>' : '') + '</li>'; }).join('') + '</ul></details>' +
      '<h3>문서끼리 어긋나거나 애매한 곳 (자동 검출)</h3><ul class="small">' + v.warnings.map(function (w) { return '<li>' + textBlock(w) + '</li>'; }).join('') + '</ul></section>';
    h += '<section class="panel mdoc"><h2>' + esc(D.meta.guideTitle) + ' <span class="small muted">' + esc(D.meta.guideDate) + '</span></h2>';
    D.guideSections.forEach(function (s) {
      h += '<details class="inner"><summary>' + esc(s.title) + '</summary>' + md(s.markdown) + '</details>';
    });
    h += '</section>';
    return h;
  }

  // ------------------------------------------------------------ 메인 렌더 · 이벤트
  function render() {
    document.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === state.tab ? 'true' : 'false'); });
    var fn = { hand: renderHand, route: renderRoute, all: renderAll, doc: renderDoc }[state.tab] || renderHand;
    app.innerHTML = fn();
    var themeLabel = { auto: '자동', light: '밝게', dark: '어둡게' }[state.theme] || '자동';
    document.getElementById('themeBtn').textContent = '테마: ' + themeLabel;
    saveState();
  }
  function applyTheme() {
    if (state.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', state.theme);
  }
  function setChecksUpTo(id, n) {
    state.checks[id] = routesById[id].steps.filter(function (s) { return s.n <= n; }).map(function (s) { return s.n; });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act], [data-tab]');
    if (!el) return;
    var act = el.dataset.act || (el.classList.contains('tab') ? 'tab' : null);
    var r = routesById[state.routeId];
    switch (act) {
      case 'tab': state.tab = el.dataset.tab; render(); window.scrollTo(0, 0); return;
      case 'hand-add': {
        var n = el.dataset.name, c = cardsByName[n];
        if (handSize(state.hand) < HAND_MAX && cnt(state.hand, n) < c.count) state.hand[n] = cnt(state.hand, n) + 1;
        render(); return;
      }
      case 'hand-del': {
        var dn = el.dataset.name;
        if (state.hand[dn] > 1) state.hand[dn]--; else delete state.hand[dn];
        render(); return;
      }
      case 'hand-clear': state.hand = {}; render(); return;
      case 'start-route': case 'open-route':
        state.routeId = el.dataset.id; state.tab = 'route'; state.trap = null; render(); window.scrollTo(0, 0); return;
      case 'next-step':
        if (r) { var cs = currentStep(r); var d = state.checks[r.id] || []; if (d.indexOf(cs) < 0) d.push(cs); state.checks[r.id] = d; render(); scrollToStep(currentStep(r)); }
        return;
      case 'undo-step':
        if (r) { var dd = (state.checks[r.id] || []).slice().sort(function (a, b) { return a - b; }); dd.pop(); state.checks[r.id] = dd; render(); }
        return;
      case 'reset-steps':
        if (r) { state.checks[r.id] = []; state.trap = null; render(); }
        return;
      case 'trap':
        if (r) {
          var k = el.dataset.key;
          if (state.trap && state.trap.key === k && state.trap.routeId === r.id) state.trap = null;
          else state.trap = { key: k, routeId: r.id, step: state.trap && state.trap.routeId === r.id ? state.trap.step : currentStep(r) };
          render(); var tp = document.getElementById('trapPanel'); if (tp && tp.scrollIntoView) tp.scrollIntoView({ block: 'start' });
        }
        return;
      case 'trap-step-set':
        if (state.trap) { state.trap.step = Number(el.dataset.n); render(); var tp2 = document.getElementById('trapPanel'); if (tp2 && tp2.scrollIntoView) tp2.scrollIntoView({ block: 'start' }); }
        return;
      case 'switch-route': {
        var id = el.dataset.id, upto = Number(el.dataset.upto);
        setChecksUpTo(id, upto); state.routeId = id; state.trap = null; render(); window.scrollTo(0, 0); scrollToStep(upto + 1); return;
      }
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target, act = el.dataset.act, r = routesById[state.routeId];
    if (act === 'toggle-step' && r) {
      var n = Number(el.dataset.n), d = state.checks[r.id] || [];
      if (el.checked) { if (d.indexOf(n) < 0) d.push(n); } else d = d.filter(function (x) { return x !== n; });
      state.checks[r.id] = d; render(); return;
    }
    if (act === 'concern') { state.concern = el.value; render(); return; }
    if (act === 'trap-step' && state.trap) { state.trap.step = Number(el.value); render(); var tp = document.getElementById('trapPanel'); if (tp && tp.scrollIntoView) tp.scrollIntoView({ block: 'start' }); return; }
    if (act === 'rev') { state.rev = el.value; render(); }
  });
  function scrollToStep(n) {
    var li = document.getElementById('step-' + n);
    if (li && li.scrollIntoView) li.scrollIntoView({ block: 'center' });
  }
  document.getElementById('themeBtn').addEventListener('click', function () {
    state.theme = { auto: 'light', light: 'dark', dark: 'auto' }[state.theme] || 'auto';
    applyTheme(); render();
  });

  document.getElementById('foot').innerHTML = '데이터: ' + D.meta.sources.map(esc).join(', ') + ' · 생성 ' + esc(D.meta.generatedAt) +
    ' · 노란 표시(<mark class="m">추정</mark> 등)는 문서 원문의 표시를 그대로 강조한 것';
  applyTheme();
  render();
})();
