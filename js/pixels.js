// 픽셀 그림: Claude가 직접 그린 16×16 아이콘과 풀숲 배틀 땅 풍경. 포켓몬 그림은 여기 넣지 않는다(마스코트는 드라이브에서).
// 그림은 글자 지도로 적고, 글자마다 색을 정한다. 화면에는 SVG 사각형으로 그려서 어떤 배율에서도 픽셀이 뭉개지지 않는다.
window.Pixels = (function () {
  'use strict';

  var COLOR = {
    k: '#0d0a12',  // 외곽선
    w: '#ece3d2',  // 크림
    p: '#a79cb8',  // 라벤더 회색
    P: '#5a4f6e',  // 짙은 라벤더
    g: '#5cc24a', G: '#2f7a32',   // 초록
    y: '#f2c94c', Y: '#b0842a',   // 노랑 (Dandelion)
    r: '#f2685a', R: '#a8383a',   // 빨강
    t: '#4fb8b0', T: '#2a7a78',   // 청록 (Teal)
    b: '#e8508a', B: '#9c2f5c',   // 딸기색 (Berry)
    n: '#a0723e', N: '#6b4626',   // 갈색
    s: '#6aa6e0'                  // 하늘색
  };

  var ICONS = {
    rice: [ // 식비: 주먹밥
      '................',
      '.......kk.......',
      '......kwwk......',
      '.....kwwwwk.....',
      '....kwwwwwwk....',
      '....kwwwwwwk....',
      '...kwwwwwwwwk...',
      '...kwwwwwwwwk...',
      '..kwwwwwwwwwwk..',
      '..kwwwwwwwwwwk..',
      '.kwwwwGGGGwwwwk.',
      '.kwwwwGGGGwwwwk.',
      '.kwwwwGGGGwwwwk.',
      '..kkkkkkkkkkkk..'
    ],
    cup: [ // 간식·카페: 김 나는 컵
      '................',
      '.....p...p......',
      '....p...p.......',
      '.....p...p......',
      '................',
      '..kkkkkkkkkk....',
      '..kwwwwwwwwkkk..',
      '..kwnnnnnnwkwk..',
      '..kwnnnnnnwkwk..',
      '..kwwwwwwwwkkk..',
      '..kwwwwwwwwk....',
      '...kwwwwwwk.....',
      '....kkkkkk......',
      '.PPPPPPPPPPPP...'
    ],
    note: [ // 취미·음악: 음표
      '................',
      '......yyyyyyyy..',
      '......yYYYYYYy..',
      '......y......y..',
      '......y......y..',
      '......y......y..',
      '......y......y..',
      '......y......y..',
      '...yyyy...yyyy..',
      '..yyyyy..yyyyy..',
      '..yyyyy..yyyyy..',
      '...yyy....yyy...'
    ],
    gem: [ // 사치: 보석
      '................',
      '................',
      '....kkkkkkkk....',
      '...kbbwbbbbBk...',
      '..kbbwbbbbbbBk..',
      '.kkkkkkkkkkkkkk.',
      '.kbbbwbbbbbbBBk.',
      '..kbbwbbbbbBBk..',
      '...kbbwbbbBBk...',
      '....kbbbbBBk....',
      '.....kbbBBk.....',
      '......kbBk......',
      '.......kk.......'
    ],
    box: [ // 그 밖: 상자
      '................',
      '................',
      '...kkkkkkkkkk...',
      '..knnnnnnnnnnk..',
      '.kkkkkkkkkkkkkk.',
      '.knnnnnyynnnnNk.',
      '.knnnnnyynnnnNk.',
      '.knnnnnnnnnnnNk.',
      '.knnnnnnnnnnnNk.',
      '.knnnnnnnnnnnNk.',
      '.knnnnnnnnnnnNk.',
      '.kNNNNNNNNNNNNk.',
      '.kkkkkkkkkkkkkk.'
    ],
    bus: [ // 교통: 셔틀버스
      '................',
      '..kkkkkkkkkkkk..',
      '.kttttttttttttk.',
      '.ktsssstsssstTk.',
      '.ktsssstsssstTk.',
      '.ktsssstsssstTk.',
      '.kttttttttttttk.',
      '.kttttttttttttk.',
      '.ktytttttttytTk.',
      '.kTTTTTTTTTTTTk.',
      '.kkkkkkkkkkkkkk.',
      '..kPPk....kPPk..',
      '...kk......kk...'
    ],
    calendar: [ // 등교일 예산: 달력
      '................',
      '...k..k..k..k...',
      '.kkkkkkkkkkkkkk.',
      '.krrrrrrrrrrrrk.',
      '.krrrrrrrrrrrrk.',
      '.kwwwwwwwwwwwwk.',
      '.kwPwPwPwPwPwwk.',
      '.kwwwwwwwwwwwwk.',
      '.kwPwPwrrwPwwwk.',
      '.kwwwwwrrwwwwwk.',
      '.kwPwPwPwPwPwwk.',
      '.kwwwwwwwwwwwwk.',
      '.kkkkkkkkkkkkkk.'
    ],
    pouch: [ // 이번 달 예산: 돈주머니
      '................',
      '......kkkk......',
      '.....knnnnk.....',
      '......kyyk......',
      '.....knnnnk.....',
      '....knnnnnnk....',
      '...knnnnnnnNk...',
      '..knnnyyyynnNk..',
      '..knnnyNnnnnNk..',
      '..knnnyyyynnNk..',
      '..knnnnnNynnNk..',
      '..knnnyyyynnNk..',
      '...knnnnnnnNk...',
      '....kkkkkkkk....'
    ],
    gift: [ // 비정규 쓸 돈: 선물 상자
      '................',
      '....kk....kk....',
      '...kbbk..kbbk...',
      '....kbbkkbbk....',
      '.kkkkkkkkkkkkkk.',
      '.ktttttbbtttttk.',
      '.kTTTTTbbTTTTTk.',
      '.kkkkkkkkkkkkkk.',
      '..kttttbbttttk..',
      '..kttttbbttttk..',
      '..kttttbbttttk..',
      '..kTTTTbbTTTTk..',
      '..kkkkkkkkkkkk..'
    ],
    coins: [ // 월 상환 가능액: 동전 더미
      '................',
      '................',
      '.....kkkkkk.....',
      '....kyyyyyyk....',
      '....kYYYYYYk....',
      '....kyyyyyyk....',
      '...kkYYYYYYkk...',
      '..kyyyyyyyyyyk..',
      '..kYYYYYYYYYYk..',
      '..kyyyyyyyyyyk..',
      '..kYYYYYYYYYYk..',
      '..kyyyyyyyyyyk..',
      '..kkkkkkkkkkkk..'
    ],
    receipt: [ // 남은 빚: 영수증
      '................',
      '...kkkkkkkkkk...',
      '...kwwwwwwwwk...',
      '...kwPPPPPPwk...',
      '...kwwwwwwwwk...',
      '...kwPPPPwwwk...',
      '...kwwwwwwwwk...',
      '...kwPPPPPPwk...',
      '...kwwwwwwwwk...',
      '...kwrrrrrrwk...',
      '...kwwwwwwwwk...',
      '...kwkwkwkwkk...',
      '...kk.k.k.k.k...'
    ]
  };

  // 분류 이름 → 아이콘. 목록에 없는 분류는 상자.
  var CATEGORY = { '식비': 'rice', '간식·카페': 'cup', '취미·음악': 'note', '사치': 'gem', '그 밖': 'box', '교통': 'bus' };

  var NS = 'http://www.w3.org/2000/svg';

  // 한 줄에서 같은 색이 이어지는 칸은 사각형 하나로 묶는다
  function rectsFromRows(rows, colorOf) {
    var out = '';
    rows.forEach(function (row, y) {
      var x = 0;
      while (x < row.length) {
        var ch = row.charAt(x);
        var fill = colorOf(ch);
        if (!fill) { x++; continue; }
        var start = x;
        while (x < row.length && row.charAt(x) === ch) x++;
        out += '<rect x="' + start + '" y="' + y + '" width="' + (x - start) + '" height="1" fill="' + fill + '"/>';
      }
    });
    return out;
  }

  function svg(width, height, body, cls) {
    var el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    el.setAttribute('shape-rendering', 'crispEdges');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('focusable', 'false');
    if (cls) el.setAttribute('class', cls);
    el.innerHTML = body;
    return el;
  }

  function icon(name) {
    var rows = ICONS[name] || ICONS.box;
    // 아래쪽을 비워 16칸 높이로 맞추고, 그림을 세로 가운데로
    var pad = Math.floor((16 - rows.length) / 2);
    var full = [];
    for (var i = 0; i < pad; i++) full.push('');
    full = full.concat(rows);
    return svg(16, 16, rectsFromRows(full, function (ch) { return COLOR[ch]; }), 'px-icon');
  }

  function categoryIcon(category) {
    return icon(CATEGORY[category] || 'box');
  }

  /* ---------- 풀숲 배틀 땅 풍경 (112×64칸) ---------- */
  var W = 112;
  var H = 64;
  var SKY = {
    sunny:  { sky: '#4d7fc0', far: '#3d6aa6', cloud: '#dfe7f2' },
    cloudy: { sky: '#4a4560', far: '#3e3a52', cloud: '#8e86a3', cloud2: '#b9b2c9' },
    rain:   { sky: '#2a2638', far: '#232031', cloud: '#5a5470', cloud2: '#6f688a', drop: '#6aa6e0' }
  };

  function px(x, y, w, h, fill) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"/>';
  }

  function cloud(x, y, size, fill, fill2) {
    // 계단 모양 구름
    var s = size;
    return px(x + s, y, s * 3, s, fill2 || fill) +
      px(x, y + s, s * 5, s, fill) +
      px(x + s, y + s * 2, s * 4, s, fill);
  }

  function scene(weather, restDay) {
    var c = SKY[weather] || SKY.sunny;
    var b = '';
    // 하늘 (띠 두 개, 그라데이션 아님)
    b += px(0, 0, W, 22, c.far);
    b += px(0, 22, W, 14, c.sky);
    if (weather === 'sunny') {
      // 해: 계단 원
      b += px(92, 5, 6, 1, '#f2c94c') + px(90, 6, 10, 1, '#f2c94c') + px(89, 7, 12, 5, '#f2c94c') +
        px(90, 12, 10, 1, '#f2c94c') + px(92, 13, 6, 1, '#f2c94c') + px(91, 7, 3, 2, '#fff3c4');
      b += cloud(14, 8, 2, c.cloud);
      b += cloud(50, 14, 1, c.cloud);
    } else {
      b += cloud(4, 4, 3, c.cloud, c.cloud2);
      b += cloud(44, 8, 3, c.cloud, c.cloud2);
      b += cloud(80, 3, 3, c.cloud, c.cloud2);
    }
    // 먼 언덕 (울퉁불퉁한 위쪽)
    var hills = '#2f5d3a';
    for (var x = 0; x < W; x += 4) {
      var top = 30 + Math.round(Math.sin(x / 9) * 2 + Math.sin(x / 4) * 1);
      b += px(x, top, 4, 36 - top, hills);
    }
    // 풀밭
    b += px(0, 36, W, H - 36, '#3f8f3a');
    // 풀 무늬: 엇갈린 줄
    for (var gy = 38; gy < H; gy += 5) {
      for (var gx = (gy % 2 ? 0 : 3); gx < W; gx += 7) {
        b += px(gx, gy, 1, 2, '#2f6e2c') + px(gx + 2, gy, 1, 2, '#2f6e2c') + px(gx + 1, gy + 1, 1, 1, '#2f6e2c');
      }
    }
    // 긴 풀숲 (앞쪽 양옆)
    [[2, 44], [10, 48], [96, 46], [104, 50]].forEach(function (p) {
      b += px(p[0], p[1] + 2, 8, 6, '#2f7a32') + px(p[0] + 1, p[1], 1, 2, '#5cc24a') + px(p[0] + 4, p[1] - 1, 1, 3, '#5cc24a') +
        px(p[0] + 6, p[1] + 1, 1, 1, '#5cc24a');
    });
    // 발판 (타원)
    var cx = 56;
    var cy = 54;
    var rows = [[22, 0], [28, 1], [31, 2], [32, 3], [32, 4], [31, 5], [28, 6], [22, 7]];
    rows.forEach(function (r, i) {
      var half = r[0];
      var y = cy - 4 + i;
      var fill = i < 2 ? '#e0cf98' : i < 6 ? '#c9b27a' : '#8a7448';
      b += px(cx - half, y, half * 2, 1, fill);
    });
    // 비
    if (weather === 'rain') {
      for (var ry = 0; ry < H; ry += 6) {
        for (var rx = (ry / 6) % 2 ? 3 : 0; rx < W; rx += 9) {
          b += px(rx + 2, ry, 1, 3, c.drop);
        }
      }
    }
    // 쉬는 날 팻말 (글자는 화면이 위에 얹는다)
    if (restDay) {
      b += px(86, 40, 2, 12, '#6b4626') + px(100, 40, 2, 12, '#6b4626') +
        px(82, 32, 24, 10, '#a0723e') + px(82, 32, 24, 1, '#c99a5e') + px(82, 41, 24, 1, '#6b4626');
    }
    return svg(W, H, b, 'px-scene');
  }

  return { icon: icon, categoryIcon: categoryIcon, scene: scene, SCENE_W: W, SCENE_H: H };
})();
