#!/usr/bin/env python3
"""index.html + assets + data/dd-data.js 를 파일 하나(dd4-helper.html)로 합친다.

폰처럼 폴더째 옮기기 어려운 곳에서는 이 파일 하나만 있으면 열린다.
실행: python3 scripts/build_single.py   (build_data.py 를 먼저 돌린 뒤)
--artifact <경로> 를 주면 <!doctype>/<html>/<head>/<body> 없이 본문만 쓴다(웹 게시용, 루트별 패트랩 파일은 따로 올림).
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def inline_js(path):
    # 인라인 <script> 안에서 '</' 가 태그를 닫지 않도록
    return path.read_text(encoding="utf-8").replace("</", "<\\/")


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "assets" / "style.css").read_text(encoding="utf-8")
    data = inline_js(ROOT / "data" / "dd-data.js")
    app = inline_js(ROOT / "assets" / "app.js")
    html = html.replace('<link rel="stylesheet" href="assets/style.css">', "<style>\n" + css + "</style>")
    html = html.replace('<script src="data/dd-data.js"></script>', "<script>\n" + data + "</script>")
    html = html.replace('<script src="assets/app.js"></script>', "<script>\n" + app + "</script>")
    meta = inline_js(ROOT / "data" / "handtraps" / "meta.js")
    html = html.replace('<script src="data/handtraps/meta.js"></script>', "<script>\n" + meta + "</script>")
    assert "assets/" not in html and "data/dd-data.js\"" not in html and "meta.js\"" not in html, "치환 실패"

    args = sys.argv[1:]
    if args[:1] != ["--artifact"]:
        # 한 파일 버전: 루트별 패트랩 파일도 전부 넣는다(따로 불러올 파일이 없도록)
        routes = "".join(inline_js(f) for f in sorted((ROOT / "data" / "handtraps").glob("[A-G]*.js")))
        html = html.replace("<script>\n" + app, "<script>\n" + routes + "</script>\n<script>\n" + app)
    if args[:1] == ["--artifact"]:
        head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
        body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
        head = re.sub(r'<meta (charset|name="viewport")[^>]*>\s*', "", head)
        title = re.search(r"<title>.*?</title>", head).group(0)
        head = head.replace(title, "")
        out = title + '\n<meta name="claude:viewport-fit-sides" content="cover">\n' + head.strip() + "\n" + body.strip() + "\n"
        Path(args[1]).write_text(out, encoding="utf-8")
        print("→", args[1])
    else:
        target = ROOT / "dd4-helper.html"
        target.write_text(html, encoding="utf-8")
        print("→", target.relative_to(ROOT), f"({target.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
