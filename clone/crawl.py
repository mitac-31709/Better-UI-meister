#!/usr/bin/env python3
"""meister.tokyo-ct.org を丸ごと取得する。

- `Meister_MailAddress` / `Meister_Password` があれば Devise にログインしてから巡回する
- GET のみ。ログアウトや `data-turbo-method` 付きのリンクは踏まない
- 同一ホストのみ。ページと参照アセットを `site/` 以下に保存する
- 結果は `manifest.json` に残す

    python3 crawl.py [--out site] [--max-pages 400] [--base URL]
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from pathlib import Path

BASE = "https://meister.tokyo-ct.org"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# 副作用のあるパスは踏まない。Rails 側は POST/DELETE だが念のためリンクごと除外する。
SKIP_PATH = re.compile(
    r"/users/sign_out|/sign_out|/logout"
    r"|/password/new|/password/edit"          # パスワード再設定メールを飛ばさない
    r"|/mark_all_as_read|/mark_as_read"
    r"|\.(zip|xlsx|csv|pdf)$",
    re.I,
)
ASSET_EXT = re.compile(r"\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map)$", re.I)

# リンクから辿れないが到達面として記録したいパス。
# ロール別の名前空間は権限がなければリダイレクトされるが、「どう弾かれるか」も
# クローンの一部なので manifest に残す。
EXTRA_SEEDS = [
    "/dashboard",
    "/reports", "/reports/new",
    "/orders", "/orders/new",
    "/loans", "/equipments", "/notifications",
    "/notifications/unread_count",
    "/ta", "/ta/reports", "/ta/orders",
    "/admin", "/admin/reports", "/admin/orders", "/admin/users",
]


def make_opener() -> urllib.request.OpenerDirector:
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [
        ("User-Agent", UA),
        ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
        ("Accept-Language", "ja,en-US;q=0.9,en;q=0.8"),
    ]
    return op


def fetch(op, url: str) -> tuple[int, bytes, str, str]:
    """(status, body, final_url, content_type) を返す。例外は投げない。"""
    try:
        r = op.open(url, timeout=30)
        return r.status, r.read(), r.url, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.url, e.headers.get("Content-Type", "")
    except Exception as e:  # noqa: BLE001 - ネットワーク断もログに残して続行する
        print(f"  ! {url}: {e}", file=sys.stderr)
        return 0, b"", url, ""


def sign_in(op) -> tuple[bool, str, str | None]:
    """(成功, メッセージ, ログイン後の着地 URL) を返す。

    着地 URL は巡回の起点として使う。ここを起点にしないと、未ログインでも見える
    トップページからしか辿れず、認証が通っていても中身に到達できない。
    """
    email = os.environ.get("Meister_MailAddress")
    password = os.environ.get("Meister_Password")
    if not email or not password:
        return False, "Meister_MailAddress / Meister_Password が未設定", None

    status, body, _, _ = fetch(op, f"{BASE}/users/sign_in")
    if status != 200:
        return False, f"サインイン画面が {status}", None
    m = re.search(r'name="authenticity_token"\s+value="([^"]+)"', body.decode("utf-8", "replace"))
    if not m:
        return False, "authenticity_token が見つからない", None

    data = urllib.parse.urlencode([
        ("authenticity_token", m.group(1)),
        ("remember", "true"),
        ("user[email]", email),
        ("user[password]", password),
        ("user[remember_me]", "0"),
        ("commit", "ログイン"),
    ]).encode()
    req = urllib.request.Request(
        f"{BASE}/users/sign_in", data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "Origin": BASE, "Referer": f"{BASE}/users/sign_in"})
    try:
        r = op.open(req, timeout=30)
        html, landing = r.read().decode("utf-8", "replace"), r.url
    except urllib.error.HTTPError as e:
        html, landing = e.read().decode("utf-8", "replace"), e.url

    if "メールアドレスまたはパスワードが違います" in html:
        return False, "サーバがメールアドレス／パスワードを拒否", None
    if landing.rstrip("/").endswith("/users/sign_in"):
        return False, "ログイン後もサインイン画面に留まっている", None
    return True, f"ログイン成功（着地: {landing}）", landing


def local_path(out: Path, url: str, ctype: str = "") -> Path:
    default_ext = ".json" if "json" in ctype else ".html"
    p = urllib.parse.urlsplit(url)
    path = p.path
    if path.endswith("/") or not path:
        path += "index" + default_ext
    if p.query:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", p.query)[:80]
        root, ext = os.path.splitext(path)
        path = f"{root}__{safe}{ext or default_ext}"
    if not os.path.splitext(path)[1]:
        path += default_ext
    return out / path.lstrip("/")


def extract_links(html: str, base_url: str) -> tuple[set[str], set[str]]:
    """(ページ候補, アセット) を返す。破壊的なリンクは落とす。"""
    pages, assets = set(), set()

    for tag in re.findall(r"<a\b[^>]*>", html, re.I):
        if re.search(r'data-turbo-method\s*=\s*"(delete|patch|put|post)"', tag, re.I):
            continue
        if re.search(r'rel\s*=\s*"[^"]*nofollow', tag, re.I):
            continue
        m = re.search(r'href\s*=\s*"([^"]+)"', tag, re.I)
        if m:
            pages.add(urllib.parse.urljoin(base_url, m.group(1)))

    for attr in ("src", "href"):
        for m in re.finditer(rf'<(?:link|script|img|source)\b[^>]*{attr}\s*=\s*"([^"]+)"', html, re.I):
            assets.add(urllib.parse.urljoin(base_url, m.group(1)))
    for m in re.finditer(r'<turbo-frame\b[^>]*src\s*=\s*"([^"]+)"', html, re.I):
        pages.add(urllib.parse.urljoin(base_url, m.group(1)))
    # importmap の JSON も辿る
    for m in re.finditer(r'"(/assets/[^"]+\.js)"', html):
        assets.add(urllib.parse.urljoin(base_url, m.group(1)))

    return pages, assets


def keep(url: str) -> bool:
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ("http", "https"):
        return False
    if p.netloc != urllib.parse.urlsplit(BASE).netloc:
        return False
    return not SKIP_PATH.search(p.path)


def crawl(op, seeds: list[str], out: Path, asset_out: Path, max_pages: int,
          delay: float, label: str) -> list[dict]:
    """seeds を起点に同一ホストを幅優先で辿る。

    ページは `out` 以下、アセットは `asset_out` 以下に保存する。アセットは
    内容ハッシュ付きのファイル名なのでフェーズ間で共有できる。ページ側は
    `/assets/...` の絶対パスで参照するため、`asset_out` の親を
    ドキュメントルートにすればどのフェーズからでも解決できる。
    """
    print(f"--- {label} ---")
    out.mkdir(parents=True, exist_ok=True)

    queue: deque[str] = deque(seeds)
    seen: set[str] = set()
    assets: set[str] = set()
    records: list[dict] = []

    while queue and len(records) < max_pages:
        url, _ = urllib.parse.urldefrag(queue.popleft())
        if url in seen or not keep(url):
            continue
        seen.add(url)

        status, body, final_url, ctype = fetch(op, url)
        print(f"  {status} {url}")
        rec = {"url": url, "status": status, "final_url": final_url,
               "content_type": ctype, "bytes": len(body),
               "redirected": urllib.parse.urldefrag(final_url)[0] != url}

        if status == 200 and body:
            # 保存先はリクエストした URL 側。リダイレクトされた場合も
            # 「そのパスを叩くと何が返るか」を残したいので上書きしない。
            dest = local_path(out, url, ctype)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
            rec["saved"] = str(dest.relative_to(out))
            if "html" in ctype:
                new_pages, new_assets = extract_links(body.decode("utf-8", "replace"), final_url)
                for u in new_pages:
                    u, _ = urllib.parse.urldefrag(u)
                    if u not in seen and keep(u) and not ASSET_EXT.search(urllib.parse.urlsplit(u).path):
                        queue.append(u)
                assets |= {a for a in new_assets if keep(a)}

        records.append(rec)
        time.sleep(delay)

    fresh = 0
    for a in sorted(assets):
        a, _ = urllib.parse.urldefrag(a)
        dest = local_path(asset_out, a)
        if dest.exists():           # 内容ハッシュ付きなので取り直さない
            continue
        status, body, _, ctype = fetch(op, a)
        if status == 200 and body:
            dest = local_path(asset_out, a, ctype)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
            fresh += 1
        records.append({"url": a, "status": status, "content_type": ctype,
                        "bytes": len(body), "kind": "asset"})
    print(f"  assets: {len(assets)} 参照 / {fresh} 新規取得")

    return records


def main() -> int:
    global BASE

    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site")
    ap.add_argument("--max-pages", type=int, default=400)
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument("--base", default=BASE, help="巡回対象のオリジン（テスト用）")
    args = ap.parse_args()
    BASE = args.base.rstrip("/")

    out = Path(args.out).resolve()

    # 1 パス目は未ログイン。ログイン後は `/` と `/users/sign_in` が
    # ダッシュボードへ飛ぶため、公開状態の姿は先に取らないと失われる。
    public_records = crawl(make_opener(), [BASE + "/", BASE + "/users/sign_in"],
                           out / "public", out, args.max_pages, args.delay,
                           label="未ログイン")

    op = make_opener()
    ok, msg, landing = sign_in(op)
    print(f"login: {msg}")

    auth_records: list[dict] = []
    if ok:
        seeds = [landing] if landing else []
        seeds += [BASE + p for p in EXTRA_SEEDS]
        auth_records = crawl(op, seeds, out / "auth", out, args.max_pages,
                             args.delay, label="ログイン後")

    records = ([dict(r, phase="public") for r in public_records]
               + [dict(r, phase="auth") for r in auth_records])
    manifest = {
        "base": BASE,
        "authenticated": ok,
        "login_message": msg,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pages": len([r for r in records if r.get("kind") != "asset"]),
        "assets": len([r for r in records if r.get("kind") == "asset"]),
        "records": records,
    }
    Path("manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"pages={manifest['pages']} assets={manifest['assets']} -> manifest.json")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
