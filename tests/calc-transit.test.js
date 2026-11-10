// tasks/plan.md 3.2 교통 차감, 3.3 월 상환 가능액, 3.4 예산을 다시 정하는 시점
const { test } = require('node:test');
const assert = require('node:assert');
const Calc = require('../apps-script/Calc.js');

// 금액은 전부 예시 숫자다(실제 값과 무관).
const BASE = {
  월수입: 400000,
  등교일예산: 5000,
  쉬는날예산: 0,
  주기시작일: 1,
  등교요일: '월,화,수,목',
  등교일당교통비: 10000,
  빚원금: 300000
};
const SUBS = [{ amount: 100000 }, { amount: 20000 }];

function summary(over, today, extra) {
  return Calc.summary(Object.assign({
    settings: Object.assign({}, BASE, over),
    today: today,
    expenses: [],
    vacations: [],
    subscriptions: SUBS,
    repayments: [],
    incomes: []
  }, extra || {}));
}

/* ---------- 3.2 교통 차감 ---------- */

test('교통대조일이 비어 있으면 주기 전체가 예상치', () => {
  const r = summary({}, '2026-11-10', {
    expenses: [{ date: '2026-11-02', amount: 9999, category: '교통' }]
  });
  assert.strictEqual(r.transitActual, 0);
  assert.strictEqual(r.transitForecast, 17 * 10000);
  assert.strictEqual(r.transit, 170000);
});

test('교통대조일이 주기 시작보다 앞이면 전부 예상치', () => {
  const r = summary({ 교통대조일: '2026-10-31' }, '2026-11-10', {
    expenses: [{ date: '2026-10-30', amount: 5000, category: '교통' }]
  });
  assert.strictEqual(r.transitActual, 0);
  assert.strictEqual(r.transit, 170000);
});

test('교통대조일이 주기 중간이면 그날까지 실제, 다음 날부터 예상', () => {
  const r = summary({ 교통대조일: '2026-11-10' }, '2026-11-12', {
    expenses: [
      { date: '2026-11-03', amount: 12000, category: '교통' },
      { date: '2026-11-09', amount: 11000, category: '교통' },
      { date: '2026-11-11', amount: 99999, category: '교통' }, // 대조일 뒤: 예상치가 대신한다
      { date: '2026-11-03', amount: 4000, category: '식비' }
    ]
  });
  assert.strictEqual(r.transitActual, 23000);
  // 11/11~30 등교일: 11, 12, 16~19, 23~26, 30 = 11일
  assert.strictEqual(r.transitForecast, 110000);
  assert.strictEqual(r.transit, 133000);
});

test('교통대조일이 주기 끝이거나 그 뒤면 전부 실제', () => {
  const expenses = [
    { date: '2026-11-03', amount: 50000, category: '교통' },
    { date: '2026-12-02', amount: 7000, category: '교통' } // 다음 주기
  ];
  const atEnd = summary({ 교통대조일: '2026-11-30' }, '2026-11-30', { expenses: expenses });
  assert.strictEqual(atEnd.transitForecast, 0);
  assert.strictEqual(atEnd.transit, 50000);
  const after = summary({ 교통대조일: '2026-12-03' }, '2026-11-30', { expenses: expenses });
  assert.strictEqual(after.transit, 50000);
});

test('방학에 걸친 주기는 등교일만큼만 교통을 예상한다', () => {
  const r = summary({}, '2026-11-10', { vacations: [{ start: '2026-11-16', end: '2026-11-30' }] });
  assert.strictEqual(r.transitForecast, 8 * 10000);
});

/* ---------- 3.3 월 상환 가능액, 남은 빚 ---------- */

test('월 상환 가능액 = 월수입 − 구독 − 교통 차감 − 기본 주기 예산', () => {
  const r = summary({}, '2026-11-10');
  assert.strictEqual(r.subscriptions, 120000);
  assert.strictEqual(r.repayable, 400000 - 120000 - 170000 - 85000);
  assert.strictEqual(r.overIncome, false);
});

test('예산이 수입을 넘으면 상환 가능액이 음수이고 경고한다', () => {
  const r = summary({ 등교일예산: 10000 }, '2026-11-10');
  assert.strictEqual(r.repayable, -60000);
  assert.strictEqual(r.overIncome, true);
});

test('교통을 덜 쓰면 그 차이는 상환 가능액으로 가고 등교일 예산은 그대로', () => {
  const forecast = summary({}, '2026-11-30');
  const actual = summary({ 교통대조일: '2026-11-30' }, '2026-11-30', {
    expenses: [{ date: '2026-11-03', amount: 150000, category: '교통' }]
  });
  assert.strictEqual(actual.repayable - forecast.repayable, 20000);
  assert.strictEqual(actual.available, forecast.available);
});

test('남은 빚 = 빚원금 − 상환 합계', () => {
  const r = summary({}, '2026-11-10', { repayments: [{ amount: 50000 }, { amount: '20,000' }] });
  assert.strictEqual(r.repaid, 70000);
  assert.strictEqual(r.debtLeft, 230000);
});

/* ---------- 3.4 예산을 다시 정하는 시점 ---------- */

test('기록시작일이 없으면 기록 며칠째도 없고 알림도 없다', () => {
  const r = summary({}, '2026-11-10');
  assert.strictEqual(r.recordDay, null);
  assert.strictEqual(r.needRebudget, false);
});

test('기록 14일째까지는 알리지 않고 15일째(14일이 지난 날)부터 알린다', () => {
  const day14 = summary({ 기록시작일: '2026-11-10' }, '2026-11-23');
  assert.strictEqual(day14.recordDay, 14);
  assert.strictEqual(day14.needRebudget, false);
  const day15 = summary({ 기록시작일: '2026-11-10' }, '2026-11-24');
  assert.strictEqual(day15.recordDay, 15);
  assert.strictEqual(day15.needRebudget, true);
});

test('예산확정일을 적으면 알림이 사라진다', () => {
  const r = summary({ 기록시작일: '2026-11-10', 예산확정일: '2026-11-25' }, '2026-11-26');
  assert.strictEqual(r.needRebudget, false);
});

test('summary는 3.1의 값도 같이 돌려준다', () => {
  const r = summary({}, '2026-11-02', { expenses: [{ date: '2026-11-02', amount: 1000, category: '식비' }] });
  assert.strictEqual(r.available, 4000);
  assert.strictEqual(r.cycleBudget, 85000);
});
