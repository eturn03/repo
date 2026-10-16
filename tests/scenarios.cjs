// 시나리오 확인 스크립트(Playwright). 실행: NODE_PATH="$(npm root -g)" node tests/scenarios.cjs
// SITE_FILE=dd4-helper.html 를 주면 한 파일 버전을 검사한다. 결과 이미지는 screenshots/.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, process.env.SITE_FILE || 'index.html');
const OUT = path.join(ROOT, 'screenshots');
const SHOT = !process.env.NO_SHOT;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}
async function addCard(page, fullName, times = 1) {
  for (let i = 0; i < times; i++) await page.click(`button.card-btn[data-name="${fullName}"]`);
}
async function noHScroll(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(`${label}: 가로 스크롤 없음`, r.sw <= r.cw, `scrollWidth ${r.sw} / clientWidth ${r.cw}`);
}
// 루트를 열고 n-1 단계까지 체크해서 현재 단계를 n으로 만든다
async function openRouteAt(page, id, n) {
  // 이전 화면에서 늦게 끝난 데이터 로드가 상태를 다시 저장하지 않도록 새로 연 뒤에 쓴다
  await page.goto(URL);
  await page.waitForTimeout(300);
  await page.evaluate(([id, n]) => {
    const st = JSON.parse(localStorage.getItem('dd4-helper-v1') || '{}');
    st.tab = 'route'; st.routeId = id; st.ht = null; st.checks = st.checks || {};
    st.checks[id] = Array.from({ length: n - 1 }, (_, i) => i + 1);
    localStorage.setItem('dd4-helper-v1', JSON.stringify(st));
  }, [id, n]);
  await page.reload();
  await page.waitForSelector('#trapPanel');
}
async function shot(page, sel, name) {
  if (!SHOT) return;
  await page.addStyleTag({ content: '.topbar{position:static !important}' });
  if (sel) await page.locator(sel).screenshot({ path: path.join(OUT, name) });
  else await page.screenshot({ path: path.join(OUT, name) });
}

(async () => {
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) {
    for (const vp of [{ name: 'pc', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
      const tag = `[${theme}/${vp.name}]`;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.name === 'phone' ? 2 : 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(URL);
      await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
      await page.reload();
      const defTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (theme === 'dark') check(`${tag} 기본 테마 = 다크`, defTheme === 'dark', defTheme);
      if (theme === 'light') await page.click('button[data-theme-set="light"]');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      check(`${tag} 배경색`, bg === (theme === 'dark' ? 'rgb(18, 20, 24)' : 'rgb(233, 235, 238)'), bg);

      // 패 선택: 케플러 + 우라라 + 무한포영 + 후와로스 + 스케일
      await addCard(page, 'DD 마도현자 케플러');
      await addCard(page, '하루 우라라');
      await addCard(page, '무한포영');
      await addCard(page, '마루챠미 후와로스');
      await addCard(page, 'DD 스케일 서베이어');
      const firstRoute = await page.getAttribute('#recs .route-item .rid', 'data-id');
      check(`${tag} 케플러 패 → 첫 추천 A1`, firstRoute === 'A1', firstRoute);
      const minH = await page.$$eval('main button', (bs) => Math.min(...bs.filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height)));
      check(`${tag} 버튼 높이 최소 44px`, minH >= 44, `${minH.toFixed(1)}px`);
      const minF = await page.$$eval('button', (bs) => Math.min(...bs.filter((b) => b.offsetParent).map((b) => parseFloat(getComputedStyle(b).fontSize))));
      check(`${tag} 버튼 글자 16px 이상`, minF >= 16, `${minF}px`);
      await noHScroll(page, `${tag} 패 선택`);
      await shot(page, null, `hand-${theme}-${vp.name}.png`);

      // (a) A1 7단계 + 하루 우라라
      await openRouteAt(page, 'A1', 7);
      await page.waitForSelector('button.trap-btn[data-act="ht-trap"][data-key="ash"]');
      const trapBtns = await page.$$eval('#trapPanel button[data-act="ht-trap"]', (bs) => bs.map((b) => b.textContent.trim()));
      check(`${tag} (a) 7단계 패트랩 버튼(데이터 있는 것만)`, trapBtns.length > 0 && !trapBtns.some((t) => t.includes('니비루')), trapBtns.join(', '));
      await page.click('button.trap-btn[data-key="ash"]');
      await page.waitForSelector('#trapPanel ol.todo li');
      const a = await page.textContent('#trapPanel');
      const tabSel = await page.$eval('#trapPanel button[role="tab"][aria-selected="true"]', (b) => b.textContent.trim());
      check(`${tag} (a) 할 일 목록 + "패에 스케일 있으면" 탭`, a.includes('패에 스케일 있으면') && (await page.$$('#trapPanel ol.todo li')).length > 5, `선택된 탭: ${tabSel}`);
      check(`${tag} (a) 패에 스케일 → 그 탭이 기본`, tabSel.startsWith('✓') || tabSel.includes('스케일'), tabSel);
      check(`${tag} (a) 순서: 상태→생긴 일→할 일→건너뛴→결과`, ['맞은 시점 상태', '맞아서 생긴 일', '할 일', '건너뛴 원래 단계', '결과 필드'].every((t, i, arr) => i === 0 || a.indexOf(t) > a.indexOf(arr[i - 1])));
      check(`${tag} (a) (대체) 표시`, a.includes('대체: 원래 루트와 소재·대상이 다름'));
      check(`${tag} (a) 한계(하한, MD 실기 미확인) 표시`, a.includes('하한') && a.includes('MD 실기'));
      await page.click('#trapPanel ol.todo li input');
      const checked = await page.$eval('#trapPanel ol.todo li input', (i) => i.checked);
      check(`${tag} (a) 할 일 체크 가능`, checked);
      await noHScroll(page, `${tag} (a) 루트 진행`);
      await shot(page, '#trapPanel', `a-A1-7-ash-${theme}-${vp.name}.png`);

      // (b) A1 6단계 + 증식의 G
      await openRouteAt(page, 'A1', 6);
      await page.click('button.trap-btn[data-key="maxxc"]');
      await page.waitForSelector('#trapPanel .compare');
      const b = await page.textContent('#trapPanel .compare');
      const opts = await page.$$('#trapPanel .compare .opt');
      check(`${tag} (b) 드롤 시점 비교 카드`, opts.length >= 2 && b.includes('드롤 없이 끝까지') && b.includes('단계 직후 내 드롤'), `${opts.length}칸: ` + b.replace(/\s+/g, ' ').slice(0, 120));
      const bAll = await page.textContent('#trapPanel');
      check(`${tag} (b) 문서 루트 E1 참조(조건부)`, bAll.includes('문서 루트 E1 참조'));
      await page.click('#trapPanel .compare .opt:nth-child(2) button');
      check(`${tag} (b) 드롤 시점 고르면 그 수순 표시`, (await page.$$('#trapPanel ol.todo li')).length > 0);
      await shot(page, '#trapPanel', `b-A1-6-maxxc-${theme}-${vp.name}.png`);

      // (c) A2 15단계 + 무한포영
      await openRouteAt(page, 'A2', 15);
      await page.click('button.trap-btn[data-key="imperm"]');
      await page.waitForSelector('#trapPanel .box.ok');
      const c = await page.textContent('#trapPanel');
      check(`${tag} (c) "문서 루트 F1·F2 참조"`, c.includes('문서 루트 F1·F2 참조'));
      await shot(page, '#trapPanel', `c-A2-15-imperm-${theme}-${vp.name}.png`);
      await page.click('#trapPanel button[data-act="open-route"][data-id="F1"]');
      const h2 = await page.textContent('main h2');
      check(`${tag} (c) F1 열기`, h2.includes('F1'), h2.trim().slice(0, 40));

      // 니비루: 상단 버튼 하나, 현재 단계 기준
      await openRouteAt(page, 'A1', 15);
      check(`${tag} 니비루는 단계별 버튼에 없음`, (await page.$$('#trapPanel button[data-act="ht-trap"][data-key="nibiru"]')).length === 0);
      await page.click('button[data-act="ht-nibiru"]');
      await page.waitForSelector('#trapPanel .ht-sec');
      const nib = await page.textContent('#trapPanel');
      check(`${tag} 니비루 15단계: 카운터 선택지`, nib.includes('15단계') && nib.includes('제우스 ②로 무효'));
      await page.click('#trapPanel button[data-act="ht-variant"][data-v="counter"]');
      const nib2 = await page.textContent('#trapPanel');
      check(`${tag} 카운터 누르면 counter.plan`, nib2.includes('제우스 ②로 무효') && nib2.includes('후)'));
      await page.click('button[data-act="next-step"]');
      await page.waitForSelector('#trapPanel .ht-sec');
      const nib3 = await page.textContent('#trapPanel');
      check(`${tag} 진행하면 니비루 기준 단계도 바뀜(16단계)`, nib3.includes('16단계 기준') || nib3.includes('진행 위치 16단계'));
      if (vp.name === 'pc') await shot(page, '#trapPanel', `nibiru-A1-${theme}.png`);

      // 패트랩 요약 페이지
      await page.click('button.tab[data-tab="ht"]');
      const s = await page.textContent('main');
      check(`${tag} 패트랩 요약(3장·4장)`, s.includes('공통 원칙') && s.includes('루트별 가장 아픈 지점'));
      await noHScroll(page, `${tag} 패트랩 요약`);
      if (vp.name === 'pc') await shot(page, null, `ht-summary-${theme}.png`);
      for (const t of ['all', 'doc']) {
        await page.click(`button.tab[data-tab="${t}"]`);
        if (t === 'doc') await page.$$eval('details', (ds) => ds.forEach((d) => (d.open = true)));
        await noHScroll(page, `${tag} ${t} 탭`);
      }
      await page.reload();
      const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('dd4-helper-v1')).theme);
      check(`${tag} 테마 선택 저장`, kept === theme, kept);
      check(`${tag} 콘솔 오류 없음`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
  // localStorage 막힌 환경
  const bctx = await browser.newContext();
  await bctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  const bp = await bctx.newPage();
  const berr = [];
  bp.on('pageerror', (e) => berr.push(e.message));
  await bp.goto(URL);
  await bp.click('button.card-btn[data-name="DD 마도현자 케플러"]');
  await bp.click('#recs button[data-act="start-route"][data-id="A1"]');
  await bp.click('button[data-act="next-step"]');
  await bp.click('button.trap-btn[data-key="ash"]');
  await bp.waitForSelector('#trapPanel .ht-sec');
  check('localStorage 차단돼도 동작', berr.length === 0, berr.join(' | '));
  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length}개 중 실패 ${fails.length}개`);
  process.exit(fails.length ? 1 : 0);
})();
