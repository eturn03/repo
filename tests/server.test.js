// apps-script/Code.js를 가짜 시트 위에서 돌려 본다 (배포 전에 실수를 잡는 용도).
// 진짜 확인은 배포한 주소로 한다(tasks/plan.md 7절). 금액은 예시 숫자다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOKEN = 'test-token-0123456789';
const KST = 9 * 60 * 60 * 1000;

function pad(n) { return String(n).padStart(2, '0'); }

// 'yyyy-MM-dd', 'HH:mm', 'yyyy-MM-dd HH:mm:ss', "yyyy-MM-dd'T'HH:mm:ss"만 흉내 낸다 (시간대는 서울 고정)
function formatDate(date, tz, fmt) {
  const d = new Date(date.getTime() + KST);
  const map = {
    yyyy: d.getUTCFullYear(), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds())
  };
  return fmt.replace(/'T'/g, 'T').replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => String(map[k]));
}

function parseDate(text, tz, fmt) {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - KST);
}

function fakeSheet(rows) {
  return {
    rows,
    getDataRange() { return { getValues: () => rows.map((r) => r.slice()) }; },
    getLastRow() { return rows.length; },
    getRange(r, c, nr, nc) {
      return { getValues: () => rows.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)) };
    },
    appendRow(arr) { rows.push(arr.slice()); },
    deleteRow(i) { rows.splice(i - 1, 1); }
  };
}

function load(today) {
  const sheets = {
    설정: fakeSheet([
      ['항목', '값', '설명'],
      ['월수입', 400000, ''], ['등교일예산', 5000, ''], ['쉬는날예산', 0, ''], ['주기시작일', 1, ''],
      ['등교요일', '월,화,수,목', ''], ['등교일당교통비', 10000, ''], ['빚원금', 300000, ''],
      ['비정규쓸돈', 30000, ''], ['분류', '식비,간식·카페,사치,그 밖', ''], ['수단', 'K-패스,현금', ''],
      ['기본수단', 'K-패스', ''], ['마지막대조일', parseDate('2026-11-08'), '']
    ]),
    지출: fakeSheet([
      ['id', '날짜', '금액', '분류', '수단', '메모', '출처', '입력시각'],
      ['old-0001', parseDate('2026-10-30'), 7000, '식비', 'K-패스', '', '대조', ''],
      ['abc-0001', parseDate('2026-11-02'), 3000, '식비', 'K-패스', '', '앱', new Date('2026-11-02T03:00:00Z')],
      ['trn-0001', parseDate('2026-11-02'), 9000, '교통', 'K-패스', '', '대조', '']
    ]),
    고정비: fakeSheet([['이름', '금액', '결제일', '수단', '메모'], ['구독', 100000, '', 'K-패스', '']]),
    상환: fakeSheet([['날짜', '금액', '메모'], [parseDate('2026-11-05'), 20000, '']]),
    수입: fakeSheet([['날짜', '금액', '종류', '메모']]),
    방학: fakeSheet([['시작일', '끝일', '메모']])
  };
  const now = new Date(today + 'T03:00:00Z'); // 서울 정오
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now.getTime()); else super(...a); }
    static now() { return now.getTime(); }
  }
  const ctx = {
    Date: FixedDate,
    JSON, Math, Number, String, Object, Array, isNaN, isFinite, Infinity, NaN,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'Asia/Seoul', getSheetByName: (n) => sheets[n] || null }),
      flush() {}
    },
    Utilities: { formatDate, parseDate, getUuid: () => 'uuid', base64Encode: () => '' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'TOKEN' ? TOKEN : null) }) },
    ContentService: { createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } }
  };
  vm.createContext(ctx);
  for (const f of ['Calc.js', 'Code.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  }
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { post, sheets };
}

test('토큰이 틀리면 빈 응답', () => {
  const { post } = load('2026-11-03');
  assert.deepStrictEqual(post({ token: 'nope', view: 'summary' }), {});
});

test('summary는 Calc와 같은 규칙으로 숫자를 낸다', () => {
  const { post } = load('2026-11-03');
  const s = post({ token: TOKEN, view: 'summary' });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.input.today, '2026-11-03');
  assert.strictEqual(s.result.available, 2 * 5000 - 3000); // 교통·지난 주기 제외
  assert.strictEqual(s.result.debtLeft, 280000);
  assert.strictEqual(s.result.transitActual, 0); // 교통대조일 없음
  assert.deepStrictEqual(s.categories, ['식비', '간식·카페', '사치', '그 밖']);
  assert.deepStrictEqual(s.methods, ['K-패스', '현금']);
  assert.strictEqual(s.defaultMethod, 'K-패스');
  assert.strictEqual(s.lastReconciled, '2026-11-08');
  assert.strictEqual(s.input.expenses.length, 2); // 이번 주기 것만
  assert.strictEqual(s.recent[0].id, 'abc-0001');
});

test('지출을 더하면 지출 탭에 한 줄이 생기고 숫자가 준다', () => {
  const { post, sheets } = load('2026-11-03');
  const s = post({ token: TOKEN, view: 'add_expense', id: 'new-0001', amount: 2500, category: '간식·카페', method: '현금', memo: '테스트' });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.duplicate, false);
  assert.strictEqual(s.result.available, 7000 - 2500);
  const last = sheets.지출.rows[sheets.지출.rows.length - 1];
  assert.strictEqual(last[0], 'new-0001');
  assert.strictEqual(formatDate(last[1], 'Asia/Seoul', 'yyyy-MM-dd'), '2026-11-03');
  assert.strictEqual(last[6], '앱');
});

test('같은 id로 두 번 보내도 한 줄만 기록된다', () => {
  const { post, sheets } = load('2026-11-03');
  const body = { token: TOKEN, view: 'add_expense', id: 'dup-0001', amount: 1000, category: '식비', method: 'K-패스' };
  post(body);
  const again = post(body);
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(sheets.지출.rows.filter((r) => r[0] === 'dup-0001').length, 1);
});

test('목록에 없는 분류·수단, 이상한 금액은 거절한다', () => {
  const { post, sheets } = load('2026-11-03');
  const before = sheets.지출.rows.length;
  const base = { token: TOKEN, view: 'add_expense', id: 'bad-0001', amount: 1000, category: '식비', method: 'K-패스' };
  assert.strictEqual(post(Object.assign({}, base, { category: '교통' })).ok, false);
  assert.strictEqual(post(Object.assign({}, base, { method: '토스' })).ok, false);
  assert.strictEqual(post(Object.assign({}, base, { amount: -5 })).ok, false);
  assert.strictEqual(post(Object.assign({}, base, { amount: 10.5 })).ok, false);
  assert.strictEqual(post(Object.assign({}, base, { id: 'x' })).ok, false);
  assert.strictEqual(sheets.지출.rows.length, before);
});

test('지우면 그 줄이 없어지고, 없는 id는 아무것도 안 지운다', () => {
  const { post, sheets } = load('2026-11-03');
  const before = sheets.지출.rows.length;
  const s = post({ token: TOKEN, view: 'delete_expense', id: 'abc-0001' });
  assert.strictEqual(s.deleted, true);
  assert.strictEqual(sheets.지출.rows.length, before - 1);
  assert.strictEqual(s.result.available, 10000);
  const none = post({ token: TOKEN, view: 'delete_expense', id: 'zzz-9999' });
  assert.strictEqual(none.deleted, false);
  assert.strictEqual(sheets.지출.rows.length, before - 1);
});

test('widget은 오늘까지 쓸 돈과 기준 시각을 준다', () => {
  const { post } = load('2026-11-03');
  const w = post({ token: TOKEN, view: 'widget' });
  assert.strictEqual(w.available, 7000);
  assert.strictEqual(w.at, '12:00');
  assert.strictEqual(w.date, '2026-11-03');
});
