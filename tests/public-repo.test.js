// 공개 레포 지킴이: 시트 주소나 마스코트 이미지가 실수로 커밋되지 않았는지 본다.
const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');

const root = require('node:path').join(__dirname, '..');
const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

test('구글 시트 주소가 레포에 없다', () => {
  // 이 파일 자신이 걸리지 않게 주소 조각을 나눠 적는다
  const pattern = ['docs.google.com', 'spreadsheets', 'd', ''].join('/');
  const hits = execSync('git grep -l -F "' + pattern + '" -- . || true', { cwd: root, encoding: 'utf8' }).trim();
  assert.strictEqual(hits, '', '시트 주소가 들어 있는 파일: ' + hits);
});

test('마스코트 이미지와 비공개 메모가 레포에 없다', () => {
  const bad = tracked.filter((f) => f.startsWith('local-sprites/') || f.startsWith('local-notes/') || f.endsWith('.clasp.json'));
  assert.deepStrictEqual(bad, []);
});
