(function () {
  'use strict';

  var CFG = window.DASH_CONFIG;
  var TOKEN_KEY = 'dash.token';
  var CACHE_KEY = 'dash.cache';
  var SPRITE_KEY = 'dash.sprites';
  var SPRITE_MAX_AGE = 24 * 60 * 60 * 1000; // 스프라이트는 하루에 한 번만 다시 받음

  var params = new URLSearchParams(location.search);
  var DEMO = params.has('demo');

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    gate: $('gate'), gateForm: $('gate-form'), gateInput: $('gate-input'),
    gateError: $('gate-error'), gateHelp: $('gate-help'), gateDemo: $('gate-demo'),
    board: $('board'),
    hp: $('hp'), hpFill: $('hp-fill'),
    amountWrap: document.querySelector('.money-amount'), amount: $('money-amount'), moneyOf: $('money-of'),
    scene: $('scene'),
    status: $('status-line'),
    ledger: $('ledger'), ledgerList: $('ledger-list'),
    metaTime: $('meta-time'), metaDemo: $('meta-demo'), reset: $('reset-token')
  };

  var timer = null;
  var lastFetch = 0;
  var sprites = {};
  var currentMood = 'normal';

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

  /* ---------- 서버 요청 ---------- */
  function api(view, token) {
    return fetch(CFG.API_URL, {
      method: 'POST',
      // text/plain 이어야 브라우저가 사전 확인 요청을 안 보내서 Apps Script가 받을 수 있다
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: token, view: view }),
      redirect: 'follow'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function fetchData() {
    if (DEMO) {
      return fetch('demo.json', { cache: 'no-store' }).then(function (r) { return r.json(); });
    }
    return api('data', load(TOKEN_KEY));
  }

  /* ---------- 숫자 ---------- */
  function won(n) {
    return Math.round(n).toLocaleString('ko-KR');
  }

  function findRow(rows, key) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i]['항목']).trim() === key) return rows[i];
    }
    return null;
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : NaN;
  }

  /* ---------- 화면 그리기 ---------- */
  function value(rows, key) {
    var row = findRow(rows, key);
    return row ? toNumber(row['값']) : NaN;
  }

  function render(data) {
    var M = CFG.MONEY;
    var rows = (data.tabs && data.tabs[M.tab]) || null;
    if (!rows) {
      say('▶ 시트에서 \'' + M.tab + '\' 탭을 찾지 못했다.');
      setMood('normal');
      return;
    }

    var today = value(rows, M.today);
    var daily = value(rows, M.daily);
    var left = value(rows, M.left);
    var total = value(rows, M.total);

    if (isNaN(today)) {
      el.amount.textContent = '-';
      el.hp.hidden = true;
      el.moneyOf.hidden = true;
      say('▶ 시트에서 \'' + M.today + '\' 항목을 찾지 못했다.');
      setMood('normal');
    } else {
      setAmount(today);

      // HP 바: 이번 달 예산 중 남은 비율
      if (!isNaN(left) && !isNaN(total) && total > 0) {
        var ratio = Math.max(0, Math.min(1, left / total));
        el.hp.hidden = false;
        el.hp.dataset.level = ratio > 0.5 ? 'good' : ratio > 0.2 ? 'warn' : 'bad';
        el.hp.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
        el.hpFill.style.setProperty('--ratio', String(ratio));
        el.moneyOf.hidden = false;
        el.moneyOf.textContent = '이번 달 ' + won(total) + '원 중 ' + won(left) + '원 남음';
      } else {
        el.hp.hidden = true;
        el.moneyOf.hidden = true;
      }

      say(statusLine(today, daily));
      setMood(moodFor(today, daily));
    }

    renderLedger(rows);
    el.metaTime.textContent = stamp(data.updatedAt);
  }

  function statusLine(today, daily) {
    if (today < 0) return '▶ 오늘 몫을 ' + won(-today) + '원 넘게 썼다! 내일 몫에서 빠진다.';
    if (!isNaN(daily) && today < daily) return '▶ 오늘은 ' + won(today) + '원까지! 아껴 쓰자.';
    return '▶ 오늘까지 쓸 수 있는 돈은 ' + won(today) + '원!';
  }

  // 마이너스면 화남, 이틀치 이상 남아 있으면 기쁨, 그 사이는 일반
  function moodFor(today, daily) {
    if (today < 0) return 'angry';
    if (!isNaN(daily) && daily > 0 && today >= daily * 2) return 'happy';
    return 'normal';
  }

  function setAmount(n) {
    var text = won(n);
    el.amountWrap.classList.toggle('is-negative', n < 0);
    if (el.amount.textContent !== text) {
      var changed = el.amount.textContent !== '-';
      el.amount.textContent = text;
      if (changed) bump(el.amount);
    }
  }

  function bump(node) {
    node.classList.remove('bump');
    void node.offsetWidth; // 애니메이션 다시 시작
    node.classList.add('bump');
  }

  function renderLedger(rows) {
    var items = CFG.MONEY.ledger.filter(function (pair) { return findRow(rows, pair[1]); });
    el.ledger.hidden = items.length === 0;
    el.ledgerList.textContent = '';
    items.forEach(function (pair) {
      var raw = findRow(rows, pair[1])['값'];
      var n = toNumber(raw);
      var dt = document.createElement('dt');
      dt.textContent = pair[0];
      var dd = document.createElement('dd');
      dd.textContent = isNaN(n) || raw === '' ? String(raw) : won(n) + '원';
      el.ledgerList.appendChild(dt);
      el.ledgerList.appendChild(dd);
    });
  }

  function say(text) {
    if (el.status.textContent !== text) el.status.textContent = text;
  }

  function stamp(updatedAt) {
    var d = updatedAt ? new Date(updatedAt) : new Date();
    if (isNaN(d)) d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm + ' 기준 · 5분마다 자동 갱신';
  }

  /* ---------- 마스코트 ---------- */
  function setMood(mood) {
    currentMood = mood;
    var src = sprites[mood] || sprites.normal;
    if (!src) { el.scene.hidden = true; el.board.classList.remove('has-sprite'); return; }
    el.scene.hidden = false;
    el.board.classList.add('has-sprite');
    if (!el.sprite.parentNode) el.scene.appendChild(el.sprite);
    if (el.sprite.getAttribute('src') !== src) el.sprite.src = src;
  }

  // 마스코트 이미지는 스프라이트가 있을 때만 만든다
  el.sprite = document.createElement('img');
  el.sprite.className = 'sprite';
  el.sprite.alt = '';

  // 픽셀이 뭉개지지 않게 원본 크기의 정수배로만 키운다
  el.sprite.addEventListener('load', function () {
    var scale = window.matchMedia('(min-width: 900px)').matches ? 4 : 2;
    el.sprite.style.width = (el.sprite.naturalWidth * scale) + 'px';
    el.sprite.style.height = (el.sprite.naturalHeight * scale) + 'px';
  });

  function loadSprites() {
    if (DEMO) {
      // 로컬 미리보기 전용: local-sprites/ 폴더 (깃에 안 올라감). 배포 주소에선 찾지 않음
      if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
      ['normal', 'happy', 'angry'].forEach(function (name) {
        var url = 'local-sprites/' + name + '.png';
        var probe = new Image();
        probe.onload = function () { sprites[name] = url; setMood(currentMood); };
        probe.src = url;
      });
      return;
    }
    var cached = load(SPRITE_KEY);
    if (cached && cached.sprites && Date.now() - cached.at < SPRITE_MAX_AGE) {
      sprites = cached.sprites;
      setMood(currentMood);
      return;
    }
    api('sprites', load(TOKEN_KEY)).then(function (res) {
      if (!res || !res.sprites) return;
      sprites = res.sprites;
      save(SPRITE_KEY, { at: Date.now(), sprites: sprites });
      setMood(currentMood);
    }).catch(function () { /* 스프라이트가 없어도 돈 화면은 그대로 */ });
  }

  /* ---------- 갱신 ---------- */
  function refresh() {
    lastFetch = Date.now();
    return fetchData().then(function (data) {
      if (!data || !data.tabs) {
        // 토큰이 틀리면 서버가 빈 객체를 준다
        showGate('토큰이 맞지 않는다. 다시 확인해 줘.');
        return;
      }
      if (!DEMO) save(CACHE_KEY, data);
      render(data);
    }).catch(function () {
      say('▶ 연결이 잘 안 된다... 5분 뒤에 다시 해 본다.');
    });
  }

  function startBoard() {
    el.gate.hidden = true;
    el.board.hidden = false;
    el.metaDemo.hidden = !DEMO;
    el.reset.hidden = DEMO;

    var cached = DEMO ? null : load(CACHE_KEY);
    if (cached && cached.tabs) render(cached);

    loadSprites();
    refresh();
    clearInterval(timer);
    timer = setInterval(refresh, CFG.REFRESH_MS);
  }

  // 화면을 다시 보거나 창을 클릭했을 때 30초 넘게 지났으면 바로 갱신
  // (단축어로 기록하고 대시보드를 열었을 때 옛날 숫자가 남지 않게)
  var REFOCUS_MS = 30 * 1000;
  function refreshIfStale() {
    if (!el.board.hidden && Date.now() - lastFetch > REFOCUS_MS) refresh();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshIfStale();
  });
  window.addEventListener('focus', refreshIfStale);
  window.addEventListener('pageshow', refreshIfStale);

  /* ---------- 토큰 입력 ---------- */
  function showGate(message) {
    clearInterval(timer);
    el.board.hidden = true;
    el.gate.hidden = false;
    el.gateError.hidden = !message;
    el.gateError.textContent = message || '';
    if (!CFG.API_URL) {
      // 아직 연결 전: 넣을 토큰이 없으니 입력칸 대신 안내와 예시 화면 링크만
      document.getElementById('gate-title').textContent = '연결 준비 중';
      el.gateHelp.textContent = '아직 구글 시트와 연결되지 않았다. 연결을 마치면 여기서 토큰을 한 번 입력하게 된다.';
      el.gateForm.hidden = true;
      el.gateDemo.hidden = false;
      return;
    }
    el.gateInput.focus();
  }

  el.gateForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var token = el.gateInput.value.trim();
    if (!token || !CFG.API_URL) return;
    var btn = el.gateForm.querySelector('button');
    btn.disabled = true;
    api('data', token).then(function (data) {
      if (!data || !data.tabs) {
        showGate('토큰이 맞지 않는다. 다시 확인해 줘.');
        return;
      }
      save(TOKEN_KEY, token);
      save(CACHE_KEY, data);
      el.gateInput.value = '';
      startBoard();
    }).catch(function () {
      showGate('서버에 연결하지 못했다. 잠시 뒤에 다시 해 줘.');
    }).then(function () {
      btn.disabled = false;
    });
  });

  el.reset.addEventListener('click', function () {
    drop(TOKEN_KEY);
    drop(CACHE_KEY);
    drop(SPRITE_KEY);
    showGate();
  });

  /* ---------- 시작 ---------- */
  if (DEMO || load(TOKEN_KEY)) startBoard();
  else showGate();
})();
