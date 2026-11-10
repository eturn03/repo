/**
 * 돈 보드 서버 (Google Apps Script 웹앱). 구글 시트 "돈관리"에 붙어 있다.
 *
 * 비밀값은 여기 적지 않는다. 전부 "스크립트 속성"에 둔다.
 *   TOKEN            : 접속용 비밀 토큰 (setupToken을 실행하면 만들어진다)
 *   SPRITE_FOLDER_ID : 마스코트 이미지가 든 드라이브 폴더 ID
 *
 * 요청: POST, 본문은 JSON 문자열 {"token": "...", "view": "..."}, Content-Type은 text/plain.
 * 토큰이 틀리면 {} 만 돌려준다. GET은 항상 {}.
 * 올리기: npx @google/clasp push → 같은 배포 ID로 다시 배포 (tasks/plan.md 5절).
 */

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({});
  }
  if (!body || !isValidToken_(body.token)) return json_({});

  if (body.view === 'ping') return json_({ ok: true, at: new Date().toISOString() });
  return json_({});
}

// 브라우저 주소창으로 열어도 아무것도 안 보이게 한다.
function doGet() {
  return json_({});
}

// 글자를 하나씩 끝까지 비교한다 (응답 시간으로 토큰을 추측하기 어렵게).
function isValidToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected || typeof token !== 'string' || token.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 설치할 때 한 번만 실행한다. 편집기 위쪽 함수 목록에서 setupToken을 고르고 "실행".
 * 무작위 토큰을 만들어 스크립트 속성에 저장하고 실행 로그에 보여 준다.
 * 이미 토큰이 있으면 덮어쓰지 않는다(기기마다 다시 입력하지 않게). 바꾸려면 resetToken.
 */
function setupToken() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  Logger.log('토큰: ' + token);
}

// 토큰이 새어 나갔을 때만 실행한다. 모든 기기에서 새 토큰을 다시 입력해야 한다.
function resetToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  setupToken();
}
