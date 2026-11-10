/**
 * 돈 계산 (tasks/plan.md 3절). 순수 함수만 둔다: 시트도, 시계도, 화면도 건드리지 않는다.
 * 같은 파일을 Apps Script(서버), 브라우저(<script>), Node(테스트)가 그대로 읽는다.
 *
 * 날짜는 전부 'YYYY-MM-DD' 글자로 주고받는다('YYYY-MM-DDTHH:mm:ss'면 앞 10자만 본다).
 * 안에서는 1970-01-01부터 센 "날 번호"로 바꿔 계산한다(시간대 때문에 하루 밀리는 일이 없게).
 * 설정은 시트 `설정` 탭의 항목 이름 그대로 받는다(예: settings.등교일예산).
 */
var Calc = (function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;
  var WEEKDAY_NAMES = '일월화수목금토';
  var TRANSIT = '교통';

  /* ---------- 날짜 ---------- */

  function toDay(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ''));
    if (!m) return NaN;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }

  function fromDay(day) {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
  }

  function parts(day) {
    var d = new Date(day * DAY_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() };
  }

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  }

  // 그달의 startDay일. 그달에 그런 날이 없으면(31일 등) 마지막 날.
  function dayOfMonth(y, m, startDay) {
    var yy = y + Math.floor(m / 12);
    var mm = ((m % 12) + 12) % 12;
    var d = Math.min(startDay, daysInMonth(yy, mm));
    return Math.round(Date.UTC(yy, mm, d) / DAY_MS);
  }

  // 오늘이 든 주기의 [시작, 끝] (끝 포함)
  function cycleOf(today, startDay) {
    var p = parts(today);
    var start = dayOfMonth(p.y, p.m, startDay);
    if (start > today) start = dayOfMonth(p.y, p.m - 1, startDay);
    var sp = parts(start);
    var next = dayOfMonth(sp.y, sp.m + 1, startDay);
    return { start: start, end: next - 1 };
  }

  /* ---------- 등교일 ---------- */

  // '월,화,수,목' → {1:true, 2:true, ...}. '매일'이면 전부.
  function parseWeekdays(text) {
    var out = {};
    var s = String(text == null ? '' : text);
    if (s.indexOf('매일') >= 0) s = WEEKDAY_NAMES;
    for (var i = 0; i < s.length; i++) {
      var w = WEEKDAY_NAMES.indexOf(s.charAt(i));
      if (w >= 0) out[w] = true;
    }
    return out;
  }

  function parseVacations(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      var a = toDay(r.start);
      var b = toDay(r.end);
      if (!isNaN(a) && !isNaN(b)) out.push([Math.min(a, b), Math.max(a, b)]);
    });
    return out;
  }

  function makeCalendar(settings, vacationRows) {
    var weekdays = parseWeekdays(settings.등교요일);
    var vacations = parseVacations(vacationRows);
    return function isSchoolDay(day) {
      if (!weekdays[parts(day).w]) return false;
      for (var i = 0; i < vacations.length; i++) {
        if (day >= vacations[i][0] && day <= vacations[i][1]) return false;
      }
      return true;
    };
  }

  // from~to(둘 다 포함) 사이의 등교일 수와 쉬는 날 수
  function countDays(isSchoolDay, from, to) {
    var school = 0;
    var rest = 0;
    for (var d = from; d <= to; d++) {
      if (isSchoolDay(d)) school++;
      else rest++;
    }
    return { school: school, rest: rest };
  }

  /* ---------- 숫자 ---------- */

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function sumIn(rows, from, to, keep) {
    var total = 0;
    (rows || []).forEach(function (r) {
      var d = toDay(r.date);
      if (isNaN(d) || d < from || d > to) return;
      if (keep && !keep(r)) return;
      total += num(r.amount);
    });
    return total;
  }

  function isBudgetExpense(r) {
    return String(r.category || '').trim() !== TRANSIT;
  }

  /* ---------- 3.1 오늘까지 쓸 수 있는 돈 ---------- */

  /**
   * input: { settings, expenses: [{date, amount, category}], vacations: [{start, end}], today }
   */
  function budget(input) {
    var s = input.settings || {};
    var today = toDay(input.today);
    var startDay = Math.max(1, Math.min(31, Math.round(num(s.주기시작일)) || 1));
    var cycle = cycleOf(today, startDay);
    var isSchoolDay = makeCalendar(s, input.vacations);

    var perSchool = num(s.등교일예산);
    var perRest = num(s.쉬는날예산);
    var inCycle = countDays(isSchoolDay, cycle.start, cycle.end);
    var toDate = countDays(isSchoolDay, cycle.start, today);

    var baseCycleBudget = perSchool * inCycle.school + perRest * inCycle.rest;
    var earned = perSchool * toDate.school + perRest * toDate.rest;
    var spent = sumIn(input.expenses, cycle.start, cycle.end, isBudgetExpense);

    return {
      today: fromDay(today),
      cycleStart: fromDay(cycle.start),
      cycleEnd: fromDay(cycle.end),
      cycleDays: cycle.end - cycle.start + 1,
      cycleSchoolDays: inCycle.school,
      cycleRestDays: inCycle.rest,
      schoolDaysToDate: toDate.school,
      restDaysToDate: toDate.rest,
      isSchoolDay: isSchoolDay(today),
      perSchoolDay: perSchool,
      perRestDay: perRest,
      baseCycleBudget: baseCycleBudget,
      cycleBudget: baseCycleBudget,
      spent: spent,
      available: earned - spent,
      monthLeft: baseCycleBudget - spent
    };
  }

  /* ---------- 3.2~3.4 교통 차감, 월 상환 가능액, 남은 빚, 기록 며칠째 ---------- */

  /**
   * input: budget의 입력 + { subscriptions: [{amount}], repayments: [{amount}], incomes: [{date, amount, kind}] }
   * budget의 결과에 교통·상환·기록 값을 더해 돌려준다.
   */
  function summary(input) {
    var s = input.settings || {};
    var b = budget(input);
    var today = toDay(input.today);
    var start = toDay(b.cycleStart);
    var end = toDay(b.cycleEnd);
    var isSchoolDay = makeCalendar(s, input.vacations);

    // 3.2 교통대조일까지는 실제 교통 지출, 다음 날부터 주기 끝까지는 등교일 × 등교일당교통비
    var checked = toDay(s.교통대조일);
    var actualUntil = isNaN(checked) ? start - 1 : Math.min(checked, end);
    var transitActual = actualUntil >= start
      ? sumIn(input.expenses, start, actualUntil, function (r) { return !isBudgetExpense(r); })
      : 0;
    var forecastFrom = Math.max(actualUntil + 1, start);
    var transitForecast = forecastFrom <= end
      ? num(s.등교일당교통비) * countDays(isSchoolDay, forecastFrom, end).school
      : 0;
    var transit = transitActual + transitForecast;

    // 3.3
    var subscriptions = 0;
    (input.subscriptions || []).forEach(function (r) { subscriptions += num(r.amount); });
    var repayable = num(s.월수입) - subscriptions - transit - b.baseCycleBudget;
    var repaid = 0;
    (input.repayments || []).forEach(function (r) { repaid += num(r.amount); });

    // 3.4 기록시작일부터 14일이 지나면(15일째부터) 예산을 다시 정할 때
    var recordStart = toDay(s.기록시작일);
    var confirmed = toDay(s.예산확정일);
    var recordDay = isNaN(recordStart) ? null : today - recordStart + 1;
    var needRebudget = recordDay !== null && recordDay >= 15 && !(confirmed >= recordStart);

    b.transitActual = transitActual;
    b.transitForecast = transitForecast;
    b.transit = transit;
    b.transitCheckedUntil = isNaN(checked) ? '' : fromDay(checked);
    b.subscriptions = subscriptions;
    b.monthlyIncome = num(s.월수입);
    b.repayable = repayable;
    b.overIncome = repayable < 0;
    b.debtPrincipal = num(s.빚원금);
    b.repaid = repaid;
    b.debtLeft = num(s.빚원금) - repaid;
    b.recordDay = recordDay;
    b.needRebudget = needRebudget;
    return b;
  }

  return {
    budget: budget,
    summary: summary,
    // 아래는 다른 계산과 화면이 같이 쓰는 도구
    toDay: toDay,
    fromDay: fromDay,
    num: num
  };
})();

if (typeof module !== 'undefined') module.exports = Calc;
