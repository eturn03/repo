/* DD4 전개 도우미 — 바닐라 JS.
   데이터: data/dd-data.js(window.DD_DATA), data/handtraps/meta.js(window.DD_HT_META),
   루트별 패트랩 data/handtraps/<루트>.js(window.DD_HT[루트], 필요할 때 불러옴) */
(function () {
  'use strict';

  var D = window.DD_DATA;
  var HTM = window.DD_HT_META || null;
  var app = document.getElementById('app');
  if (!D) {
    app.innerHTML = '<div class="panel"><h2>데이터를 못 불러왔다</h2><p>data/dd-data.js 파일이 없거나 깨졌다. ' +
      'README.md의 "데이터 다시 만들기" 명령을 실행한 뒤 새로고침해줘.</p></div>';
    return;
  }
  var C = D.config;
  var HAND_MAX = 6;

  // ------------------------------------------------------------ 색인
  var cardsByName = {}, routesById = {}, effectsByCard = {}, ffByCard = {}, groupsById = {}, aliasToCard = {};
  D.cards.forEach(function (c) { cardsByName[c.name] = c; });
  D.routes.forEach(function (r) { routesById[r.id] = r; });
  D.cardEffects.forEach(function (e) { effectsByCard[e.card] = e; });
  D.finalField.rows.forEach(function (f) { ffByCard[f.card] = f; });
  D.groups.forEach(function (g) { groupsById[g.id] = g; });
  Object.keys(C.cardAliases).forEach(function (full) {
    aliasToCard[full] = full;
    C.cardAliases[full].forEach(function (a) { aliasToCard[a] = full; });
  });
  var mainCards = D.cards.filter(function (c) { return c.zone === '메인'; });

  function short(name) { return (cardsByName[name] && cardsByName[name].short) || name; }
  function resolve(name) { return aliasToCard[name] || null; }

  // ------------------------------------------------------------ 저장(localStorage, 실패해도 동작)
  var KEY = 'dd4-helper-v1';
  function loadState() {
    try { return JSON.parse(window.localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
  }
  var state = Object.assign({ tab: 'hand', hand: {}, concern: 'none', routeId: null, checks: {}, ht: null, htChecks: {}, rev: 'handMonster', theme: 'dark' }, loadState());
  if (state.theme !== 'light') state.theme = 'dark';
  delete state.trap;
  Object.keys(state.hand).forEach(function (n) {
    var c = cardsByName[n];
    if (!c || c.zone !== '메인' || !(state.hand[n] > 0)) delete state.hand[n];
    else state.hand[n] = Math.min(state.hand[n], c.count);
  });
  if (state.routeId && !routesById[state.routeId]) state.routeId = null;
  if (['hand', 'route', 'all', 'ht', 'doc'].indexOf(state.tab) < 0) state.tab = 'hand';

  // ------------------------------------------------------------ 문자열 도우미
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  var MARK_RE = /(원문 생략|미검증|미확인|추정|해석|보완|생략)/g;
  function hl(s) { return esc(s).replace(MARK_RE, '<mark class="m">$1</mark>'); }
  function ridLink(id) { return '<a href="#" class="rid" data-act="open-route" data-id="' + id + '">' + id + '</a>'; }
  function ridBtn(id) { return '<button class="rid" data-act="open-route" data-id="' + id + '">' + id + '</button>'; }
  // 문장 속 루트 ID를 누르면 그 루트를 여는 링크로 바꾼다
  function linkIds(htmlText) {
    return htmlText.replace(/(^|[^A-Za-z0-9#])([A-G]\d{1,2})(?![0-9A-Za-z])/g, function (m, pre, id) {
      return routesById[id] ? pre + ridLink(id) : m;
    });
  }
  function inline(s) {
    var h = hl(s);
    h = h.replace(/&lt;br&gt;/g, '<br>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return h;
  }
  function textBlock(s) { return linkIds(inline(s)); }

  // 아주 작은 마크다운 렌더러(문서 화면용): 제목, 표, 목록, 문단
  function md(src) {
    var lines = String(src || '').split('\n'), out = '', i = 0;
    function isBlockStart(l) { return /^#{1,4}\s/.test(l) || /^- /.test(l) || /^\d+\.\s/.test(l) || /^\s*\|/.test(l) || /^```/.test(l); }
    while (i < lines.length) {
      var l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (/^```/.test(l)) {
        var code = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; out += '<pre class="small" style="overflow-x:auto">' + esc(code.join('\n')) + '</pre>'; continue;
      }
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
  function routeTitle(r) { return ridLink(r.id) + ' ' + hl(r.name); }

  // ------------------------------------------------------------ 패 계산
  function handSize(hand) { return Object.keys(hand).reduce(function (a, k) { return a + hand[k]; }, 0); }
  function cnt(hand, name) { return hand[name] || 0; }
  function deckLeft(hand, name) { return (cardsByName[name] ? cardsByName[name].count : 0) - cnt(hand, name); }
  function initiatorCount(hand) { return C.initiatorCards.reduce(function (a, c) { return a + cnt(hand, c); }, 0); }

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
    D.lookup.step1.rows.forEach(function (r) {
      if (r.cards.length > 1 && r.cards.every(function (c) { return cnt(hand, c) > 0; })) {
        res.combos.push({ title: '조회표 1단계: ' + r.hand, text: r.routes, basis: '' });
      }
    });
    D.combos.rows.forEach(function (c) {
      if (satisfies(c.requires, hand)) res.combos.push({ title: '2장 조합 표: ' + c.combo, text: c.action, basis: c.basis });
    });
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
    (D.lookup.step3.rows || []).forEach(function (row) { if (row.card && cnt(hand, row.card) > 0) res.parts.push(row); });
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

  // ------------------------------------------------------------ 패트랩 데이터(루트별 파일)
  var htStatus = {};
  function htData(id) { return window.DD_HT && window.DD_HT[id] ? window.DD_HT[id] : null; }
  function loadHT(id) {
    if (htData(id) || htStatus[id]) return;
    htStatus[id] = 'loading';
    var s = document.createElement('script');
    s.src = 'data/handtraps/' + id + '.js';
    s.onload = function () { htStatus[id] = htData(id) ? 'ok' : 'error'; if (state.routeId === id && state.tab === 'route') render(); };
    s.onerror = function () { htStatus[id] = 'error'; if (state.routeId === id && state.tab === 'route') render(); };
    document.head.appendChild(s);
  }
  function htAt(id, step) { return (htData(id) || []).filter(function (x) { return x.step === step; }); }
  function stepTrapKeys(id, step) { return (HTM && HTM.stepTraps[id] && HTM.stepTraps[id][step]) || []; }
  function trapName(key) { return (HTM && HTM.traps[key]) || key; }

  function currentStep(route) {
    var done = state.checks[route.id] || [];
    var s = route.steps.filter(function (st) { return done.indexOf(st.n) < 0; })[0];
    return s ? s.n : route.steps.length;
  }

  // ------------------------------------------------------------ 렌더: 패 선택
  function renderHand() {
    var hand = state.hand, size = handSize(hand);
    var h = '<div class="grid-2"><section class="panel"><h2>패 고르기</h2>' +
      '<p class="small muted">카드를 누르면 패에 들어간다. 최대 ' + HAND_MAX + '장, 카드별로 덱 장수까지. 오른쪽 위 숫자 = 패/덱 장수.</p>' +
      '<div class="hand-bar" aria-live="polite"><strong>패 ' + size + '/' + HAND_MAX + '</strong>';
    if (!size) h += '<span class="muted small">비어 있음</span>';
    Object.keys(hand).forEach(function (n) {
      for (var i = 0; i < hand[n]; i++) h += '<span class="chip on">' + esc(short(n)) + '<button data-act="hand-del" data-name="' + esc(n) + '" aria-label="' + esc(short(n)) + ' 빼기">×</button></span>';
    });
    if (size) h += '<button data-act="hand-clear">비우기</button>';
    h += '</div>';
    ['몬스터', '마법', '함정'].forEach(function (g) {
      h += '<div class="card-group kind-' + g + '"><h4>' + g + '</h4><div class="card-grid">';
      mainCards.filter(function (c) { return c.category === g; }).forEach(function (c) {
        var n = cnt(hand, c.name), dis = n >= c.count || size >= HAND_MAX;
        h += '<button class="card-btn kind-' + g + (n ? ' is-on' : '') + '" data-act="hand-add" data-name="' + esc(c.name) + '"' + (dis ? ' disabled' : '') +
          ' title="' + esc(c.name + (c.note ? ' · ' + c.note : '')) + '"><span class="cnt">' + n + '/' + c.count + '</span><span class="s">' + esc(c.short) +
          (c.isInitiator ? '<span class="ini">이니시</span>' : '') + '</span><span class="f">' + esc(c.name) + '</span></button>';
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
    var h = '<div class="route-item"><div class="head"><div class="title">' + routeTitle(r) + '</div>' +
      (it.blocked.length ? '<span class="tag bad">이 패로는 막힘</span>' : '<button class="btn primary" data-act="start-route" data-id="' + r.id + '">이 루트로 진행</button>') + '</div><div>';
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
    var h = '<h2>추천 루트</h2><h4>상대 유발 예상</h4>' + concernSel();
    if (!size) return h + '<div class="empty">왼쪽에서 패를 고르면 문서의 조회표·1장/2장 조합 기준으로 루트를 보여준다.</div>';
    var res = evaluate(hand, state.concern);
    var ok = viable(res);
    res.plans.forEach(function (p) {
      var good = p.items.filter(function (i) { return !i.blocked.length; }), bad = p.items.filter(function (i) { return i.blocked.length; });
      h += '<div class="plan"><h3>' + hl(p.title) + '</h3>';
      if (p.detail) h += '<p class="small">' + textBlock(p.detail) + '</p>';
      if (p.start) h += '<p class="small"><span class="muted">시작 동작:</span> ' + textBlock(p.start) + '</p>';
      good.forEach(function (i) { h += routeItemHtml(i); });
      if (bad.length) h += '<details class="inner"><summary>막힌 루트 ' + bad.length + '개</summary>' + bad.map(routeItemHtml).join('') + '</details>';
      h += '</div>';
    });
    if (!ok) {
      h += '<div class="box bad"><h4>이 패로 기록된 루트 없음</h4><p class="small">이니시(케플러·지옥문·제로 마키나)와 변환 수단(스몰 월드·다크 오컬티즘·카운트 조합) 중 이 패로 성립하는 루트가 문서에 없다.</p></div>';
      var more = oneMore(hand, state.concern);
      h += '<h3>카드 1장만 더 있으면 되는 루트</h3>';
      if (size >= HAND_MAX) h += '<p class="small muted">지금 패가 ' + size + '장이라 1장을 더하면 ' + (size + 1) + '장이 된다(계산은 그냥 1장 추가 기준).</p>';
      if (!more.length) h += '<p class="muted">1장 추가로 성립하는 기록도 없다.</p>';
      more.forEach(function (m) {
        h += '<div class="route-item"><div class="title">+ ' + esc(m.card.short) + ' <span class="muted small">' + esc(m.card.name) + ' · 덱에 ' + deckLeft(hand, m.card.name) + '장 남음</span></div>';
        m.via.forEach(function (v) {
          h += '<div class="small">' + hl(v.title) + (v.detail ? ' — ' + textBlock(v.detail) : '') + '</div><div class="row8">' + v.ids.map(ridBtn).join('') + '</div>';
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
      h += '<h4>맞았을 때 갈아탈 루트 (가이드 대응 표, 이 이니시 기준)</h4><ul class="small">';
      res.responses.forEach(function (x) {
        h += '<li><strong>' + hl(x.row.action) + '</strong> · ' + hl(x.row.timing) + ' → ' + x.ids.map(ridLink).join(' ') + ' <span class="muted">(최종: ' + hl(x.row.final) + ')</span></li>';
      });
      h += '</ul>';
    }
    var notes = [];
    if (initiatorCount(hand) >= 2) notes.push(D.quotes.twoInitiators);
    if (cnt(hand, '도미나스 임펄스') > 0) notes.push(D.quotes.dominusSelf);
    notes.push(D.quotes.leftovers);
    h += '<h4>문서 메모</h4>' + notes.map(quote).join('');
    return h;
  }

  // ------------------------------------------------------------ 렌더: 루트 진행
  function renderRoute() {
    var r = routesById[state.routeId];
    if (!r) return '<div class="panel empty">진행 중인 루트가 없다.<div class="row8" style="justify-content:center"><button data-act="tab" data-tab="hand">패 선택으로</button><button data-act="tab" data-tab="all">전체 루트로</button></div></div>';
    loadHT(r.id);
    var g = groupsById[r.group], done = state.checks[r.id] || [], cur = currentStep(r);
    var allDone = done.length >= r.steps.length;
    var pct = Math.round(done.length / r.steps.length * 100);
    var ht = state.ht && state.ht.routeId === r.id ? state.ht : null;
    var picked = ht ? (ht.trap === 'nibiru' ? cur : ht.step) : null;
    var h = '<div class="grid-2 grid-route"><section class="panel"><h2>' + routeTitle(r) + '</h2>' +
      '<p class="small muted">' + esc(g.id + '. ' + g.title) + (g.headerFinal ? ' — 그룹 최종: ' + hl(g.headerFinal) : '') + '</p>';
    h += '<p class="small"><span class="muted">필요한 패:</span> ' + r.requiredHand.map(function (q) {
      var have = cnt(state.hand, q.card) > 0, entered = handSize(state.hand) > 0;
      return '<span class="chip ' + (!entered ? '' : have ? 'ok' : 'bad') + '" title="' + esc(q.reason) + '">' + esc(short(q.card)) + (entered ? (have ? ' ✓ 패에 있음' : ' ✗ 패에 없음') : '') + '</span>';
    }).join(' ') + '</p>';
    h += '<p class="small"><span class="muted">최종:</span> ' + hl(r.finalText) + (r.source ? ' · 출처 <a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a>' : '') + '</p>';
    // 니비루: 단계마다 띄우지 않고 상단 버튼 하나(현재 단계 기준)
    var nibOn = ht && ht.trap === 'nibiru';
    h += '<div class="nibiru-bar"><button class="trap-btn" data-act="ht-nibiru" aria-pressed="' + (nibOn ? 'true' : 'false') + '">니비루 맞음 (' + cur + '단계 기준)</button>' +
      '<span class="small muted">원시생명태 니비루는 소환 5체째 이후 아무 때나 오니, 진행 위치(' + cur + '단계) 기준 데이터를 보여준다.</span></div>';
    h += '<div class="progress" aria-hidden="true"><div style="width:' + pct + '%"></div></div><p class="small">' + done.length + ' / ' + r.steps.length + ' 단계 완료' + (allDone ? ' — 끝' : ' · 현재 ' + cur + '단계') + '</p>';
    h += '<div class="btn-row"><button class="btn primary" data-act="next-step"' + (allDone ? ' disabled' : '') + '>현재 단계 완료</button><button data-act="undo-step"' + (done.length ? '' : ' disabled') + '>한 단계 되돌리기</button><button data-act="reset-steps">처음부터</button></div>';
    h += '<ol class="steps">';
    r.steps.forEach(function (s) {
      var isDone = done.indexOf(s.n) >= 0;
      var keys = stepTrapKeys(r.id, s.n).filter(function (k) { return k !== 'nibiru'; });
      var cls = (isDone ? 'done ' : '') + (!allDone && s.n === cur ? 'current ' : '') + (s.opponent ? 'opp ' : '') + (picked === s.n ? 'picked' : '');
      h += '<li class="' + cls + '" id="step-' + s.n + '"><input type="checkbox" id="cb-' + s.n + '" data-act="toggle-step" data-n="' + s.n + '"' + (isDone ? ' checked' : '') + ' aria-label="' + s.n + '단계 완료">' +
        '<span class="num">' + s.n + '</span><label class="txt" for="cb-' + s.n + '">' + hl(s.text) + '<span class="meta">' +
        (s.opponent ? '<span class="tag bad">상대 행동</span>' : '') +
        (s.isSummon ? '<span class="tag">소환 ' + s.summonIndex + '번째</span>' : '') +
        (keys.length ? '<span class="tag">패트랩 데이터 ' + keys.length + '종</span>' : '') +
        (picked === s.n ? '<span class="tag bad">여기서 맞음</span>' : '') + '</span></label></li>';
    });
    h += '</ol><p class="small muted">"소환 n번째"는 앱이 단계 문장으로 센 참고값(한 단계 여러 장 P소환도 1번). 패트랩 화면의 소환 수는 데이터(summons_so_far) 값이다.</p></section>';
    h += '<div class="side"><section class="panel" id="trapPanel">' + renderTrapPanel(r, cur) + '</section>';
    h += '<section class="panel">' + renderFinal(r) + '</section>';
    h += '<section class="panel">' + renderReverse(r) + '</section>';
    h += '<section class="panel">' + renderNotes(r) + '</section></div></div>';
    return h;
  }

  function limitsHtml() {
    if (!HTM) return '';
    var lb = HTM.lowerBound ? '<p>' + inline(HTM.lowerBound) + '</p>' : '';
    return '<div class="limits">' + lb + '<p>' + esc(HTM.limits.title || '한계') + ' (dd-handtraps.md 6장)</p><ul>' +
      HTM.limits.bullets.map(function (b) { return '<li' + (b.indexOf('MD 실기') >= 0 ? ' style="font-weight:600;color:var(--text)"' : '') + '>' + hl(b) + '</li>'; }).join('') + '</ul></div>';
  }

  function renderTrapPanel(r, cur) {
    var h = '<h2>패트랩 맞음</h2>';
    if (!HTM) return h + '<div class="box bad">data/handtraps/meta.js를 못 불러왔다. scripts/build_handtraps.py를 실행했는지 확인해줘.</div>';
    var ht = state.ht && state.ht.routeId === r.id ? state.ht : { routeId: r.id, step: cur, trap: null, variant: null };
    var step = ht.trap === 'nibiru' ? cur : ht.step;
    if (ht.trap !== 'nibiru') {
      h += '<label class="lbl" for="htStep">맞은 단계</label><select class="full" id="htStep" data-act="ht-step">';
      r.steps.forEach(function (s) {
        var n = stepTrapKeys(r.id, s.n).filter(function (k) { return k !== 'nibiru'; }).length;
        h += '<option value="' + s.n + '"' + (s.n === step ? ' selected' : '') + '>' + s.n + '. ' + esc(s.text) + (n ? ' · 데이터 ' + n + '종' : ' · 데이터 없음') + '</option>';
      });
      h += '</select>';
      var keys = stepTrapKeys(r.id, step).filter(function (k) { return k !== 'nibiru'; });
      if (keys.length) {
        h += '<p class="small muted">' + step + '단계에 데이터가 있는 패트랩만 보여준다. 니비루는 위쪽 버튼.</p><div class="trap-grid">' + keys.map(function (k) {
          return '<button class="trap-btn" data-act="ht-trap" data-key="' + k + '" aria-pressed="' + (ht.trap === k ? 'true' : 'false') + '">' + esc(trapName(k)) + '</button>';
        }).join('') + '</div>';
      } else {
        h += '<div class="box">' + step + '단계에는 패트랩 데이터가 없다' + (stepTrapKeys(r.id, step).indexOf('nibiru') >= 0 ? '(니비루 데이터만 있음 → 위쪽 니비루 버튼)' : '') + '.</div>';
      }
    } else {
      h += '<p class="small">니비루 · 진행 위치 <strong>' + cur + '단계</strong> 기준. 단계를 체크해 진행하면 따라 바뀐다. <button data-act="ht-close">니비루 닫기</button></p>';
    }
    if (ht.trap) {
      var st = htStatus[r.id];
      var data = htData(r.id);
      if (!data) {
        h += st === 'error' ? '<div class="box bad">data/handtraps/' + r.id + '.js를 못 불러왔다.</div>' : '<div class="box">패트랩 데이터 불러오는 중…</div>';
      } else {
        var rec = htAt(r.id, step).filter(function (x) { return x.trap === ht.trap; })[0];
        if (!rec) {
          h += '<div class="box warn">' + step + '단계에는 ' + esc(trapName(ht.trap)) + ' 데이터가 없다.' +
            (ht.trap === 'nibiru' ? nibiruHint(r, step) : '') + '</div>';
        } else {
          h += renderRecord(r, rec, ht);
        }
      }
    }
    return h + limitsHtml();
  }

  function nibiruHint(r, step) {
    var steps = (HTM.stepTraps[r.id] && Object.keys(HTM.stepTraps[r.id]).filter(function (k) { return HTM.stepTraps[r.id][k].indexOf('nibiru') >= 0; }).map(Number)) || [];
    if (!steps.length) return ' 이 루트에는 니비루 데이터가 없다.';
    var first = Math.min.apply(null, steps);
    return step < first ? ' 이 루트의 니비루 데이터는 ' + first + '단계부터 있다(소환 5체째 이후).' : ' (이 단계는 상대 행동 단계이거나 데이터가 비어 있다.)';
  }

  // 레코드 변형: base | counter | x:<i> (패에 카드 더 있으면) | continue | d:<i> (내 드롤)
  function defaultVariant(rec) {
    var ex = rec.if_extra_card_in_hand || [];
    for (var i = 0; i < ex.length; i++) { var c = resolve(ex[i].card); if (c && cnt(state.hand, c) > 0) return 'x:' + i; }
    if (rec.with_my_droll) return 'continue';
    return 'base';
  }
  function planFor(rec, v) {
    if (v === 'counter') return rec.counter && rec.counter.plan;
    if (v.indexOf('x:') === 0) return (rec.if_extra_card_in_hand[+v.slice(2)] || {}).plan;
    if (v.indexOf('d:') === 0) return (rec.with_my_droll[+v.slice(2)] || {}).plan;
    if (v === 'continue') return null;
    return rec.plan;
  }
  function chips(list) {
    if (!list || !list.length) return '<span class="muted">없음</span>';
    return list.map(function (n) { return '<span class="chip">' + esc(n) + '</span>'; }).join(' ');
  }
  function fieldHtml(f) {
    return '<dl class="kv"><dt>몬스터</dt><dd>' + chips(f.monsters) + '</dd>' +
      '<dt>방해</dt><dd>' + (f.interruptions && f.interruptions.length ? '<ul style="margin:0;padding-left:18px">' + f.interruptions.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : '<span class="muted">없음</span>') + '</dd>' +
      (f.contracts ? '<dt>계약서</dt><dd>' + chips(f.contracts) + '</dd>' : '') +
      (f.pzones ? '<dt>P존</dt><dd>' + chips(f.pzones) + '</dd>' : '') +
      (typeof f.zero_machinex_waiting_in_extra === 'boolean' ? '<dt>엑덱 제로마키나 대기</dt><dd>' + (f.zero_machinex_waiting_in_extra ? '예' : '아니오') + '</dd>' : '') + '</dl>';
  }
  function sec(no, title, body) { return '<div class="ht-sec"><h4><span class="no">' + no + '</span> ' + title + '</h4>' + body + '</div>'; }

  function renderRecord(r, rec, ht) {
    var v = ht.variant || defaultVariant(rec);
    var key = r.id + '|' + rec.step + '|' + rec.trap + '|' + v;
    var mdStep = r.steps[rec.step - 1];
    var h = '<h3 style="margin-top:14px">' + esc(rec.trap_name) + ' · ' + rec.step + '단계</h3>' +
      '<p class="small">"' + hl(mdStep ? mdStep.text : rec.step_text) + '"' + (mdStep && mdStep.text !== rec.step_text ? ' <span class="muted">(데이터 문장: ' + esc(rec.step_text) + ')</span>' : '') +
      ' · 여기까지 소환 ' + rec.summons_so_far + '체 <span class="muted">(데이터)</span></p>';
    // 문서 루트
    if (rec.documented) {
      var ids = (rec.documented.match(/[A-G]\d{1,2}/g) || []).filter(function (id) { return routesById[id]; });
      var cond = rec.documented.match(/패에 (\S+?)이\(가\) 있으면/);
      h += '<div class="box ok"><h4>' + (ids.length ? '문서 루트 ' + ids.join('·') + ' 참조' : '문서 기록 있음') + '</h4><p>' + esc(rec.documented) + '</p>';
      if (ids.length) h += '<div class="row8">' + ids.map(function (id) { return '<button class="btn primary" data-act="open-route" data-id="' + id + '">' + id + ' 열기</button>'; }).join('') + '</div>';
      if (cond) {
        var cc = resolve(cond[1]);
        h += '<p class="small">조건: 패에 ' + esc(cond[1]) + ' — 선택한 패: ' + (handSize(state.hand) ? (cc && cnt(state.hand, cc) ? '✓ 있음' : '✗ 없음') : '패 미입력') + '</p>';
      }
      h += '</div>';
      var hasCalc = rec.plan || rec.with_my_droll || rec.counter || rec.if_extra_card_in_hand;
      if (!hasCalc) {
        return h + sec('1', '맞은 시점 상태', stateHtml(rec.state_at_hit));
      }
      h += '<p class="small muted">아래는 계산 결과다. 위 문서 루트의 조건이 안 맞을 때 참고.</p>';
    }
    // 카운터 선택지(맨 위)
    if (rec.counter) {
      h += '<div class="box"><h4>선택지</h4><div class="row8">' +
        '<button data-act="ht-variant" data-v="counter" aria-pressed="' + (v === 'counter' ? 'true' : 'false') + '">' + esc(rec.counter.how) + ' 가능</button>' +
        (v === 'counter' ? '<button data-act="ht-variant" data-v="' + (rec.with_my_droll ? 'continue' : 'base') + '">카운터 안 쓰고 진행</button>' : '') + '</div></div>';
    }
    // 증G·후와로스: 드롤 시점 비교
    if (rec.with_my_droll) h += compareHtml(r, rec, v);
    // 패에 카드 더 있으면
    if (rec.if_extra_card_in_hand && rec.if_extra_card_in_hand.length && v !== 'counter') {
      h += '<div class="row8" role="tablist" aria-label="패 상황">' +
        '<button role="tab" data-act="ht-variant" data-v="base" aria-selected="' + (v === 'base' ? 'true' : 'false') + '">기본</button>' +
        rec.if_extra_card_in_hand.map(function (e, i) {
          var c = resolve(e.card), have = c && cnt(state.hand, c) > 0;
          return '<button role="tab" data-act="ht-variant" data-v="x:' + i + '" aria-selected="' + (v === 'x:' + i ? 'true' : 'false') + '">패에 ' + esc(e.card) + ' 있으면' + (have ? ' (선택한 패에 있음)' : '') + '</button>';
        }).join('') + '</div>';
    }
    // 1 상태 → 2 생긴 일 → 3 할 일 → 4 건너뛴 단계 → 5 결과 필드
    h += sec('1', '맞은 시점 상태', stateHtml(rec.state_at_hit));
    var eff = rec.hit_effect === 'negated' ? '효과 무효 (negated)' : (rec.hit_effect || '—');
    h += sec('2', '맞아서 생긴 일', '<p>' + esc(eff) + (rec.banished_target ? ' · 제외된 카드: <strong>' + esc(rec.banished_target) + '</strong>' : '') + '</p>' +
      (rec.opp_draws_if_continue != null ? '<p class="small">끝까지 가면 상대 ' + rec.opp_draws_if_continue + '장 드로우 · 드로우가 생기는 단계: ' + esc(rec.draw_steps.join(', ')) + '</p>' : ''));
    var plan = planFor(rec, v);
    var label = v === 'counter' ? '할 일 (' + esc(rec.counter.how) + ' 후)' :
      v.indexOf('x:') === 0 ? '할 일 (패에 ' + esc(rec.if_extra_card_in_hand[+v.slice(2)].card) + ' 있을 때)' :
      v.indexOf('d:') === 0 ? '할 일 (' + rec.with_my_droll[+v.slice(2)].activate_after_step + '단계 직후 내 드롤)' : '할 일';
    if (v === 'continue') {
      h += sec('3', '할 일', '<p>드롤 없이 원래 루트를 그대로 진행한다(왼쪽 단계 목록). 위 비교 카드에서 드롤 시점을 고르면 그 수순을 보여준다.</p>');
      h += sec('5', '결과 필드', '<p class="small">원래 루트 최종: ' + hl(r.finalText) + '</p>');
      return h;
    }
    if (!plan) return h + sec('3', label, '<p class="muted">이 경우의 수순 데이터가 없다.</p>');
    var checks = state.htChecks[key] || [];
    var todo = plan.steps.length ? '<ol class="todo">' + plan.steps.map(function (s, i) {
      var on = checks.indexOf(i) >= 0, sub = s.indexOf('(대체)') >= 0;
      var id = 'td-' + i;
      return '<li class="' + (on ? 'done' : '') + '"><input type="checkbox" id="' + id + '" data-act="ht-check" data-key="' + esc(key) + '" data-i="' + i + '"' + (on ? ' checked' : '') + '>' +
        '<span class="num">' + (i + 1) + '</span><label class="txt" for="' + id + '">' + esc(s) + (sub ? ' <span class="tag sub">대체: 원래 루트와 소재·대상이 다름</span>' : '') + '</label></li>';
    }).join('') + '</ol>' : '<p class="muted">이어서 할 수 있는 단계가 없다.</p>';
    h += sec('3', label, '<p class="small muted">이어 붙인 수순: ' + ridLink(plan.base_route) + ' ' + plan.resume_from_step + '단계부터</p>' + todo);
    var sk = plan.skipped_original_steps || [];
    h += sec('4', '건너뛴 원래 단계', sk.length ? '<details class="inner"><summary>' + sk.length + '개 펼치기</summary><ul class="small">' +
      sk.map(function (s) { return '<li>' + s.step + '. ' + esc(s.text) + ' <span class="muted">— ' + esc(s.why) + '</span></li>'; }).join('') + '</ul></details>' : '<p class="muted small">없음</p>');
    h += sec('5', '결과 필드', fieldHtml(plan.final));
    return h;
  }

  function stateHtml(s) {
    if (!s) return '<p class="muted">없음</p>';
    return '<dl class="kv"><dt>몬스터</dt><dd>' + chips(s.monsters) + '</dd><dt>계약서</dt><dd>' + chips(s.contracts) + '</dd><dt>P존</dt><dd>' + chips(s.pzones) +
      '</dd><dt>패</dt><dd>' + chips(s.hand) + '</dd><dt>엑덱 앞면</dt><dd>' + chips(s.extra_faceup) + '</dd></dl>';
  }

  function compareHtml(r, rec, v) {
    var droll = cnt(state.hand, '드롤 & 로크 버드'), entered = handSize(state.hand) > 0;
    var h = '<div class="box"><h4>드롤 시점 비교</h4><p class="small">내 드롤이 필요하다 — 선택한 패: ' + (entered ? (droll ? '✓ ' + droll + '장' : '✗ 없음') : '패 미입력') + '</p><div class="compare">';
    h += '<div class="opt' + (v === 'continue' ? ' on' : '') + '"><strong>드롤 없이 끝까지</strong><div class="big">상대 ' + rec.opp_draws_if_continue + '장</div>' +
      '<div class="small">결과 필드: 원래 루트 최종 ' + hl(r.finalText) + '</div>' +
      '<button data-act="ht-variant" data-v="continue" aria-pressed="' + (v === 'continue' ? 'true' : 'false') + '">이 경우 보기</button></div>';
    rec.with_my_droll.forEach(function (w, i) {
      var on = v === 'd:' + i;
      h += '<div class="opt' + (on ? ' on' : '') + '"><strong>' + w.activate_after_step + '단계 직후 내 드롤</strong><div class="big">상대 ' + w.opp_draws + '장</div>' +
        '<div class="small">결과 몬스터: ' + esc((w.plan.final.monsters || []).join(', ') || '없음') + '</div>' +
        '<div class="small muted">방해 ' + (w.plan.final.interruptions || []).length + '개: ' + esc((w.plan.final.interruptions || []).map(function (x) { return x.split('(')[0]; }).join(', ') || '없음') + '</div>' +
        '<button data-act="ht-variant" data-v="d:' + i + '" aria-pressed="' + (on ? 'true' : 'false') + '">이 수순 보기</button></div>';
    });
    return h + '</div></div>';
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
    h += '<details class="inner"><summary>최종 필드 문서 메모</summary><p class="small">' + textBlock(D.finalField.intro) + '</p>' +
      D.finalField.notes.map(function (n) { return '<p class="small">' + textBlock(n) + '</p>'; }).join('') + '</details>';
    return h;
  }

  function renderReverse(r) {
    var present = {};
    finalCardsOf(r).forEach(function (fc) { present[fc.card] = fc.zone; });
    var item = C.reverseLookup.filter(function (x) { return x.key === state.rev; })[0] || C.reverseLookup[0];
    var h = '<h2>상대 행동 → 무엇으로 막나</h2><p class="small muted">이 루트 최종 필드 기준. 문서의 최종 필드 표·카드 효과 요약 문장만 근거로 쓴다.</p>' +
      '<label class="lbl" for="revSel">상대 행동</label><select class="full" id="revSel" data-act="rev">' + C.reverseLookup.map(function (x) { return '<option value="' + x.key + '"' + (x.key === item.key ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select>';
    var any = false;
    item.cards.forEach(function (c) {
      var here = present[c.card] && (!c.zone || present[c.card] === c.zone);
      if (here) any = true;
      var ff = ffByCard[c.card], ef = effectsByCard[c.card];
      h += '<div class="ff-card' + (here ? '' : ' absent') + '"><div class="name">' + esc(c.card) + ' ' + (here ? '<span class="tag ok">✓ 이 필드에 있음</span>' : '<span class="tag">이 루트 최종 필드에 없음</span>') +
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
        h += '<div class="route-item"><div class="head"><div class="title">' + routeTitle(r) + '</div><button data-act="start-route" data-id="' + id + '">진행</button></div>' +
          '<div class="small muted">이니시: ' + esc(r.initiator.map(short).join(' + ')) + ' · ' + r.steps.length + '단계' + (done ? ' · 체크 ' + done + '개' : '') +
          (HTM && HTM.counts[id] ? ' · 패트랩 데이터 ' + HTM.counts[id] + '건' : '') + ' · 최종: ' + hl(r.finalText) +
          (r.source ? ' · <a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a>' : '') + '</div></div>';
      });
      h += '</section>';
    });
    return h;
  }

  // ------------------------------------------------------------ 렌더: 패트랩 요약
  function renderHTSummary() {
    if (!HTM) return '<div class="panel">data/handtraps/meta.js가 없다.</div>';
    var h = '<section class="panel mdoc"><h2>패트랩 요약</h2><p class="small muted">dd-handtraps.md 3장·4장. 루트 ' + Object.keys(HTM.counts).length + '개, 레코드 ' + HTM.total + '건.</p>' +
      '<h3>' + esc(HTM.principles.title) + '</h3><ul>' + HTM.principles.bullets.map(function (b) { return '<li>' + textBlock(b) + '</li>'; }).join('') + '</ul></section>';
    h += '<section class="panel mdoc"><h3>' + esc(HTM.hurt.title) + '</h3><p class="small muted">루트 ID를 누르면 그 루트를 연다.</p>' + md(HTM.hurt.markdown) + '</section>';
    h += '<section class="panel mdoc"><details class="inner"><summary>' + esc(HTM.model.title) + ' (2장)</summary>' + md(HTM.model.markdown) + '</details>' + limitsHtml() + '</section>';
    return h;
  }

  // ------------------------------------------------------------ 렌더: 문서·검사
  function renderDoc() {
    var v = D.validation, fails = v.checks.filter(function (c) { return !c.ok; });
    var h = '<section class="panel"><h2>데이터 검사 결과</h2><p>' + (fails.length ? '<span class="tag bad">실패 ' + fails.length + '개</span>' : '<span class="tag ok">✓ 검사 ' + v.checks.length + '개 모두 통과</span>') +
      ' <span class="small muted">생성: ' + esc(D.meta.generatedAt) + '</span></p>' +
      '<details class="inner"' + (fails.length ? ' open' : '') + '><summary>검사 항목</summary><ul class="check-list">' +
      v.checks.map(function (c) { return '<li>' + (c.ok ? '✅' : '❌') + ' ' + hl(c.name) + (c.detail ? ' <span class="muted">— ' + hl(c.detail) + '</span>' : '') + '</li>'; }).join('') + '</ul></details>' +
      '<h3>문서끼리 어긋나거나 애매한 곳 (자동 검출)</h3><ul class="small">' + v.warnings.map(function (w) { return '<li>' + textBlock(w) + '</li>'; }).join('') + '</ul></section>';
    if (HTM) {
      h += '<section class="panel"><h2>패트랩 데이터 검사</h2><ul class="check-list">' + HTM.checks.map(function (c) { return '<li>' + (c.ok ? '✅' : '❌') + ' ' + hl(c.name) + (c.detail ? ' <span class="muted">— ' + hl(c.detail) + '</span>' : '') + '</li>'; }).join('') +
        '</ul><h3>이상해 보이는 데이터 (고치지 않고 표시만)</h3><ul class="small">' + HTM.issues.map(function (w) { return '<li>' + textBlock(w) + '</li>'; }).join('') + '</ul></section>';
    }
    h += '<section class="panel mdoc"><h2>' + esc(D.meta.guideTitle) + ' <span class="small muted">' + esc(D.meta.guideDate) + '</span></h2>';
    D.guideSections.forEach(function (s) { h += '<details class="inner"><summary>' + esc(s.title) + '</summary>' + md(s.markdown) + '</details>'; });
    return h + '</section>';
  }

  // ------------------------------------------------------------ 메인 렌더 · 이벤트
  function render() {
    document.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === state.tab ? 'true' : 'false'); });
    document.querySelectorAll('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.themeSet === state.theme ? 'true' : 'false'); });
    var fn = { hand: renderHand, route: renderRoute, all: renderAll, ht: renderHTSummary, doc: renderDoc }[state.tab] || renderHand;
    app.innerHTML = fn();
    saveState();
  }
  function applyTheme() { document.documentElement.setAttribute('data-theme', state.theme); }
  function setHT(patch) {
    var r = routesById[state.routeId];
    var base = state.ht && state.ht.routeId === r.id ? state.ht : { routeId: r.id, step: currentStep(r), trap: null, variant: null };
    state.ht = Object.assign({}, base, patch);
  }
  function scrollTrap() { var tp = document.getElementById('trapPanel'); if (tp && tp.scrollIntoView) tp.scrollIntoView({ block: 'start' }); }
  function scrollToStep(n) { var li = document.getElementById('step-' + n); if (li && li.scrollIntoView) li.scrollIntoView({ block: 'center' }); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act], [data-tab], [data-theme-set]');
    if (!el) return;
    if (el.tagName === 'A' && el.dataset.act) e.preventDefault();
    if (el.dataset.themeSet) { state.theme = el.dataset.themeSet; applyTheme(); render(); return; }
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
        state.routeId = el.dataset.id; state.tab = 'route'; state.ht = null; render(); window.scrollTo(0, 0); return;
      case 'next-step':
        if (r) { var cs = currentStep(r); var d = state.checks[r.id] || []; if (d.indexOf(cs) < 0) d.push(cs); state.checks[r.id] = d; render(); scrollToStep(currentStep(r)); }
        return;
      case 'undo-step':
        if (r) { var dd = (state.checks[r.id] || []).slice().sort(function (a, b) { return a - b; }); dd.pop(); state.checks[r.id] = dd; render(); }
        return;
      case 'reset-steps':
        if (r) { state.checks[r.id] = []; state.ht = null; render(); }
        return;
      case 'ht-nibiru':
        if (r) { if (state.ht && state.ht.routeId === r.id && state.ht.trap === 'nibiru') state.ht = null; else setHT({ trap: 'nibiru', variant: null }); render(); scrollTrap(); }
        return;
      case 'ht-close': state.ht = null; render(); return;
      case 'ht-trap':
        if (r) { var k = el.dataset.key; if (state.ht && state.ht.trap === k && state.ht.routeId === r.id) setHT({ trap: null, variant: null }); else setHT({ trap: k, variant: null }); render(); scrollTrap(); }
        return;
      case 'ht-variant': if (r) { setHT({ variant: el.dataset.v }); render(); } return;
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target, act = el.dataset.act, r = routesById[state.routeId];
    if (act === 'toggle-step' && r) {
      var n = Number(el.dataset.n), d = state.checks[r.id] || [];
      if (el.checked) { if (d.indexOf(n) < 0) d.push(n); } else d = d.filter(function (x) { return x !== n; });
      state.checks[r.id] = d; render(); return;
    }
    if (act === 'ht-check') {
      var key = el.dataset.key, i = Number(el.dataset.i), arr = state.htChecks[key] || [];
      if (el.checked) { if (arr.indexOf(i) < 0) arr.push(i); } else arr = arr.filter(function (x) { return x !== i; });
      state.htChecks[key] = arr; render(); return;
    }
    if (act === 'concern') { state.concern = el.value; render(); return; }
    if (act === 'ht-step' && r) { setHT({ step: Number(el.value), trap: null, variant: null }); render(); scrollTrap(); return; }
    if (act === 'rev') { state.rev = el.value; render(); }
  });

  document.getElementById('foot').innerHTML = '데이터: ' + D.meta.sources.map(esc).join(', ') + ', data/dd-handtraps.json · 생성 ' + esc(D.meta.generatedAt) +
    ' · 노란 표시(<mark class="m">추정</mark> 등)는 문서 원문의 표시를 그대로 강조한 것';
  applyTheme();
  render();
})();
