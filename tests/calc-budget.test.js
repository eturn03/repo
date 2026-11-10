// tasks/plan.md 3.1: 주기와 오늘까지 쓸 수 있는 돈 (등교일 예산 이월)
const { test } = require('node:test');
const assert = require('node:assert');
const Calc = require('../apps-script/Calc.js');

// 금액은 전부 예시 숫자다(실제 값과 무관).
const MON_THU = { 등교일예산: 5000, 쉬는날예산: 0, 주기시작일: 1, 등교요일: '월,화,수,목' };

function budget(settings, today, expenses, vacations) {
  return Calc.budget({ settings: settings, today: today, expenses: expenses || [], vacations: vacations || [] });
}

/* ---------- 3.1 검증 예시 1: 월~목, 등교일예산 5,000 ---------- */

test('예시1: 월요일에 아무것도 안 쓰면 5,000원', () => {
  assert.strictEqual(budget(MON_THU, '2026-11-02').available, 5000);
});

test('예시1: 월요일에 5,000원을 쓰면 0원', () => {
  const spent = [{ date: '2026-11-02', amount: 5000, category: '식비' }];
  assert.strictEqual(budget(MON_THU, '2026-11-02', spent).available, 0);
});

test('예시1: 월요일에 5,000원을 썼으면 화요일에 다시 5,000원', () => {
  const spent = [{ date: '2026-11-02', amount: 5000, category: '식비' }];
  assert.strictEqual(budget(MON_THU, '2026-11-03', spent).available, 5000);
});

test('예시1: 월요일에 3,000원만 쓰면 화요일은 7,000원', () => {
  const spent = [{ date: '2026-11-02', amount: 3000, category: '식비' }];
  assert.strictEqual(budget(MON_THU, '2026-11-03', spent).available, 7000);
});

test('쉬는 날(금·토·일)에는 숫자가 목요일과 같다', () => {
  const spent = [{ date: '2026-11-03', amount: 2000, category: '식비' }];
  const thu = budget(MON_THU, '2026-11-05', spent).available;
  assert.strictEqual(thu, 18000);
  assert.strictEqual(budget(MON_THU, '2026-11-06', spent).available, thu);
  assert.strictEqual(budget(MON_THU, '2026-11-07', spent).available, thu);
  assert.strictEqual(budget(MON_THU, '2026-11-08', spent).available, thu);
});

test('주기 첫날이 일요일이면 그날은 0원', () => {
  assert.strictEqual(budget(MON_THU, '2026-11-01').available, 0);
});

/* ---------- 3.1 검증 예시 2: 매일, 1,000원 ---------- */

const EVERY_DAY = { 등교일예산: 1000, 쉬는날예산: 0, 주기시작일: 1, 등교요일: '월,화,수,목,금,토,일' };

test('예시2: 매일 1,000원이면 1일 1,000원, 2일 2,000원', () => {
  assert.strictEqual(budget(EVERY_DAY, '2026-11-01').available, 1000);
  assert.strictEqual(budget(EVERY_DAY, '2026-11-02').available, 2000);
});

test('예시2: 2일에 1,500원을 쓰면 3일은 1,500원', () => {
  const spent = [{ date: '2026-11-02', amount: 1500, category: '간식·카페' }];
  assert.strictEqual(budget(EVERY_DAY, '2026-11-03', spent).available, 1500);
});

test('등교요일에 "매일"이라고 써도 된다', () => {
  const s = Object.assign({}, EVERY_DAY, { 등교요일: '매일' });
  assert.strictEqual(budget(s, '2026-11-02').available, 2000);
});

/* ---------- 주기 길이와 주기 시작일 ---------- */

test('30일 주기(2026년 11월): 등교일 17일, 쉬는 날 13일', () => {
  const r = budget(MON_THU, '2026-11-10');
  assert.strictEqual(r.cycleStart, '2026-11-01');
  assert.strictEqual(r.cycleEnd, '2026-11-30');
  assert.strictEqual(r.cycleDays, 30);
  assert.strictEqual(r.cycleSchoolDays, 17);
  assert.strictEqual(r.cycleRestDays, 13);
  assert.strictEqual(r.cycleBudget, 85000);
});

test('31일 주기(2026년 12월): 등교일 19일', () => {
  const r = budget(MON_THU, '2026-12-15');
  assert.strictEqual(r.cycleStart, '2026-12-01');
  assert.strictEqual(r.cycleEnd, '2026-12-31');
  assert.strictEqual(r.cycleDays, 31);
  assert.strictEqual(r.cycleSchoolDays, 19);
});

test('28일 주기(2027년 2월): 등교일 16일', () => {
  const r = budget(MON_THU, '2027-02-10');
  assert.strictEqual(r.cycleStart, '2027-02-01');
  assert.strictEqual(r.cycleEnd, '2027-02-28');
  assert.strictEqual(r.cycleDays, 28);
  assert.strictEqual(r.cycleSchoolDays, 16);
});

test('주기시작일이 25면 10월 25일 ~ 11월 24일이 한 주기', () => {
  const s = Object.assign({}, MON_THU, { 주기시작일: 25 });
  const r = budget(s, '2026-11-10');
  assert.strictEqual(r.cycleStart, '2026-10-25');
  assert.strictEqual(r.cycleEnd, '2026-11-24');
  // 10/26~29(4) + 11/2~5(4) + 11/9~10(2) = 10일
  assert.strictEqual(r.schoolDaysToDate, 10);
  assert.strictEqual(r.available, 50000);
});

test('주기시작일이 그달에 없는 날(31)이면 그달 마지막 날부터', () => {
  const s = Object.assign({}, MON_THU, { 주기시작일: 31 });
  const r = budget(s, '2027-02-15');
  assert.strictEqual(r.cycleStart, '2027-01-31');
  assert.strictEqual(r.cycleEnd, '2027-02-27');
});

test('지난 주기의 지출은 이번 주기에 안 들어간다', () => {
  const spent = [
    { date: '2026-10-31', amount: 9000, category: '식비' },
    { date: '2026-12-01', amount: 9000, category: '식비' }
  ];
  const r = budget(MON_THU, '2026-11-02', spent);
  assert.strictEqual(r.spent, 0);
  assert.strictEqual(r.available, 5000);
});

/* ---------- 지출 ---------- */

test('지출이 0건이면 이번 달 남은 돈 = 주기 예산', () => {
  const r = budget(MON_THU, '2026-11-10');
  assert.strictEqual(r.spent, 0);
  assert.strictEqual(r.monthLeft, r.cycleBudget);
});

test('많이 쓰면 오늘까지 쓸 돈과 이번 달 남은 돈이 음수가 된다', () => {
  const spent = [{ date: '2026-11-02', amount: 100000, category: '사치' }];
  const r = budget(MON_THU, '2026-11-02', spent);
  assert.strictEqual(r.available, -95000);
  assert.strictEqual(r.monthLeft, -15000);
});

test('교통 분류는 예산 지출에서 빠진다', () => {
  const spent = [
    { date: '2026-11-02', amount: 9900, category: '교통' },
    { date: '2026-11-02', amount: 2000, category: '식비' }
  ];
  const r = budget(MON_THU, '2026-11-02', spent);
  assert.strictEqual(r.spent, 2000);
  assert.strictEqual(r.available, 3000);
});

test('금액이 글자로 와도 숫자로 읽는다', () => {
  const spent = [{ date: '2026-11-02', amount: '2,000', category: '식비' }];
  assert.strictEqual(budget(MON_THU, '2026-11-02', spent).available, 3000);
});

/* ---------- 방학과 쉬는날예산 ---------- */

test('방학이 주기 일부를 덮으면 그 기간은 등교일이 아니다', () => {
  const vac = [{ start: '2026-11-16', end: '2026-11-30' }];
  const r = budget(MON_THU, '2026-11-20', [], vac);
  assert.strictEqual(r.cycleSchoolDays, 8);
  assert.strictEqual(r.cycleBudget, 40000);
  assert.strictEqual(r.available, 40000); // 방학 중에는 숫자가 그대로
  assert.strictEqual(r.isSchoolDay, false);
});

test('방학이 주기 전부를 덮고 쉬는날예산이 0이면 예산도 0', () => {
  const vac = [{ start: '2026-10-20', end: '2026-12-05' }];
  const r = budget(MON_THU, '2026-11-20', [], vac);
  assert.strictEqual(r.cycleSchoolDays, 0);
  assert.strictEqual(r.cycleBudget, 0);
  assert.strictEqual(r.available, 0);
});

test('방학이 주기 전부를 덮어도 쉬는날예산이 있으면 날마다 쌓인다', () => {
  const s = Object.assign({}, MON_THU, { 쉬는날예산: 1000 });
  const vac = [{ start: '2026-11-01', end: '2026-11-30' }];
  const r = budget(s, '2026-11-10', [], vac);
  assert.strictEqual(r.cycleBudget, 30000);
  assert.strictEqual(r.available, 10000);
});

test('쉬는날예산이 0보다 크면 쉬는 날에도 그만큼 쌓인다', () => {
  const s = Object.assign({}, MON_THU, { 쉬는날예산: 1000 });
  const r = budget(s, '2026-11-03'); // 일(쉼) 월 화
  assert.strictEqual(r.schoolDaysToDate, 2);
  assert.strictEqual(r.restDaysToDate, 1);
  assert.strictEqual(r.available, 11000);
  assert.strictEqual(r.cycleBudget, 17 * 5000 + 13 * 1000);
});

test('날짜가 시각까지 붙은 글자로 와도 날짜만 본다', () => {
  const spent = [{ date: '2026-11-02T00:00:00', amount: 1000, category: '식비' }];
  assert.strictEqual(budget(MON_THU, '2026-11-02T13:45:00', spent).available, 4000);
});
