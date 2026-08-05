#!/usr/bin/env python3
"""crawl.py の巡回を、Devise を模したローカルサーバで検証する。

本番の認証が通らない状態でも「ログイン成功後にサイト全体を辿れるか」を確かめるため、
最小の偽サーバを立てて crawl.py をサブプロセスで走らせる。

    python3 test_crawl.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EMAIL = "s12345@tokyo-ct.ac.jp"
PASSWORD = "$&test-password!#42"
TOKEN = "test-authenticity-token"
SESSION = "fake-session-value"

# path -> (認証要否, HTML)
PAGES = {
    "/": (False, '<a href="/users/sign_in">ログイン</a>'
                 '<link rel="stylesheet" href="/assets/app.css">'),
    "/reports": (True, '<a href="/reports/1">週報 1</a>'
                       '<a href="/reports/2">週報 2</a>'
                       '<a href="/notifications">通知</a>'
                       '<a href="/users/sign_out" data-turbo-method="delete">ログアウト</a>'
                       '<a href="/notifications/mark_all_as_read">すべて既読</a>'
                       '<turbo-frame id="side_panel" src="/reports/1"></turbo-frame>'),
    "/reports/1": (True, '<a href="/reports">戻る</a>'),
    "/reports/2": (True, '<a href="/reports">戻る</a>'),
    "/notifications": (True, '<a href="/reports">週報へ</a>'
                             '<a href="https://example.com/外部">外部リンク</a>'),
}
ASSETS = {"/assets/app.css": b"body{color:#123}"}

# 踏まれたら失敗とみなすパス
FORBIDDEN = {"/users/sign_out", "/notifications/mark_all_as_read"}
touched_forbidden: list[str] = []


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # 出力を汚さない
        pass

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        return SESSION in self.headers.get("Cookie", "")

    def do_GET(self):  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path in FORBIDDEN:
            touched_forbidden.append(path)
            return self._send(200, b"should not be crawled", "text/html")

        if path == "/users/sign_in":
            body = (f'<form action="/users/sign_in" method="post">'
                    f'<input type="hidden" name="authenticity_token" value="{TOKEN}" />'
                    f'</form>').encode()
            return self._send(200, body, "text/html; charset=utf-8")

        if path in ASSETS:
            return self._send(200, ASSETS[path], "text/css")

        if path in PAGES:
            needs_auth, html = PAGES[path]
            if needs_auth and not self._authed():
                return self._send(302, b"", "text/html", {"Location": "/users/sign_in"})
            return self._send(200, f"<html><body>{html}</body></html>".encode(),
                              "text/html; charset=utf-8")

        return self._send(404, b"not found", "text/html")

    def do_POST(self):  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path != "/users/sign_in":
            return self._send(404, b"not found", "text/html")

        length = int(self.headers.get("Content-Length", 0))
        form = urllib.parse.parse_qs(self.rfile.read(length).decode())
        token = form.get("authenticity_token", [""])[0]
        email = form.get("user[email]", [""])[0]
        password = form.get("user[password]", [""])[0]

        if token != TOKEN:
            return self._send(422, "CSRF".encode(), "text/html; charset=utf-8")
        if email != EMAIL or password != PASSWORD:
            return self._send(
                422, "メールアドレスまたはパスワードが違います。".encode(),
                "text/html; charset=utf-8")
        return self._send(302, b"", "text/html",
                          {"Location": "/reports",
                           "Set-Cookie": f"_meister_management_system_session={SESSION}; Path=/"})


def run_crawl(base: str, env: dict, workdir: Path) -> tuple[int, str, dict]:
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "crawl.py"),
         "--base", base, "--out", "site", "--delay", "0", "--max-pages", "50"],
        cwd=workdir, env=env, capture_output=True, text=True, timeout=120)
    manifest_path = workdir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    return proc.returncode, proc.stdout + proc.stderr, manifest


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    threading.Thread(target=server.serve_forever, daemon=True).start()

    failures: list[str] = []

    # --- 1. 正しい資格情報 ---------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        env = {**os.environ, "Meister_MailAddress": EMAIL, "Meister_Password": PASSWORD}
        code, output, manifest = run_crawl(base, env, workdir)
        print("--- 認証あり ---")
        print(output.strip())

        if code != 0:
            failures.append(f"終了コードが {code}（0 を期待）")
        if not manifest.get("authenticated"):
            failures.append("manifest.authenticated が False")

        saved = {p.relative_to(workdir / "site").as_posix()
                 for p in (workdir / "site").rglob("*") if p.is_file()}
        # ログイン後に辿れるべきページ
        for expected in ("auth/reports.html", "auth/reports/1.html",
                         "auth/reports/2.html", "auth/notifications.html"):
            if expected not in saved:
                failures.append(f"未取得: {expected}（取得済み: {sorted(saved)}）")
        # 未ログイン時の姿も別に残っていること
        for expected in ("public/index.html", "public/users/sign_in.html"):
            if expected not in saved:
                failures.append(f"未取得: {expected}（取得済み: {sorted(saved)}）")
        # アセットはフェーズ間で共有し、重複しないこと
        if "assets/app.css" not in saved:
            failures.append(f"共有アセットが未取得（取得済み: {sorted(saved)}）")
        if any(p.startswith(("public/assets/", "auth/assets/")) for p in saved):
            failures.append(f"アセットがフェーズ配下に重複している: {sorted(saved)}")
        if touched_forbidden:
            failures.append(f"踏んではいけないパスを踏んだ: {touched_forbidden}")
        if any("example.com" in r["url"] for r in manifest.get("records", [])):
            failures.append("外部ホストを取得している")
        if not any(r.get("phase") == "public" for r in manifest.get("records", [])):
            failures.append("manifest に public フェーズの記録がない")
        if not any(r.get("phase") == "auth" for r in manifest.get("records", [])):
            failures.append("manifest に auth フェーズの記録がない")

    # --- 2. 誤った資格情報 ---------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        env = {**os.environ, "Meister_MailAddress": EMAIL, "Meister_Password": "wrong"}
        code, output, manifest = run_crawl(base, env, workdir)
        print("--- 認証なし ---")
        print(output.strip())

        if code != 2:
            failures.append(f"認証失敗時の終了コードが {code}（2 を期待）")
        if manifest.get("authenticated"):
            failures.append("認証失敗なのに authenticated が True")
        if "拒否" not in manifest.get("login_message", ""):
            failures.append(f"login_message が想定外: {manifest.get('login_message')!r}")
        saved = {p.relative_to(workdir / "site").as_posix()
                 for p in (workdir / "site").rglob("*") if p.is_file()}
        if any(p.startswith("auth/") for p in saved):
            failures.append(f"認証失敗なのに auth/ を保存している: {sorted(saved)}")
        if "public/index.html" not in saved:
            failures.append("認証失敗時に公開ページも取れていない")

    server.shutdown()

    print()
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print("PASS: 認証後の全ページ巡回・除外パス・外部ホスト除外・失敗時の終了コード")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
