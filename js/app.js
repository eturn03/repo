// 돈 보드 화면. 폰(폭 900px 미만)은 숫자와 입력, 맥북(그 이상)은 한 화면 보드.
// 숫자는 서버가 준 입력값을 같은 Calc(apps-script/Calc.js)로 다시 계산해서 그린다.
// 그래서 기록을 누르는 즉시 숫자가 바뀌고, 서버 응답이 오면 그 값으로 맞춰진다.
(function () {
  'use strict';

  var CFG = window.DASH_CONFIG;
  var KEY = {
    token: 'dash.token', cache: 'dash.cache2', sprites: 'dash.sprites',
    queue: 'dash.queue', method: 'dash.lastMethod'
  };
  var SPRITE_MAX_AGE = 24 * 60 * 60 * 1000;
  var RETRY_MS = 30 * 1000;

  var params = new URLSearchParams(location.search);
  var DEMO = params.has('demo');

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    gate: $('gate'), gateForm: $('gate-form'), gateInput: $('gate-input'), gateError: $('gate-error'),
    gateHelp: $('gate-help'), gateTitle: $('gate-title'), gateDemo: $('gate-demo'),
    app: $('app'),
    todayNum: $('today-num'), todayWrap: $('today-amount'), todayNote: $('today-note'),
    hp: $('hp'), hpFill: $('hp-fill'), monthLeft: $('month-left'),
    form: $('entry-form'), amount: $('amount'), amountClear: $('amount-clear'), preview: $('preview'),
    cats: $('cats'), methods: $('methods'), memo: $('memo'), date: $('entry-date'), more: $('more'),
    entryError: $('entry-error'),
    undo: $('undo'), undoText: $('undo-text'), undoBtn: $('undo-btn'),
    scene: $('scene'), status: $('status-line'),
    ledger: $('ledger-list'), recent: $('recent-list'),
    metaTime: $('meta-time'), metaQueue: $('meta-queue'), metaDemo: $('meta-demo'), reset: $('reset-token')
  };

  var data = null;        // 서버의 마지막 summary 응답
  var queue = load(KEY.queue) || [];   // 아직 서버에 못 보낸 기록·취소 [{op, id, ...}]
  var sending = false;
  var sendFailed = false;  // 마지막 전송이 연결 문제로 실패했는지
  var lastFetch = 0;
  var timers = { refresh: null, retry: null, undo: null };
  var sprites = {};
  var mood = 'normal';
  var lastAdded = null;   // 방금 기록한 것 (취소용)
  var demoServer = null;

  /* ---------- 저장소 (사생활 모드 등에서 실패해도 화면은 뜨게) ---------- */
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ }
  }
  function drop(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 무시 */ }
  }
  function saveQueue() { if (!DEMO) save(KEY.queue, queue); }

  /* ---------- 날짜·숫자 ---------- */
  function seoulToday() {
    // en-CA 형식이 YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  }
  function won(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function shortDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text || '');
    return m ? Number(m[2]) + '월 ' + Number(m[3]) + '일' : '';
  }
  function readAmount() {
    var n = Number(String(el.amount.value).replace(/[^0-9]/g, ''));
    return isFinite(n) && n > 0 ? Math.min(n, 9999999) : 0;
  }
  function newId() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- 서버 ---------- */
  function api(view, body) {
    if (DEMO) return demoServer.handle(view, body || {});
    var payload = Object.assign({ token: load(KEY.token), view: view }, body || {});
    return fetch(CFG.API_URL, {
      method: 'POST',
      // text/plain 이어야 브라우저가 사전 확인 요청을 안 보내서 Apps Script가 받을 수 있다
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function accept(res) {
    if (!res || !res.ok || !res.input) return false;
    data = res;
    if (!DEMO) save(KEY.cache, res);
    return true;
  }

  function refresh() {
    lastFetch = Date.now();
    return api('summary').then(function (res) {
      if (res && !res.ok && !res.error) { showGate('토큰이 맞지 않는다. 다시 확인해 줘.'); return; }
      if (accept(res)) { render(); flush(); }
    }).catch(function () {
      // 연결이 안 돼도 기기에 남은 값으로 그린다
      if (data) render();
      else say('▶ 서버와 연결이 잘 안 된다... 5분 뒤에 다시 해 본다.');
    });
  }

  /* ---------- 대기열: 기록과 취소를 순서대로 보낸다 ---------- */
  function flush() {
    if (sending || queue.length === 0) return;
    sending = true;
    var item = queue[0];
    var view = item.op === 'add' ? 'add_expense' : 'delete_expense';
    api(view, item).then(function (res) {
      sending = false;
      sendFailed = false;
      queue.shift();
      saveQueue();
      if (res && res.ok) accept(res);
      else if (res && res.error) showEntryError('기록하지 못했다: ' + res.error);
      render();
      flush();
    }).catch(function () {
      sending = false;
      sendFailed = true;
      render();
      clearTimeout(timers.retry);
      timers.retry = setTimeout(flush, RETRY_MS);
    });
  }

  function enqueue(item) {
    queue.push(item);
    saveQueue();
    render();
    flush();
  }

  /* ---------- 지금 보여 줄 값: 서버 값 + 아직 안 보낸 기록 ---------- */
  function view() {
    if (!data) return null;
    var adds = queue.filter(function (q) { return q.op === 'add'; });
    var deleted = {};
    queue.forEach(function (q) { if (q.op === 'delete') deleted[q.id] = true; });
    var keep = function (r) { return !deleted[r.id]; };

    var input = Object.assign({}, data.input, {
      today: seoulToday(),
      expenses: data.input.expenses.filter(keep).concat(adds.filter(keep))
    });
    var pendingIds = {};
    adds.forEach(function (a) { pendingIds[a.id] = true; });
    var recent = adds.filter(keep).slice().reverse()
      .concat(data.recent.filter(function (r) { return keep(r) && !pendingIds[r.id]; }))
      .slice(0, 8);
    return { result: Calc.summary(input), recent: recent, pending: pendingIds };
  }

  /* ---------- 그리기 ---------- */
  function render() {
    var v = view();
    if (!v) return;
    var r = v.result;

    setAmount(r.available);
    el.todayNote.textContent = '등교일마다 ' + won(r.perSchoolDay) + '원씩 쌓인다' +
      (r.isSchoolDay ? '' : ' · 오늘은 쉬는 날');

    var ratio = r.cycleBudget > 0 ? Math.max(0, Math.min(1, r.monthLeft / r.cycleBudget)) : 0;
    el.hp.dataset.level = ratio > 0.5 ? 'good' : ratio > 0.2 ? 'warn' : 'bad';
    el.hp.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    el.hpFill.style.setProperty('--ratio', String(ratio));
    el.monthLeft.textContent = r.monthLeft < 0
      ? '이번 달 ' + won(r.cycleBudget) + '원에서 ' + won(-r.monthLeft) + '원 넘게 썼다'
      : '이번 달 ' + won(r.cycleBudget) + '원 중 ' + won(r.monthLeft) + '원 남음';

    renderChoices();
    renderPreview(r);
    renderLedger(r);
    renderRecent(v.recent, v.pending);

    say(statusLine(r));
    setMood(moodFor(r));

    el.metaTime.textContent = stamp() + ' · 마지막 카드 대조 ' +
      (data.lastReconciled ? shortDate(data.lastReconciled) : '아직 안 함');
    var waiting = queue.length;
    el.metaQueue.hidden = waiting === 0;
    el.metaQueue.textContent = sendFailed
      ? '보내지 못한 기록 ' + waiting + '건 · 연결되면 자동으로 보낸다'
      : '서버에 보내는 중 ' + waiting + '건';
  }

  function setAmount(n) {
    var text = won(n);
    el.todayWrap.classList.toggle('is-negative', n < 0);
    if (el.todayNum.textContent !== text) {
      var changed = el.todayNum.textContent !== '-';
      el.todayNum.textContent = text;
      if (changed) bump(el.todayNum);
    }
  }

  function bump(node) {
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  // 분류 버튼과 수단 버튼은 목록이 바뀔 때만 다시 만든다
  var drawnChoices = '';
  function renderChoices() {
    var key = JSON.stringify([data.categories, data.methods]);
    if (key === drawnChoices) { syncMethod(); return; }
    drawnChoices = key;

    el.cats.textContent = '';
    data.categories.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat';
      b.textContent = c;
      b.addEventListener('click', function () { record(c); });
      el.cats.appendChild(b);
    });

    el.methods.textContent = '';
    data.methods.forEach(function (m) {
      var label = document.createElement('label');
      label.className = 'method';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'method';
      input.value = m;
      input.addEventListener('change', function () { save(KEY.method, m); });
      var span = document.createElement('span');
      span.textContent = m;
      label.appendChild(input);
      label.appendChild(span);
      el.methods.appendChild(label);
    });
    syncMethod();
  }

  function currentMethod() {
    var picked = el.methods.querySelector('input:checked');
    return picked ? picked.value : '';
  }

  // 직전에 쓴 수단 → 시트의 기본수단 → 첫 번째 순서로 미리 고른다
  function syncMethod() {
    if (currentMethod()) return;
    var want = [load(KEY.method), data.defaultMethod, data.methods[0]];
    for (var i = 0; i < want.length; i++) {
      var box = want[i] && el.methods.querySelector('input[value="' + CSS.escape(want[i]) + '"]');
      if (box) { box.checked = true; return; }
    }
  }

  function renderPreview(r) {
    var amount = readAmount();
    el.cats.classList.toggle('is-ready', amount > 0);
    el.amountClear.hidden = !el.amount.value;
    if (!amount) {
      el.preview.textContent = '금액을 치고 분류를 누르면 기록된다.';
      el.preview.dataset.tone = '';
      return;
    }
    var after = r.available - amount;
    if (after >= 0) {
      el.preview.textContent = won(amount) + '원을 쓰면 오늘까지 쓸 돈이 ' + won(after) + '원 남는다.';
      el.preview.dataset.tone = '';
    } else {
      el.preview.textContent = won(amount) + '원을 쓰면 ' + won(-after) + '원 넘는다. 다음 등교일 몫에서 빠진다.';
      el.preview.dataset.tone = 'over';
    }
  }

  function ledgerRow(label, value, note) {
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    el.ledger.appendChild(dt);
    el.ledger.appendChild(dd);
    if (note) {
      var small = document.createElement('dd');
      small.className = 'note';
      small.textContent = note;
      el.ledger.appendChild(small);
    }
    return dd;
  }

  function renderLedger(r) {
    el.ledger.textContent = '';
    ledgerRow('등교일 예산 (하루)', won(r.perSchoolDay) + '원');
    ledgerRow('이번 달 예산', won(r.cycleBudget) + '원');
    if (r.irregular && r.irregular.remaining > 0) {
      ledgerRow('비정규 쓸 돈 (남음)', won(r.irregular.remaining) + '원', shortDate(r.irregular.endDate) + '까지 등교일마다 더해진다');
    }
    ledgerRow('교통 (실제 + 예상)', won(r.transit) + '원',
      r.transitCheckedUntil ? shortDate(r.transitCheckedUntil) + '까지 실제' : '');
    // 음수면 빨간 글씨 (이유는 상태 문장이 말한다)
    var repay = ledgerRow('월 상환 가능액', (r.repayable < 0 ? '−' : '') + won(Math.abs(r.repayable)) + '원');
    repay.classList.toggle('is-bad', r.overIncome);
    ledgerRow('남은 빚', won(r.debtLeft) + '원');
  }

  function renderRecent(list, pending) {
    el.recent.textContent = '';
    if (list.length === 0) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '아직 기록이 없다. 금액을 치고 분류를 누르면 여기에 쌓인다.';
      el.recent.appendChild(li);
      return;
    }
    list.forEach(function (x) {
      var li = document.createElement('li');
      var when = document.createElement('span');
      when.className = 'r-date';
      when.textContent = shortDate(x.date);
      var what = document.createElement('span');
      what.className = 'r-what';
      what.textContent = x.category + (x.memo ? ' · ' + x.memo : '');
      var amount = document.createElement('span');
      amount.className = 'r-amount';
      amount.textContent = won(x.amount) + '원';
      li.appendChild(when);
      li.appendChild(what);
      li.appendChild(amount);
      if (pending[x.id]) {
        li.classList.add('is-pending');
        li.title = '아직 서버에 보내는 중';
      }
      el.recent.appendChild(li);
    });
  }

  // 게임 말투는 이 상태 문장에만 쓴다
  function statusLine(r) {
    if (r.monthLeft <= 0 && r.cycleBudget > 0) return '▶ 돈 좀... 아껴라...';
    if (r.overIncome) return '▶ 예산이 수입을 ' + won(-r.repayable) + '원 넘는다! 등교일 예산을 줄여야 한다.';
    if (r.needRebudget) return '▶ 기록 ' + r.recordDay + '일째! 등교일 예산을 다시 정할 때다.';
    if (r.available < 0) return '▶ 오늘 몫을 ' + won(-r.available) + '원 넘게 썼다! 다음 등교일 몫에서 빠진다.';
    if (!r.isSchoolDay) return '▶ 오늘은 쉬는 날. 숫자는 그대로다. 남은 돈은 ' + won(r.available) + '원!';
    return '▶ 오늘까지 쓸 수 있는 돈은 ' + won(r.available) + '원!';
  }

  function moodFor(r) {
    if (r.monthLeft <= 0 && r.cycleBudget > 0) return 'ghost';
    if (r.available < 0 || r.overIncome) return 'angry';
    if (r.perSchoolDay > 0 && r.available >= r.perSchoolDay * 2) return 'happy';
    return 'normal';
  }

  function say(text) {
    if (el.status.textContent !== text) el.status.textContent = text;
  }

  function stamp() {
    var src = data && data.updatedAt ? new Date(data.updatedAt) : new Date();
    if (isNaN(src)) src = new Date();
    var hhmm = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(src);
    return hhmm + ' 기준 · 5분마다 자동 갱신';
  }

  /* ---------- 입력 ---------- */
  function record(category) {
    var amount = readAmount();
    if (!amount) {
      showEntryError('금액부터 쳐 줘.');
      el.amount.focus();
      return;
    }
    var method = currentMethod();
    var item = {
      op: 'add', id: newId(), amount: amount, category: category, method: method,
      memo: el.memo.value.trim().slice(0, 100), date: el.date.value || seoulToday()
    };
    showEntryError('');
    lastAdded = item;
    el.amount.value = '';
    el.memo.value = '';
    el.date.value = '';
    el.more.open = false;
    enqueue(item);
    showUndo(category + ' ' + won(amount) + '원 기록했다.');
  }

  function showUndo(text) {
    el.undoText.textContent = text;
    el.undo.hidden = false;
    el.preview.hidden = true;
    clearTimeout(timers.undo);
    timers.undo = setTimeout(hideUndo, 60 * 1000);
  }

  function hideUndo() {
    el.undo.hidden = true;
    el.preview.hidden = false;
    lastAdded = null;
  }

  function undoLast() {
    if (!lastAdded) return;
    var id = lastAdded.id;
    hideUndo();
    // 아직 안 보낸 기록이면 대기열에서 빼기만 한다
    var idx = -1;
    queue.forEach(function (q, i) { if (q.op === 'add' && q.id === id) idx = i; });
    if (idx > 0 || (idx === 0 && !sending)) {
      queue.splice(idx, 1);
      saveQueue();
      render();
      return;
    }
    enqueue({ op: 'delete', id: id });
  }

  function showEntryError(text) {
    el.entryError.hidden = !text;
    el.entryError.textContent = text;
  }

  el.form.addEventListener('submit', function (e) { e.preventDefault(); });
  el.amount.addEventListener('input', function () {
    var n = readAmount();
    el.amount.value = n ? n.toLocaleString('ko-KR') : '';
    if (n && !el.undo.hidden) hideUndo();
    showEntryError('');
    render();
  });
  // 안 샀으면 지우기: 아무것도 남기지 않는다
  el.amountClear.addEventListener('click', function () {
    el.amount.value = '';
    el.memo.value = '';
    el.date.value = '';
    el.more.open = false;
    showEntryError('');
    render();
    el.amount.focus();
  });
  el.undoBtn.addEventListener('click', undoLast);

  /* ---------- 마스코트 ---------- */
  var sprite = document.createElement('img');
  sprite.className = 'sprite';
  sprite.alt = '';
  // 픽셀이 뭉개지지 않게 원본 크기의 정수배로만 키운다
  // 보드에서는 대화창 높이를 넘지 않는 가장 큰 정수배
  sprite.addEventListener('load', function () {
    var maxH = window.matchMedia('(min-width: 1800px)').matches ? 150
      : window.matchMedia('(min-width: 900px)').matches ? 130 : 128;
    var scale = Math.max(1, Math.floor(maxH / sprite.naturalHeight));
    sprite.style.width = (sprite.naturalWidth * scale) + 'px';
    sprite.style.height = (sprite.naturalHeight * scale) + 'px';
  });

  function setMood(next) {
    mood = next;
    // 유령 이미지가 없으면 화난 표정으로 대신
    var src = sprites[next] || (next === 'ghost' && sprites.angry) || sprites.normal;
    el.scene.classList.toggle('is-ghost', next === 'ghost' && src === sprites.ghost);
    if (!src) { el.scene.hidden = true; el.app.classList.remove('has-sprite'); return; }
    el.scene.hidden = false;
    el.app.classList.add('has-sprite');
    if (!sprite.parentNode) el.scene.appendChild(sprite);
    if (sprite.getAttribute('src') !== src) sprite.src = src;
  }

  function loadSprites() {
    if (DEMO) {
      // 로컬 미리보기 전용: local-sprites/ 폴더 (git이 무시). 배포 주소에선 찾지 않는다
      if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
      ['normal', 'happy', 'angry', 'ghost'].forEach(function (name) {
        var url = 'local-sprites/' + name + '.png';
        var probe = new Image();
        probe.onload = function () { sprites[name] = url; setMood(mood); };
        probe.src = url;
      });
      return;
    }
    var cached = load(KEY.sprites);
    if (cached && cached.sprites && Date.now() - cached.at < SPRITE_MAX_AGE) {
      sprites = cached.sprites;
      setMood(mood);
      return;
    }
    api('sprites').then(function (res) {
      if (!res || !res.sprites) return;
      sprites = res.sprites;
      save(KEY.sprites, { at: Date.now(), sprites: sprites });
      setMood(mood);
    }).catch(function () { /* 마스코트가 없어도 숫자는 그대로 */ });
  }

  /* ---------- 시작과 갱신 ---------- */
  function startApp() {
    el.gate.hidden = true;
    el.app.hidden = false;
    el.metaDemo.hidden = !DEMO;
    el.reset.hidden = DEMO;
    if (DEMO) demoServer = window.makeDemoServer(params.get('demo'), seoulToday());
    var cached = DEMO ? null : load(KEY.cache);
    if (cached && cached.input) { data = cached; render(); }
    loadSprites();
    refresh();
    clearInterval(timers.refresh);
    timers.refresh = setInterval(refresh, CFG.REFRESH_MS);
  }

  // 화면을 다시 보거나 창을 눌렀을 때 30초 넘게 지났으면 바로 갱신
  function refreshIfStale() {
    if (!el.app.hidden && Date.now() - lastFetch > CFG.REFOCUS_MS) refresh();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshIfStale();
  });
  window.addEventListener('focus', refreshIfStale);
  window.addEventListener('pageshow', refreshIfStale);
  window.addEventListener('online', flush);

  /* ---------- 토큰 입력 ---------- */
  function showGate(message) {
    clearInterval(timers.refresh);
    el.app.hidden = true;
    el.gate.hidden = false;
    el.gateError.hidden = !message;
    el.gateError.textContent = message || '';
    if (!CFG.API_URL) {
      el.gateTitle.textContent = '연결 준비 중';
      el.gateHelp.textContent = '아직 서버 주소가 없다. 연결을 마치면 여기서 토큰을 한 번 입력하게 된다.';
      el.gateForm.hidden = true;
      el.gateDemo.hidden = false;
      return;
    }
    el.gateInput.focus();
  }

  el.gateForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var token = el.gateInput.value.trim();
    if (!token) return;
    var btn = el.gateForm.querySelector('button');
    btn.disabled = true;
    save(KEY.token, token);
    api('summary').then(function (res) {
      if (!res || !res.ok) {
        drop(KEY.token);
        showGate('토큰이 맞지 않는다. 다시 확인해 줘.');
        return;
      }
      accept(res);
      el.gateInput.value = '';
      startApp();
    }).catch(function () {
      drop(KEY.token);
      showGate('서버에 연결하지 못했다. 잠시 뒤에 다시 해 줘.');
    }).then(function () {
      btn.disabled = false;
    });
  });

  el.reset.addEventListener('click', function () {
    drop(KEY.token);
    drop(KEY.cache);
    drop(KEY.sprites);
    showGate();
  });

  if (DEMO || load(KEY.token)) startApp();
  else showGate();
})();
