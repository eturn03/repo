/**
 * 개인 대시보드 백엔드 (Google Apps Script 웹앱)
 *
 * 이 파일은 구글 시트에 붙어 있는 Apps Script에 그대로 붙여넣는다.
 * (시트 메뉴: 확장 프로그램 > Apps Script)
 *
 * 비밀값은 여기 적지 않는다. 전부 "스크립트 속성"에 넣는다.
 *   TOKEN            : 대시보드 접속용 비밀 토큰 (아무도 모르는 긴 문자열)
 *   SPRITE_FOLDER_ID : 스프라이트 이미지가 든 구글 드라이브 폴더 ID
 *
 * 요청 방식: POST, 본문은 JSON 문자열 {"token": "...", "view": "data" | "sprites"}
 * 토큰이 틀리면 빈 객체 {} 를 돌려준다.
 */

// 이름이 "_"로 시작하는 탭은 대시보드로 보내지 않는다 (메모용 탭 등).
var HIDDEN_TAB_PREFIX = '_';

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({});
  }

  if (!isValidToken_(body.token)) {
    return json_({});
  }

  if (body.view === 'sprites') {
    return json_(readSprites_());
  }
  return json_(readSheet_());
}

// 브라우저 주소창으로 열었을 때도 아무것도 안 보이게 한다.
function doGet() {
  return json_({});
}

function isValidToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected || typeof token !== 'string' || token.length !== expected.length) {
    return false;
  }
  // 글자를 하나씩 끝까지 비교 (응답 시간으로 토큰을 추측하기 어렵게)
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 시트의 모든 탭을 읽는다.
 * 각 탭의 1행은 제목(열 이름), 2행부터 데이터.
 * 결과 예: { updatedAt: "...", tabs: { "돈_요약": [ {항목: "월급", 금액: 2500000}, ... ] } }
 */
function readSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var tabs = {};

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (name.indexOf(HIDDEN_TAB_PREFIX) === 0) return;

    var values = sheet.getDataRange().getValues();
    if (values.length < 1) {
      tabs[name] = [];
      return;
    }

    var headers = values[0].map(function (h) { return String(h).trim(); });
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var isEmpty = row.every(function (v) { return v === '' || v === null; });
      if (isEmpty) continue;

      var obj = {};
      headers.forEach(function (h, c) {
        if (!h) return;
        obj[h] = toPlain_(row[c], tz);
      });
      rows.push(obj);
    }
    tabs[name] = rows;
  });

  return {
    updatedAt: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss"),
    timeZone: tz,
    tabs: tabs
  };
}

// 날짜는 시트 시간대 기준 문자열로 바꾼다 (그냥 두면 UTC로 바뀌어 하루씩 밀릴 수 있음).
function toPlain_(v, tz) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return v;
}

/**
 * 드라이브 폴더 안의 이미지를 읽어 data URI로 돌려준다.
 * 파일명에서 확장자를 뺀 이름이 키가 된다. 예: normal.png → "normal"
 * 결과 예: { sprites: { normal: "data:image/png;base64,...", happy: "...", angry: "..." } }
 */
function readSprites_() {
  var folderId = PropertiesService.getScriptProperties().getProperty('SPRITE_FOLDER_ID');
  if (!folderId) return { sprites: {} };

  var sprites = {};
  var files = DriveApp.getFolderById(folderId).getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var type = file.getMimeType();
    if (type.indexOf('image/') !== 0) continue;

    var key = file.getName().replace(/\.[^.]+$/, '');
    var base64 = Utilities.base64Encode(file.getBlob().getBytes());
    sprites[key] = 'data:' + type + ';base64,' + base64;
  }
  return { sprites: sprites };
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 설치할 때 한 번만 실행하는 함수.
 * Apps Script 편집기 위쪽에서 이 함수를 골라 "실행"을 누르면
 * 무작위 토큰을 만들어 스크립트 속성에 저장하고, 실행 로그에 보여준다.
 * 로그에 나온 토큰을 폰·맥북에서 처음 접속할 때 1번 입력하면 된다.
 */
function setupToken() {
  var props = PropertiesService.getScriptProperties();
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('TOKEN', token);
  Logger.log('새 토큰: ' + token);
}
