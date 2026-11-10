// 화면 설정. 비밀값은 여기 넣지 않는다 (이 파일은 공개된다).
window.DASH_CONFIG = {
  // Apps Script 웹앱 주소(…/exec). 토큰 없이는 빈 응답만 주니 공개돼도 괜찮다.
  API_URL: 'https://script.google.com/macros/s/AKfycbz6PlvyRbkljFmPxKSvr85qgKV37oA4VaOuk6J-E2emWfKYi7Et9njXIZ78Cn4nB5U/exec',
  // 자동 갱신 주기 5분
  REFRESH_MS: 5 * 60 * 1000,
  // 화면을 다시 볼 때 이보다 오래됐으면 바로 갱신 (30초)
  REFOCUS_MS: 30 * 1000
};
