// 무작위 패 300개(+스몰 월드 포함 패 300개): 추천 1순위 수순(사이트와 같은 고르는 순서)이 덱에 남은 장수보다 많이 꺼내는지 검사.
// 덱에 남은 장수 = deck_counts - 바꾼 패 - 스몰 월드 bridge·reveal(또는 다크 오컬티즘으로 버린 카드). 실행: node tests/deck_pulls_check.cjs
const { top } = require('./site_pick.cjs');
const SW = require((process.env.SITE_ROOT || require('path').resolve(__dirname, '..') + '/') + 'data/dd-smallworld.json');
const DECK = SW._about.deck_40;
const PLD = require((process.env.SITE_ROOT || require('path').resolve(__dirname, '..') + '/') + 'data/dd-planlib.json')._about.deck_counts;
let seed = 20261018;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pool = Object.entries(DECK).flatMap(([k, v]) => Array(v).fill(k));
function hand(n, must) {
  const p = pool.slice(), h = [];
  if (must) { p.splice(p.indexOf(must), 1); h.push(must); }
  while (h.length < n) h.push(p.splice(Math.floor(rnd() * p.length), 1)[0]);
  return h.sort();
}
const cnt = (l) => l.reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {});
function check(full) {
  const t = top(full);
  if (!t) return { none: true };
  const orig = cnt(full);
  let changed = Object.assign({}, orig), minus = {};
  if (t.kind === 'sw') { changed[t.w.reveal]--; changed['스몰월드']--; changed[t.w.target] = (changed[t.w.target] || 0) + 1; minus = cnt([t.w.bridge, t.w.reveal]); }
  if (t.kind === 'dark') { changed['다크오컬티즘']--; changed[t.w.discard]--; changed['제로마키나'] = (changed['제로마키나'] || 0) + 1; if (t.w.discard !== '제로마키나') minus = cnt([t.w.discard]); }
  const bad = [], badLit = [];
  for (const [c, n] of Object.entries(t.pulls || {})) {
    const allowed = (PLD[c] || 0) - (changed[c] || 0) - (minus[c] || 0);                  // 규칙: 덱 - 바꾼 패 - bridge - reveal
    const lit = (PLD[c] || 0) - (orig[c] || 0) - (t.kind === 'sw' ? (minus[c] || 0) : 0) - (t.kind === 'dark' ? (minus[c] || 0) : 0); // 글자 그대로: 덱 - 원래 패 - bridge - reveal
    if (n > allowed) bad.push(`${c} ${n}>${allowed}`);
    if (n > lit) badLit.push(`${c} ${n}>${lit}`);
  }
  return { t, bad, badLit };
}
const out = { random: [], withSW: [] }, summary = {};
for (let i = 0; i < 300; i++) out.random.push([hand(i % 2 ? 6 : 5), null]);
for (let i = 0; i < 300; i++) out.withSW.push([hand(i % 2 ? 6 : 5, '스몰월드'), null]);
const t0 = Date.now();
for (const k of ['random', 'withSW']) {
  const s = { n: 0, none: 0, planlib: 0, calc: 0, sw: 0, dark: 0, bad: 0, badLit: 0, ex: [], exLit: [] };
  for (const row of out[k]) {
    const r = check(row[0]); s.n++;
    if (r.none) { s.none++; continue; }
    s[r.t.src]++; if (r.t.kind !== 'base') s[r.t.kind]++;
    if (r.bad.length) { s.bad++; if (s.ex.length < 8) s.ex.push({ hand: row[0].join('·'), src: r.t.src, kind: r.t.kind, w: r.t.w && [r.t.w.reveal || r.t.w.discard, r.t.w.bridge, r.t.w.target].filter(Boolean).join('>'), label: r.t.label, bad: r.bad }); }
    if (r.badLit.length) { s.badLit++; if (s.exLit.length < 5) s.exLit.push({ hand: row[0].join('·'), kind: r.t.kind, w: r.t.w && [r.t.w.reveal || r.t.w.discard, r.t.w.bridge, r.t.w.target].filter(Boolean).join('>'), bad: r.badLit }); }
  }
  summary[k] = s;
  console.log(`${k === 'random' ? '무작위 패' : '스몰 월드 포함 패'} ${s.n}개: 1순위가 덱에 남은 장수보다 많이 꺼냄 ${s.bad}건 (1순위 출처: 미리 만든 수순 ${s.planlib}, 계산기 ${s.calc}, 수순 없음 ${s.none} / 스몰 월드 ${s.sw}, 다크 오컬티즘 ${s.dark})`);
  s.ex.forEach((e) => console.log('  위반', JSON.stringify(e)));
}
console.log('ms', Date.now() - t0);
process.exitCode = Object.values(summary).some((x) => x.bad) ? 1 : 0;
