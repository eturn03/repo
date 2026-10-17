// JS 계산기(assets/calc/engine.js)를 Python 계산기 fixtures와 비교한다.
// 실행: node tests/calc_fixtures.cjs        (결과: tests/calc-fixtures-result.json, 화면 요약)
// 점수는 ±0.01 안이면 같다고 본다.
const path = require('path');
const fs = require('fs');
const F = require('../assets/calc/engine.js');
const D = require('../data/dd-data.json');

const ROOT = path.resolve(__dirname, '..');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n + '.json'), 'utf8'));
const routes = D.routes.map((r) => ({ id: r.id, title: r.name, steps: r.steps.map((s) => s.text) }));
const t0 = Date.now();
const calc = F(routes);
const initMs = Date.now() - t0;
const close = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 0.01 + 1e-9;
const out = { initMs, routes: [], hands: [], handtraps: [] };

// 1) routes: 시작 패로 루트를 그대로 돌린 최종 상태
for (const [rid, e] of Object.entries(fx('routes'))) {
  const st = calc.PREFIX[rid][calc.PREFIX[rid].length - 1];
  const g = { score: calc.score(st), mons: st.field.map((m) => m.name), zones: st.zones.size };
  const ok = close(g.score, e.score) && JSON.stringify(g.mons) === JSON.stringify(e.final_monsters) && g.zones === e.zone_configs_possible;
  out.routes.push({ id: rid, ok, expected: { score: e.score, mons: e.final_monsters, zones: e.zone_configs_possible }, got: g });
}
// 2) hands: 패 → 최고 수순
fx('hands').forEach((h, i) => {
  const t = Date.now();
  const r = calc.solveHand(h.hand_modeled);
  const ms = Date.now() - t;
  const g = { score: r.best.score, route: r.best.route, mons: r.best.state.field.map((m) => m.name) };
  out.hands.push({ i, hand: h.hand_modeled, ok: close(g.score, h.expected_score), expected: { score: h.expected_score, route: h.expected_base_route, mons: h.expected_final_monsters }, got: g, ms });
});
// 3) handtraps: 패트랩 레코드
fx('handtraps').forEach((r, i) => {
  const t = Date.now();
  const res = calc.simulate(r.route, r.step, r.trap);
  const ms = Date.now() - t;
  const sc = res && res.response ? res.response.score : null;
  const cs = res && res.counter ? res.counter.response.score : null;
  const ok = close(sc, r.expected_score) && (r.counter_score === null || r.counter_score === undefined || close(cs, r.counter_score));
  out.handtraps.push({ i, route: r.route, step: r.step, trap: r.trap, ok, expected: { score: r.expected_score, counter: r.counter_score }, got: { score: sc, counter: cs, mons: res && res.response ? res.response.final.monsters : null }, ms });
});

fs.writeFileSync(path.join(__dirname, 'calc-fixtures-result.json'), JSON.stringify(out, null, 1));
const sum = (k) => { const a = out[k]; const bad = a.filter((x) => !x.ok); return { n: a.length, bad: bad.length, list: bad }; };
const maxMs = (k) => Math.max(...out[k].map((x) => x.ms || 0));
const avgMs = (k) => Math.round(out[k].reduce((a, x) => a + (x.ms || 0), 0) / out[k].length);
console.log(`init ${initMs} ms`);
for (const k of ['routes', 'hands', 'handtraps']) {
  const s = sum(k);
  console.log(`${k}: ${s.n - s.bad}/${s.n} 일치` + (k !== 'routes' ? ` (평균 ${avgMs(k)} ms, 최대 ${maxMs(k)} ms)` : ''));
  s.list.forEach((x) => console.log('  다름', JSON.stringify({ id: x.id ?? x.i, route: x.route, step: x.step, trap: x.trap, hand: x.hand, expected: x.expected, got: x.got })));
}
process.exit(0);
