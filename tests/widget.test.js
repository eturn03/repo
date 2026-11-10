// widget/money-widget.js를 가짜 Scriptable 위에서 돌려 본다. 진짜 확인은 아이폰에서 사용자가 한다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'widget', 'money-widget.js'), 'utf8');

function run({ keychain, response, fail, files, family }) {
  const texts = [];
  let shown = null;
  class ListWidget {
    addText(t) { const o = { text: t, centerAlignText() {} }; texts.push(o); return o; }
    addSpacer() {}
    setPadding() {}
    async presentSmall() { shown = this; }
  }
  const store = Object.assign({}, keychain);
  const disk = files || {};
  const ctx = {
    console, JSON, Math, Date, Number, String, Promise,
    Keychain: { contains: (k) => k in store, get: (k) => store[k], set: (k, v) => { store[k] = v; } },
    Request: class { constructor(u) { this.u = u; } async loadJSON() { if (fail) throw new Error('offline'); return response; } },
    FileManager: { local: () => ({
      documentsDirectory: () => '/docs', joinPath: (a, b) => a + '/' + b,
      fileExists: (p) => p in disk, readString: (p) => disk[p], writeString: (p, s) => { disk[p] = s; }
    }) },
    ListWidget,
    Color: class { constructor(h) { this.h = h; } static white() { return new this('#fff'); } },
    Font: { systemFont: () => ({}), boldSystemFont: () => ({}), heavySystemFont: () => ({}) },
    Alert: class {},
    config: { runsInApp: false, runsInWidget: true, widgetFamily: family || 'small' },
    Script: { setWidget: (w) => { shown = w; }, complete() {} }
  };
  vm.createContext(ctx);
  return vm.runInContext('(async () => {' + SRC + '})()', ctx).then(() => ({ texts: texts.map((t) => t.text), shown, disk }));
}

const KEYS = { 'moneyboard.url': 'https://example.invalid/exec', 'moneyboard.token': 'tok' };

test('스크립트 파일에 서버 주소와 토큰이 없다', () => {
  assert.ok(!/script\.google\.com\/macros/.test(SRC));
  assert.ok(!/token\s*[:=]\s*['"][A-Za-z0-9]{20,}/.test(SRC));
});

test('연결되면 숫자와 기준 시각을 보여 주고 기억해 둔다', async () => {
  const r = await run({ keychain: KEYS, response: { ok: true, available: 18000, at: '15:23', date: '2026-11-10' } });
  assert.ok(r.texts.includes('18,000'));
  assert.ok(r.texts.includes('15:23 기준'));
  assert.ok(r.shown);
  assert.ok(Object.keys(r.disk).length === 1);
});

test('연결이 안 되면 마지막 숫자와 그 시각을 보여 준다', async () => {
  const files = { '/docs/moneyboard-widget.json': JSON.stringify({ available: -2500, at: '09:10', date: '2026-11-10' }) };
  const r = await run({ keychain: KEYS, fail: true, files });
  assert.ok(r.texts.includes('-2,500'));
  assert.ok(r.texts.includes('09:10 기준 · 연결 안 됨'));
});

test('주소·토큰이 없으면 앱에서 한 번 실행하라고 알려 준다', async () => {
  const r = await run({ keychain: {} });
  assert.ok(r.texts[0].includes('한 번 실행'));
});

test('잠금 화면 한 줄 위젯', async () => {
  const r = await run({ keychain: KEYS, response: { ok: true, available: 3000, at: '08:00' }, family: 'accessoryInline' });
  assert.deepStrictEqual(r.texts, ['쓸 돈 3,000원 · 08:00']);
});
