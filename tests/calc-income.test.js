// tasks/plan.md 3.6 비정규 수입: 정해 둔 금액만 쓸 돈으로 떼어 30일 사이 등교일에 나눈다
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
  빚원금: 300000,
  비정규쓸돈: 30000
};

function summary(today, incomes, extra) {
  return Calc.summary(Object.assign({
    settings: Object.assign({}, BASE),
    today: today,
    expenses: [],
    vacations: [],
    subscriptions: [],
    repayments: [],
    incomes: incomes
  }, extra || {}));
}

// 11/1(일)에 들어온 돈 → 11/2~12/1 사이 등교일: 11월 17일 + 12/1(화) = 18일
const NOV1 = [{ date: '2026-11-01', amount: 200000, kind: '비정규' }];

test('들어온 날에는 아직 안 쌓이고 다음 날부터 쌓인다', () => {
  assert.strictEqual(summary('2026-11-01', NOV1).available, 0);
  // 11/2: 5,000 + floor(30,000 × 1/18)
  assert.strictEqual(summary('2026-11-02', NOV1).available, 5000 + 1666);
});

test('쉬는 날에는 몫도 안 쌓인다', () => {
  const thu = summary('2026-11-05', NOV1).available;
  assert.strictEqual(summary('2026-11-07', NOV1).available, thu);
});

test('나누는 날이 두 주기에 걸치면 각 주기에는 그 주기 몫만 들어간다', () => {
  const nov = summary('2026-11-10', NOV1);
  assert.strictEqual(nov.cycleBudget, 85000 + 28333); // floor(30,000 × 17/18)
  const dec = summary('2026-12-01', NOV1);
  assert.strictEqual(dec.cycleBudget, 19 * 5000 + 1667);
  assert.strictEqual(dec.available, 5000 + 1667);
});

test('마지막 나누는 날에 쓸 돈 몫 전체가 쌓인다', () => {
  const novEnd = summary('2026-11-30', NOV1);
  const dec1 = summary('2026-12-01', NOV1);
  const novShare = novEnd.available - 17 * 5000;
  const decShare = dec1.available - 5000;
  assert.strictEqual(novShare + decShare, 30000);
  assert.strictEqual(dec1.irregular.remaining, 0);
});

test('쓸 돈 몫은 비정규쓸돈까지만, 나머지는 상환 몫', () => {
  const r = summary('2026-11-10', NOV1);
  assert.strictEqual(r.irregular.items[0].share, 30000);
  assert.strictEqual(r.irregular.items[0].repay, 170000);
});

test('금액이 비정규쓸돈보다 작으면 전부 쓸 돈 몫', () => {
  const r = summary('2026-11-10', [{ date: '2026-11-01', amount: 18000, kind: '비정규' }]);
  assert.strictEqual(r.irregular.items[0].share, 18000);
  assert.strictEqual(r.irregular.items[0].repay, 0);
  // 11/2~10 등교일: 2~5, 9~10 = 6일 → floor(18,000 × 6/18)
  assert.strictEqual(r.available, 6 * 5000 + 6000);
});

test('30일 안에 등교일이 없으면(방학) 30일 전체에 날마다 똑같이 나눈다', () => {
  const vac = [{ start: '2026-11-01', end: '2026-12-31' }];
  const r = summary('2026-11-10', NOV1, { vacations: vac });
  assert.strictEqual(r.available, 9000); // floor(30,000 × 9/30)
});

test('종류가 환급·기타인 행은 쓸 돈에 더하지 않는다', () => {
  const refund = summary('2026-11-10', [
    { date: '2026-11-01', amount: 50000, kind: '환급' },
    { date: '2026-11-01', amount: 50000, kind: '기타' }
  ]);
  const none = summary('2026-11-10', []);
  assert.strictEqual(refund.available, none.available);
  assert.strictEqual(refund.cycleBudget, none.cycleBudget);
  assert.strictEqual(refund.irregular.items.length, 0);
});

test('월 상환 가능액은 비정규 수입이 있어도 그대로', () => {
  assert.strictEqual(summary('2026-11-10', NOV1).repayable, summary('2026-11-10', []).repayable);
});

test('쌓이는 중이면 남은 금액과 끝나는 날을 알려 준다', () => {
  const r = summary('2026-11-10', NOV1);
  assert.strictEqual(r.irregular.remaining, 30000 - Math.floor(30000 * 6 / 18));
  assert.strictEqual(r.irregular.endDate, '2026-12-01');
});

test('다 쌓인 수입은 남은 금액 0, 끝나는 날 없음', () => {
  const r = summary('2026-12-20', NOV1);
  assert.strictEqual(r.irregular.remaining, 0);
  assert.strictEqual(r.irregular.endDate, '');
});
