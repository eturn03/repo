// 돈 보드 위젯 (Scriptable). 홈 화면 작은 위젯과 잠금 화면 위젯에 "오늘까지 쓸 수 있는 돈"을 보여 준다.
// 처음에는 Scriptable 앱 안에서 한 번 실행해 서버 주소와 토큰을 넣는다. 둘 다 이 기기의 키체인에만 저장되고 이 파일에는 없다.
// 연결이 안 되면 마지막으로 받은 숫자와 그 시각을 보여 준다. 위젯을 누르면 웹앱이 열린다.
// 설치 순서: docs/SETUP.md

const KEY_URL = 'moneyboard.url';       // 연결시험 스크립트와 같은 이름
const KEY_TOKEN = 'moneyboard.token';
const APP_URL = 'https://eturn03.github.io/repo/';
const CACHE_FILE = 'moneyboard-widget.json';
const REFRESH_MIN = 15;

const C = {
  ground: new Color('#0e1513'),
  ink: new Color('#d5dcc8'),
  dim: new Color('#8a9e92'),
  bad: new Color('#e07a68')
};

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);

function won(n) {
  return Math.round(n).toLocaleString('ko-KR');
}

// 잠금 화면 원형처럼 좁은 곳: 1.8만, -3천
function shortWon(n) {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 10000) return sign + (Math.floor(a / 1000) / 10) + '만';
  if (a >= 1000) return sign + Math.floor(a / 1000) + '천';
  return sign + a;
}

async function ask(key, title, secure) {
  const a = new Alert();
  a.title = title;
  if (secure) a.addSecureTextField('', '');
  else a.addTextField('', '');
  a.addAction('저장');
  a.addCancelAction('취소');
  if ((await a.present()) === -1) return null;
  const v = a.textFieldValue(0).trim();
  if (v) Keychain.set(key, v);
  return v || null;
}

function readCache() {
  try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : null; } catch (e) { return null; }
}

async function fetchNumber(url, token) {
  const req = new Request(url);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  req.body = JSON.stringify({ token: token, view: 'widget' });
  req.timeoutInterval = 20;
  const res = await req.loadJSON();
  if (!res || !res.ok) throw new Error('토큰이 맞지 않거나 서버 오류');
  const data = { available: res.available, at: res.at, date: res.date };
  fm.writeString(cachePath, JSON.stringify(data));
  return data;
}

function build(data, stale, family) {
  const w = new ListWidget();
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);
  const lock = family && family.indexOf('accessory') === 0;
  if (!lock) {
    w.backgroundColor = C.ground;
    w.setPadding(14, 14, 14, 14);
  }

  if (!data) {
    const t = w.addText('Scriptable 앱에서 이 스크립트를 한 번 실행해 주소와 토큰을 넣어 줘');
    t.font = Font.systemFont(12);
    t.textColor = lock ? Color.white() : C.ink;
    return w;
  }

  const amount = data.available;
  const stamp = data.at + ' 기준' + (stale ? ' · 연결 안 됨' : '');

  if (family === 'accessoryInline') {
    w.addText('쓸 돈 ' + won(amount) + '원 · ' + data.at);
    return w;
  }
  if (family === 'accessoryCircular') {
    const t = w.addText(shortWon(amount));
    t.font = Font.boldSystemFont(16);
    t.centerAlignText();
    t.minimumScaleFactor = 0.5;
    return w;
  }
  if (family === 'accessoryRectangular') {
    const l = w.addText('오늘까지 쓸 돈');
    l.font = Font.systemFont(12);
    const n = w.addText(won(amount) + '원');
    n.font = Font.boldSystemFont(22);
    n.minimumScaleFactor = 0.6;
    const s = w.addText(stamp);
    s.font = Font.systemFont(11);
    return w;
  }

  // 홈 화면 (small / medium)
  const label = w.addText('오늘까지 쓸 수 있는 돈');
  label.font = Font.systemFont(12);
  label.textColor = C.dim;
  w.addSpacer(6);
  const num = w.addText(won(amount));
  num.font = Font.heavySystemFont(34);
  num.textColor = amount < 0 ? C.bad : C.ink;
  num.minimumScaleFactor = 0.5;
  num.lineLimit = 1;
  const unit = w.addText('원');
  unit.font = Font.systemFont(14);
  unit.textColor = C.dim;
  w.addSpacer();
  const s = w.addText(stamp);
  s.font = Font.systemFont(11);
  s.textColor = stale ? C.bad : C.dim;
  return w;
}

async function main() {
  let url = Keychain.contains(KEY_URL) ? Keychain.get(KEY_URL) : null;
  let token = Keychain.contains(KEY_TOKEN) ? Keychain.get(KEY_TOKEN) : null;

  // 앱 안에서 실행하면 처음 설정, 또는 다시 넣기
  if (config.runsInApp) {
    if (url && token) {
      const m = new Alert();
      m.title = '돈 보드 위젯';
      m.addAction('미리 보기');
      m.addAction('주소·토큰 다시 넣기');
      m.addCancelAction('닫기');
      const pick = await m.present();
      if (pick === 1) { url = null; token = null; }
      if (pick === -1) return null;
    }
    if (!url) url = await ask(KEY_URL, '서버 주소 (…/exec)', false);
    if (!token) token = await ask(KEY_TOKEN, '토큰', true);
  }

  let data = null;
  let stale = false;
  if (url && token) {
    try {
      data = await fetchNumber(url, token);
    } catch (e) {
      data = readCache();
      stale = true;
    }
  }
  return build(data, stale, config.widgetFamily);
}

const widget = await main();
if (widget && config.runsInWidget) Script.setWidget(widget);
else if (widget) await widget.presentSmall();
Script.complete();
