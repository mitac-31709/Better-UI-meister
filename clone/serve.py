#!/usr/bin/env python3
"""クローンした `site/` を、元サーバと同じ Content-Type で配信する。

取得した HTML には `<meta charset>` が無く、文字コードは HTTP ヘッダの
`Content-Type: text/html; charset=utf-8` だけで伝えられている。
`python3 -m http.server` はこのヘッダを付けないため、ブラウザが latin-1 と
解釈して日本語が文字化けする。HTML 側を書き換えるとクローンが元と別物に
なるので、配信側でヘッダを揃える。

    python3 serve.py [--port 8080] [--root site]
"""

from __future__ import annotations

import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 元サーバが返す Content-Type に合わせる
CHARSET_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
}


class Handler(SimpleHTTPRequestHandler):
    def guess_type(self, path):  # noqa: A003 - 基底クラスの名前に合わせる
        for ext, ctype in CHARSET_TYPES.items():
            if str(path).endswith(ext):
                return ctype
        return super().guess_type(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--root", default="site")
    args = ap.parse_args()

    handler = functools.partial(Handler, directory=args.root)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"serving {args.root} on http://localhost:{args.port}")
    print(f"  http://localhost:{args.port}/auth/reports.html")
    print(f"  http://localhost:{args.port}/public/index.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
