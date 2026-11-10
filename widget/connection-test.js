// 돈 보드 연결 시험 (Scriptable). 아이폰에서 서버와 말이 통하는지만 본다.
// 처음 실행하면 서버 주소와 토큰을 물어 이 기기의 키체인에 저장한다. 이 파일에는 주소도 토큰도 없다.
// 위젯(money-widget.js)도 같은 키체인 이름을 쓴다.
const KEY_URL = 'moneyboard.url';
const KEY_TOKEN = 'moneyboard.token';

async function ask(key, title, secure) {
  if (Keychain.contains(key)) return Keychain.get(key);
  const a = new Alert();
  a.title = title;
  if (secure) a.addSecureTextField('', '');
  else a.addTextField('', '');
  a.addAction('저장');
  a.addCancelAction('취소');
  if ((await a.present()) === -1) throw new Error('취소했다');
  const value = a.textFieldValue(0).trim();
  if (!value) throw new Error('빈 값이다');
  Keychain.set(key, value);
  return value;
}

async function ping(url, token) {
  const req = new Request(url);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  req.body = JSON.stringify({ token: token, view: 'ping' });
  req.timeoutInterval = 20;
  const t0 = Date.now();
  try {
    const text = await req.loadString();
    return (Date.now() - t0) + 'ms  ' + text.slice(0, 120);
  } catch (e) {
    return '실패: ' + e;
  }
}

const menu = new Alert();
menu.title = '돈 보드 연결 시험';
menu.addAction('시험하기');
menu.addAction('주소·토큰 다시 입력');
menu.addCancelAction('닫기');
const pick = await menu.present();

if (pick === 1) {
  if (Keychain.contains(KEY_URL)) Keychain.remove(KEY_URL);
  if (Keychain.contains(KEY_TOKEN)) Keychain.remove(KEY_TOKEN);
}
if (pick !== -1) {
  const url = await ask(KEY_URL, '서버 주소 (…/exec)', false);
  const token = await ask(KEY_TOKEN, '토큰', true);
  const right = await ping(url, token);
  const wrong = await ping(url, 'wrong-token');
  const done = new Alert();
  done.title = '결과';
  done.message = '맞는 토큰: ' + right + '\n\n틀린 토큰: ' + wrong + '\n\n맞는 토큰에 "ok":true, 틀린 토큰에 {} 가 나오면 성공.';
  done.addAction('확인');
  await done.present();
}
Script.complete();
