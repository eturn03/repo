// 시나리오 확인 스크립트(Playwright). 실행: NODE_PATH="$(npm root -g)" node tests/scenarios.cjs
// index.html을 file:// 로 열어 3개 시나리오를 돌리고 screenshots/ 에 저장한다.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'screenshots');
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

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const vp of [{ name: 'pc', width: 1280, height: 900 }, { name: 'phone', width: 375, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.name === 'phone' ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL);
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload();
    // 요소 스크린샷에 고정 헤더가 겹치지 않게(화면 기능엔 영향 없음)
    const unstick = () => page.addStyleTag({ content: '.topbar{position:static !important}' });
    await unstick();

    // (a) 케플러 + 우라라 + 무한포영 + 후와로스 + 도미나스 임펄스
    await addCard(page, 'DD 마도현자 케플러');
    await addCard(page, '하루 우라라');
    await addCard(page, '무한포영');
    await addCard(page, '마루챠미 후와로스');
    await addCard(page, '도미나스 임펄스');
    const recs = await page.textContent('#recs');
    const firstRoute = await page.getAttribute('#recs .route-item .rid', 'data-id');
    check(`[${vp.name}] (a) 케플러 루트 추천`, recs.includes('이니시: 케플러') && firstRoute === 'A1', `첫 추천 ${firstRoute}`);
    check(`[${vp.name}] (a) A2·B1·C2도 목록에 있음`, ['A2', 'B1', 'C2'].every((id) => recs.includes(id)));
    check(`[${vp.name}] (a) 도미나스 문서 메모 표시`, recs.includes('빛·땅·바람'));
    await noHScroll(page, `[${vp.name}] (a) 패 선택`);
    await page.screenshot({ path: path.join(OUT, `a-kepler-${vp.name}.png`), fullPage: vp.name === 'pc' });
    if (vp.name === 'phone') {
      await page.locator('#recs').screenshot({ path: path.join(OUT, `a-kepler-recs-${vp.name}.png`) });
    }

    // (b) A1 진행 중 5번째 소환(제우스 링크)에서 니비루
    await page.click('#recs button[data-act="start-route"][data-id="A1"]');
    for (let i = 0; i < 11; i++) await page.click('button[data-act="next-step"]');
    const cur = await page.textContent('ol.steps li.current');
    check(`[${vp.name}] (b) 현재 단계 = 12. 제우스 링크(소환 5번째)`, cur.includes('제우스 링크') && cur.includes('소환 5번째'), cur.trim().slice(0, 60));
    await page.click('button.trap-btn[data-key="nibiru"]');
    const trap = await page.textContent('#trapPanel');
    check(`[${vp.name}] (b) 니비루 문서 대응 표시`, trap.includes('문서 대응 있음') && trap.includes('제우스 ②로 무효') && trap.includes('계약서 1장 제외'));
    await noHScroll(page, `[${vp.name}] (b) 루트 진행`);
    await page.locator('#trapPanel').screenshot({ path: path.join(OUT, `b-a1-nibiru-${vp.name}.png`) });
    // 같은 루트에서 5번째 소환 전(8단계)이면 기록 없음이어야 함
    await page.selectOption('select[data-act="trap-step"]', '8');
    const trap8 = await page.textContent('#trapPanel');
    check(`[${vp.name}] (b') 8단계(소환 3번)에서 니비루 → 기록 없음 + 기록 시점 안내`, trap8.includes('문서에 대응 기록 없음') && trap8.includes('12단계'));
    // 무한포영으로 다른 화면도 확인(A1은 솔로몬 선출이 아님)
    if (vp.name === 'pc') {
      await page.locator('section.panel').nth(2).screenshot({ path: path.join(OUT, `b-a1-finalfield-${vp.name}.png`) });
    }

    // (c) 우라라 2 + 무한포영 + 도미나스 + 후와로스
    await page.click('button.tab[data-tab="hand"]');
    await page.click('button[data-act="hand-clear"]');
    await addCard(page, '하루 우라라', 2);
    await addCard(page, '무한포영');
    await addCard(page, '도미나스 임펄스');
    await addCard(page, '마루챠미 후와로스');
    const recs2 = await page.textContent('#recs');
    check(`[${vp.name}] (c) "이 패로 기록된 루트 없음" 표시`, recs2.includes('이 패로 기록된 루트 없음'));
    const moreCards = await page.$$eval('#recs .route-item .title', (els) => els.map((e) => e.textContent.trim()));
    const hasSW = moreCards.some((t) => t.startsWith('+ 스몰 월드'));
    check(`[${vp.name}] (c) 1장 추가 대안에 스몰 월드 있음`, hasSW, moreCards.map((t) => t.split(' ')[1]).join(', '));
    check(`[${vp.name}] (c) 스몰 월드 경로 설명(다리 드롤 → 제로 마키나)`, recs2.includes('다리 드롤'));
    await noHScroll(page, `[${vp.name}] (c) 패 선택`);
    await page.locator('#recs').screenshot({ path: path.join(OUT, `c-no-initiator-${vp.name}.png`) });

    // 다른 탭 가로 스크롤 검사
    for (const tab of ['all', 'doc']) {
      await page.click(`button.tab[data-tab="${tab}"]`);
      if (tab === 'doc') await page.$$eval('details', (ds) => ds.forEach((d) => (d.open = true)));
      await noHScroll(page, `[${vp.name}] ${tab} 탭`);
    }
    // 새로고침 후 상태 유지(localStorage)
    await page.reload();
    await unstick();
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('dd4-helper-v1')).checks.A1.length);
    check(`[${vp.name}] 새로고침 후 A1 체크 상태 유지`, kept === 11, `체크 ${kept}개`);
    check(`[${vp.name}] 콘솔 오류 없음`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 다크 모드
  const dctx = await browser.newContext({ viewport: { width: 375, height: 800 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const dp = await dctx.newPage();
  await dp.goto(URL);
  await dp.evaluate(() => { localStorage.clear(); });
  await dp.reload();
  await dp.click('button.card-btn[data-name="DD 마도현자 케플러"]');
  const bg = await dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('다크 모드 배경 적용', bg === 'rgb(20, 20, 23)', bg);
  await dp.screenshot({ path: path.join(OUT, 'dark-phone.png') });
  // localStorage 막힌 환경에서도 동작
  const bctx = await browser.newContext();
  await bctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const bp = await bctx.newPage();
  const berr = [];
  bp.on('pageerror', (e) => berr.push(e.message));
  await bp.goto(URL);
  await bp.click('button.card-btn[data-name="DD 마도현자 케플러"]');
  const ok = (await bp.textContent('#recs')).includes('A1');
  check('localStorage 차단돼도 동작', ok && berr.length === 0, berr.join(' | '));
  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length}개 중 실패 ${fails.length}개`);
  process.exit(fails.length ? 1 : 0);
})();
