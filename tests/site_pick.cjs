// 사이트 app.js 의 장수 검사(planlibPick·swCandidates)를 그대로 꺼내 Node 에서 돌린다
const fs = require('fs');
const R = process.env.SITE_ROOT || require('path').resolve(__dirname, '..') + '/';
const app = fs.readFileSync(R + 'assets/app.js', 'utf8');
const a = app.indexOf('  // dd-planlib.json 장수 검사'), b = app.indexOf('  function htAt(');
const cm = app.match(/var CALC_MODEL = \[[^\]]*\];/)[0];
global.window = { DD_PLANLIB: JSON.parse(fs.readFileSync(R + 'data/dd-planlib.json', 'utf8')), DD_SW: JSON.parse(fs.readFileSync(R + 'data/dd-smallworld.json', 'utf8')) };
const mod = new Function('window', cm + app.slice(a, b) + 'return { planlibPick, swCandidates, swTitle, darkTitle, darkKey, stableSort, CALC_MODEL };')(global.window);
const F = require(R + 'assets/calc/engine.js'), D = require(R + 'data/dd-data.json');
const calc = F(D.routes.map((r) => ({ id: r.id, title: r.name, steps: r.steps.map((s) => s.text) })));
// renderSolve 와 같은 순서로 1순위를 고른다
function top(full) {
  const pk = mod.planlibPick(full), sw = mod.swCandidates(pk);
  const r = calc.solveFull(full, sw);
  const opts = [];
  if (r.base) opts.push({ kind: 'base', res: r.base });
  r.smallWorld.forEach((w) => { if (w.result) opts.push({ kind: 'sw', w, res: w.result }); });
  (r.dark || []).forEach((w) => { if (w.result) opts.push({ kind: 'dark', w, res: w.result, onlyUrara: w.onlyUrara }); });
  const sorted = mod.stableSort(opts, mod.darkKey((o) => o.res.score));
  const pb = pk && pk.best, t = sorted[0];
  if (t && (!pb || t.res.score > pb.plan.final_score + 1e-9)) return { src: 'calc', kind: t.kind, w: t.w, score: t.res.score, plan: t.res.plan, pulls: t.res.deck_pulls, label: t.kind };
  if (pb) return { src: 'planlib', kind: pb.sw ? 'sw' : pb.dark ? 'dark' : 'base', w: pb.sw || pb.dark, score: pb.plan.final_score, plan: pb.plan, pulls: pb.plan.deck_pulls, label: pb.plan.label };
  return null;
}
module.exports = { top, mod, calc };
if (require.main === module) {
  const full = process.argv.slice(2).sort();
  const t = top(full);
  console.log(JSON.stringify({ src: t.src, kind: t.kind, w: t.w && { reveal: t.w.reveal, bridge: t.w.bridge, target: t.w.target, discard: t.w.discard }, score: t.score, label: t.label, pulls: t.pulls }, null, 0));
  const pk = mod.planlibPick(full);
  console.log('planlib base:', pk.base && pk.base.label, pk.base && pk.base.final_score, '| sw:', pk.sw.slice(0, 3).map((x) => x.reveal + '>' + x.bridge + '>' + x.target + ' ' + x.plan.label + ' ' + x.planlibScore).join(' ; '));
}
