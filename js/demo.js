// 예시 모드(?demo) 전용 가짜 서버. 숫자는 전부 예시이고 실제 값과 무관하다.
// 서버와 같은 모양의 응답을 같은 Calc로 만들어서, 화면 코드가 예시 모드와 실제 모드를 구분하지 않게 한다.
// 변형: ?demo=rebudget(기록 15일째) ?demo=over(예산이 수입을 넘음) ?demo=ghost(이번 달 돈을 다 씀) ?demo=empty(지출 0건)
// 콘솔에서 window.DEMO_OFFLINE = true 로 두면 서버가 끊긴 것처럼 동작한다(대기열 시험용).
window.makeDemoServer = function (variant, todayText) {
  'use strict';

  function shift(days) {
    return Calc.fromDay(Calc.toDay(todayText) + days);
  }

  var settings = {
    월수입: 450000, 등교일예산: 4000, 쉬는날예산: 0, 주기시작일: 1, 등교요일: '월,화,수,목',
    등교일당교통비: 12000, 빚원금: 400000, 비정규쓸돈: 40000,
    분류: '식비,간식·카페,취미·음악,사치,그 밖', 수단: '카드,체크,현금', 기본수단: '카드',
    기록시작일: shift(-5), 예산확정일: '', 마지막대조일: shift(-3), 교통대조일: shift(-3)
  };
  var n = 0;
  function id() { n += 1; return 'demo-' + String(n).padStart(4, '0'); }
  var expenses = [
    { id: id(), date: shift(-3), amount: 3500, category: '식비', method: '카드', memo: '학식', source: '앱' },
    { id: id(), date: shift(-3), amount: 12000, category: '교통', method: '카드', memo: '', source: '대조' },
    { id: id(), date: shift(-2), amount: 2800, category: '간식·카페', method: '체크', memo: '', source: '앱' },
    { id: id(), date: shift(-1), amount: 4200, category: '식비', method: '현금', memo: '', source: '앱' },
    { id: id(), date: shift(0), amount: 1500, category: '간식·카페', method: '카드', memo: '', source: '앱' }
  ];
  var incomes = [{ date: shift(-6), amount: 250000, kind: '비정규' }];
  var subscriptions = [{ name: '구독', amount: 120000 }, { name: '휴대폰', amount: 15000 }];
  var repayments = [{ date: shift(-10), amount: 30000 }];

  if (variant === 'rebudget') settings.기록시작일 = shift(-14);
  if (variant === 'over') settings.등교일예산 = 9000;
  if (variant === 'ghost') expenses.push({ id: id(), date: shift(0), amount: 160000, category: '사치', method: '카드', memo: '', source: '앱' });
  if (variant === 'empty') expenses = [];

  function list(text) {
    return String(text).split(',').map(function (s) { return s.trim(); }).filter(String);
  }

  function summary() {
    var input = {
      settings: settings, today: todayText, expenses: expenses, vacations: [],
      incomes: incomes, subscriptions: subscriptions, repayments: repayments
    };
    var result = Calc.summary(input);
    var recent = expenses.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1); }).slice(0, 8);
    return JSON.parse(JSON.stringify({
      ok: true,
      updatedAt: new Date().toISOString(),
      input: Object.assign({}, input, {
        expenses: expenses.filter(function (r) { return r.date >= result.cycleStart && r.date <= result.cycleEnd; })
      }),
      result: result,
      recent: recent,
      categories: list(settings.분류),
      methods: list(settings.수단),
      defaultMethod: settings.기본수단,
      lastReconciled: settings.마지막대조일
    }));
  }

  function handle(view, body) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (window.DEMO_OFFLINE) { reject(new Error('demo offline')); return; }
        if (view === 'add_expense') {
          if (list(settings.분류).indexOf(body.category) < 0) { resolve({ ok: false, error: '목록에 없는 분류다: ' + body.category }); return; }
          var dup = expenses.some(function (r) { return r.id === body.id; });
          if (!dup) {
            expenses.push({ id: body.id, date: body.date || todayText, amount: Number(body.amount), category: body.category, method: body.method, memo: body.memo || '', source: '앱' });
          }
          resolve(Object.assign(summary(), { duplicate: dup }));
          return;
        }
        if (view === 'delete_expense') {
          var before = expenses.length;
          expenses = expenses.filter(function (r) { return r.id !== body.id; });
          resolve(Object.assign(summary(), { deleted: expenses.length < before }));
          return;
        }
        if (view === 'widget') { var s = summary(); resolve({ ok: true, available: s.result.available }); return; }
        resolve(summary());
      }, 350);
    });
  }

  return { handle: handle };
};
