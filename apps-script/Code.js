/**
 * 돈 보드 서버 (Google Apps Script 웹앱). 구글 시트 "돈관리"에 붙어 있다.
 * 계산은 Calc.js가 하고, 이 파일은 시트를 평범한 객체로 읽고 쓰기만 한다.
 *
 * 비밀값은 여기 적지 않는다. 전부 "스크립트 속성"에 둔다.
 *   TOKEN            : 접속용 비밀 토큰 (setupToken을 실행하면 만들어진다)
 *   SPRITE_FOLDER_ID : 마스코트 이미지가 든 드라이브 폴더 ID (없으면 "대시보드 스프라이트" 폴더를 이름으로 찾는다)
 *
 * 요청: POST, 본문은 JSON 문자열 {"token": "...", "view": "...", ...}, Content-Type은 text/plain.
 * 토큰이 틀리면 {} 만 돌려준다. GET은 항상 {}.
 *   ping            → {ok}
 *   summary         → 화면에 필요한 것 전부 (아래 summary_ 참고)
 *   add_expense     → {id, amount, category, method, memo, date} 기록 후 새 summary. 같은 id는 한 번만 기록
 *   delete_expense  → {id} 지운 뒤 새 summary
 *   widget          → {available, date, at}
 *   sprites         → {sprites: {normal: dataURI, ...}}
 * 올리기: npx @google/clasp push → 같은 배포 ID로 다시 배포 (tasks/plan.md 5절).
 */

var TAB = {
  settings: '설정', expenses: '지출', subscriptions: '고정비', repayments: '상환',
  incomes: '수입', vacations: '방학'
};
var RECENT_COUNT = 8;
var MAX_AMOUNT = 10000000;

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({});
  }
  if (!body || !isValidToken_(body.token)) return json_({});

  try {
    switch (body.view) {
      case 'ping': return json_({ ok: true, at: new Date().toISOString() });
      case 'summary': return json_(summary_(book_()));
      case 'add_expense': return json_(addExpense_(body));
      case 'delete_expense': return json_(deleteExpense_(body));
      case 'widget': return json_(widget_());
      case 'sprites': return json_(readSprites_());
    }
  } catch (err) {
    return json_({ ok: false, error: '서버에서 문제가 생겼다: ' + (err && err.message) });
  }
  return json_({ ok: false, error: '모르는 요청이다.' });
}

// 브라우저 주소창으로 열어도 아무것도 안 보이게 한다.
function doGet() {
  return json_({});
}

/* ---------- 시트 읽기 ---------- */

function book_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return { ss: ss, tz: ss.getSpreadsheetTimeZone() || 'Asia/Seoul' };
}

function today_(tz) {
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

// 날짜 칸은 시트 시간대 기준 글자로 바꾼다 (그냥 두면 UTC로 바뀌어 하루씩 밀릴 수 있다).
function plain_(v, tz, withTime) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz, withTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
  return v;
}

// 설정 탭: A열 항목 → B열 값
function readSettings_(b) {
  var out = {};
  var values = b.ss.getSheetByName(TAB.settings).getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var key = String(values[r][0]).trim();
    if (key) out[key] = plain_(values[r][1], b.tz);
  }
  return out;
}

// 1행 제목을 열 이름으로 써서 2행부터 객체 배열로 읽는다. names: {시트 제목: 객체 키}
function readTab_(b, tab, names) {
  var sheet = b.ss.getSheetByName(tab);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    var obj = { row: r + 1 };
    head.forEach(function (h, c) {
      if (names[h]) obj[names[h]] = plain_(row[c], b.tz, h === '입력시각');
    });
    rows.push(obj);
  }
  return rows;
}

function readExpenses_(b) {
  return readTab_(b, TAB.expenses, {
    id: 'id', 날짜: 'date', 금액: 'amount', 분류: 'category', 수단: 'method',
    메모: 'memo', 출처: 'source', 입력시각: 'enteredAt'
  }).map(function (r) {
    r.id = String(r.id == null ? '' : r.id);
    r.amount = Calc.num(r.amount);
    return r;
  });
}

function list_(text) {
  return String(text == null ? '' : text).split(',').map(function (s) { return s.trim(); }).filter(String);
}

/* ---------- summary ---------- */

/**
 * input: Calc에 넣은 값 그대로(화면이 입력 직후 같은 Calc로 다시 계산한다). 지출은 이번 주기 것만.
 * result: Calc.summary 결과. recent: 최근 지출. 그 밖에 분류·수단 목록, 마지막 대조일.
 */
function summary_(b) {
  var settings = readSettings_(b);
  var expenses = readExpenses_(b);
  var input = {
    settings: settings,
    today: today_(b.tz),
    expenses: expenses,
    vacations: readTab_(b, TAB.vacations, { 시작일: 'start', 끝일: 'end' }),
    incomes: readTab_(b, TAB.incomes, { 날짜: 'date', 금액: 'amount', 종류: 'kind' }),
    subscriptions: readTab_(b, TAB.subscriptions, { 이름: 'name', 금액: 'amount', 결제일: 'payDay', 수단: 'method' }),
    repayments: readTab_(b, TAB.repayments, { 날짜: 'date', 금액: 'amount' })
  };
  var result = Calc.summary(input);

  var recent = expenses.slice().sort(function (x, y) {
    return x.date < y.date ? 1 : x.date > y.date ? -1 : (x.enteredAt < y.enteredAt ? 1 : -1);
  }).slice(0, RECENT_COUNT).map(strip_);

  input.expenses = expenses.filter(function (r) {
    return r.date >= result.cycleStart && r.date <= result.cycleEnd;
  }).map(strip_);

  return {
    ok: true,
    updatedAt: Utilities.formatDate(new Date(), b.tz, "yyyy-MM-dd'T'HH:mm:ss"),
    timeZone: b.tz,
    input: input,
    result: result,
    recent: recent,
    categories: list_(settings.분류),
    methods: list_(settings.수단),
    defaultMethod: String(settings.기본수단 || ''),
    lastReconciled: String(settings.마지막대조일 || '')
  };
}

function strip_(r) {
  return { id: r.id, date: r.date, amount: r.amount, category: r.category, method: r.method, memo: r.memo || '', source: r.source || '' };
}

/* ---------- 지출 쓰기 ---------- */

function checkExpense_(body, settings, tz) {
  var id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return { error: '기록 번호가 이상하다.' };
  var amount = Number(body.amount);
  if (!(amount > 0 && amount <= MAX_AMOUNT && Math.round(amount) === amount)) return { error: '금액은 1원 이상 정수로.' };
  var category = String(body.category || '').trim();
  if (list_(settings.분류).indexOf(category) < 0) return { error: '목록에 없는 분류다: ' + category };
  var method = String(body.method || '').trim();
  if (list_(settings.수단).indexOf(method) < 0) return { error: '목록에 없는 결제 수단이다: ' + method };
  var date = String(body.date || today_(tz));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '날짜가 이상하다.' };
  var memo = String(body.memo || '').trim().slice(0, 100);
  return { id: id, amount: amount, category: category, method: method, date: date, memo: memo };
}

function addExpense_(body) {
  var b = book_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var duplicate = false;
  try {
    var e = checkExpense_(body, readSettings_(b), b.tz);
    if (e.error) return { ok: false, error: e.error };
    var sheet = b.ss.getSheetByName(TAB.expenses);
    duplicate = findRow_(sheet, e.id) > 0;
    if (!duplicate) {
      sheet.appendRow([
        e.id, Utilities.parseDate(e.date, b.tz, 'yyyy-MM-dd'), e.amount, e.category, e.method,
        e.memo, '앱', new Date()
      ]);
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
  var out = summary_(b);
  out.duplicate = duplicate;
  return out;
}

function deleteExpense_(body) {
  var b = book_();
  var id = String(body.id || '');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var found = false;
  try {
    var sheet = b.ss.getSheetByName(TAB.expenses);
    var row = id ? findRow_(sheet, id) : -1;
    if (row > 0) {
      sheet.deleteRow(row);
      SpreadsheetApp.flush();
      found = true;
    }
  } finally {
    lock.releaseLock();
  }
  var out = summary_(b);
  out.deleted = found;
  return out;
}

// A열(id)에서 같은 값이 있는 행 번호. 없으면 -1.
function findRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

/* ---------- 위젯 ---------- */

function widget_() {
  var s = summary_(book_());
  var now = new Date();
  return {
    ok: true,
    available: s.result.available,
    monthLeft: s.result.monthLeft,
    date: s.input.today,
    at: Utilities.formatDate(now, s.timeZone, 'HH:mm')
  };
}

/* ---------- 마스코트 ---------- */

/**
 * 드라이브 폴더 안의 이미지를 data URI로 돌려준다. 파일명에서 확장자를 뺀 이름이 키.
 * 예: normal.png → "normal"
 */
var SPRITE_FOLDER_NAME = '대시보드 스프라이트';

function readSprites_() {
  // 스크립트 속성에 폴더 ID가 없으면 드라이브에서 이름으로 찾는다
  var folderId = PropertiesService.getScriptProperties().getProperty('SPRITE_FOLDER_ID');
  var folder = null;
  if (folderId) folder = DriveApp.getFolderById(folderId);
  else {
    var found = DriveApp.getFoldersByName(SPRITE_FOLDER_NAME);
    if (found.hasNext()) folder = found.next();
  }
  if (!folder) return { sprites: {} };
  var sprites = {};
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var type = file.getMimeType();
    if (type.indexOf('image/') !== 0) continue;
    var key = file.getName().replace(/\.[^.]+$/, '');
    sprites[key] = 'data:' + type + ';base64,' + Utilities.base64Encode(file.getBlob().getBytes());
  }
  return { sprites: sprites };
}

/* ---------- 토큰 ---------- */

// 글자를 하나씩 끝까지 비교한다 (응답 시간으로 토큰을 추측하기 어렵게).
function isValidToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected || typeof token !== 'string' || token.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 설치할 때 한 번만 실행한다. 편집기 위쪽 함수 목록에서 setupToken을 고르고 "실행".
 * 무작위 토큰을 만들어 스크립트 속성에 저장하고 실행 로그에 보여 준다.
 * 이미 토큰이 있으면 덮어쓰지 않는다(기기마다 다시 입력하지 않게). 바꾸려면 resetToken.
 */
function setupToken() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  Logger.log('토큰: ' + token);
}

// 토큰이 새어 나갔을 때만 실행한다. 모든 기기에서 새 토큰을 다시 입력해야 한다.
function resetToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  setupToken();
}
