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
// 2) hands: 패 → 최고 수순. 후보 목록을 한 번만 만드는 방식(기본)과 루트마다 새로 만드는 방식(shared=false)을 둘 다 돌린다
fx('hands').forEach((h, i) => {
  let t = Date.now();
  const r = calc.solveHand(h.hand_modeled);
  const ms = Date.now() - t;
  t = Date.now();
  const r0 = calc.solveHand(h.hand_modeled, null, undefined, false);
  const ms0 = Date.now() - t;
  const g = { score: r.best.score, route: r.best.route, mons: r.best.state.field.map((m) => m.name) };
  const g0 = { score: r0.best.score, route: r0.best.route, mons: r0.best.state.field.map((m) => m.name) };
  const same = JSON.stringify(g) === JSON.stringify(g0) && JSON.stringify(r.best.done) === JSON.stringify(r0.best.done);
  out.hands.push({ i, hand: h.hand_modeled, ok: close(g.score, h.expected_score), expected: { score: h.expected_score, route: h.expected_base_route, mons: h.expected_final_monsters }, got: g, ms, perRoute: { ok: close(g0.score, h.expected_score), sameAsShared: same, got: g0, ms: ms0 } });
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

// 4) 동점 규칙을 고정한 Python(tests/fixtures/python-pinned.patch)의 결과와 비교: 점수·최종 몬스터·고른 수순까지
const pinPath = path.join(__dirname, 'fixtures', 'python-pinned.json');
if (fs.existsSync(pinPath)) {
  const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  out.pinned = { routes: [], hands: [], handtraps: [] };
  out.routes.forEach((r) => { const p = pin.routes[r.id]; out.pinned.routes.push({ id: r.id, ok: close(r.got.score, p.score) && eq(r.got.mons, p.mons) && r.got.zones === p.zones }); });
  out.hands.forEach((h, i) => {
    const p = pin.hands[i], r = calc.solveHand(h.hand);
    out.pinned.hands.push({ i, ok: close(h.got.score, p.score) && eq(h.got.mons, p.mons) && h.got.route === p.route, steps: eq(r.best.done.map((x) => x[2]), p.steps), py: p, got: h.got });
  });
  out.handtraps.forEach((h, i) => {
    const p = pin.handtraps[i];
    out.pinned.handtraps.push({ i, route: h.route, step: h.step, trap: h.trap, ok: close(h.got.score, p.score) && (p.counter === null || p.counter === undefined || close(h.got.counter, p.counter)) && eq(h.got.mons, p.mons), py: p, got: h.got });
  });
}
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
const pr = out.hands.map((x) => x.perRoute);
console.log(`hands(루트마다 새로): ${pr.filter((x) => x.ok).length}/${pr.length} 일치, 공유 방식과 수순까지 같음 ${pr.filter((x) => x.sameAsShared).length}/${pr.length} (평균 ${Math.round(pr.reduce((a, x) => a + x.ms, 0) / pr.length)} ms, 최대 ${Math.max(...pr.map((x) => x.ms))} ms)`);
if (out.pinned) for (const k of ['routes', 'hands', 'handtraps']) {
  const a = out.pinned[k], bad = a.filter((x) => !x.ok);
  console.log(`고정판 Python ${k}: ${a.length - bad.length}/${a.length} 일치` + (k === 'hands' ? ` (고른 수순까지 같음 ${a.filter((x) => x.steps).length}/${a.length})` : ''));
  bad.forEach((x) => console.log('  다름', JSON.stringify({ i: x.i ?? x.id, route: x.route, step: x.step, trap: x.trap, py: x.py, js: x.got })));
}
process.exit(0);
