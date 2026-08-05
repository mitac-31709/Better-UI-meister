#!/usr/bin/env python3
"""ログインから各画面までを実ブラウザで通す。

元アプリに実際にログインするので、資格情報が必要。環境変数から読む。

    MEISTER_EMAIL=... MEISTER_PASSWORD=... python3 test/e2e.py [--base http://127.0.0.1:8788]

見ているのは次のとおり。

  - 未ログインだとログイン画面が出て、アプリ本体は出ない
  - 誤った資格情報では元アプリのエラー文がそのまま出る
  - 正しい資格情報でログインでき、表示名が元アプリから来る
  - 6 画面すべてが実データで描画され、コンソールエラーが出ない
  - 画面遷移で URL が変わり、リロードしてもログインが保たれる
  - ログアウトするとセッションが落ちて API が 401 になる
"""

from __future__ import annotations

import argparse
import os
import sys

from playwright.sync_api import sync_playwright

ROUTES = [
    ("/dashboard", "ダッシュボード"),
    ("/orders", "注文"),
    ("/equipments", "利用可能な機材"),
    ("/loans", "機材貸出"),
    ("/reports", "週報一覧"),
    ("/notifications", "通知")
]

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8788")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    email = os.environ.get("MEISTER_EMAIL") or os.environ.get("Meister_MailAddress")
    password = os.environ.get("MEISTER_PASSWORD") or os.environ.get("Meister_Password")
    if not email or not password:
        print("MEISTER_EMAIL / MEISTER_PASSWORD が必要です", file=sys.stderr)
        return 2

    errors: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1280, "height": 900})

        def on_console(m):
            if m.type != "error":
                return
            # 未ログイン確認・誤資格情報・ログアウト後の確認で /api/* が
            # 401 を返すのは想定どおり。ブラウザはそれもコンソールに出す。
            url = (m.location or {}).get("url", "")
            if "/api/" in url and "401" in m.text:
                return
            errors.append(f"{m.type}: {m.text} ({url})")

        page.on("console", on_console)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # 1. 未ログイン
        page.goto(base + "/", wait_until="load")
        page.wait_for_selector("#signin:not([hidden])", timeout=15000)
        check(page.is_hidden("#app"), "未ログインなのにアプリ本体が出ている")
        check("ログイン" in page.inner_text("#signin"), "ログイン画面の文言が無い")
        print("  未ログイン: ログイン画面が出る")

        # 2. 誤った資格情報。元アプリの文言をそのまま見せる。
        page.fill("#email", email)
        page.fill("#password", "definitely-not-the-password")
        page.click("#signin-submit")
        page.wait_for_selector("#signin-error:not([hidden])", timeout=25000)
        message = page.inner_text("#signin-error")
        check("メールアドレスまたはパスワード" in message,
              f"誤った資格情報のエラー文が想定外: {message!r}")
        check(page.is_hidden("#app"), "ログイン失敗なのにアプリ本体が出た")
        print(f"  誤った資格情報: {message}")

        # 3. 正しい資格情報
        page.fill("#password", password)
        page.click("#signin-submit")
        page.wait_for_selector("#app:not([hidden])", timeout=30000)
        name = page.inner_text("#user-name")
        check(bool(name.strip()), "ログイン後に表示名が空")
        check(page.input_value("#password") == "", "パスワード欄が残っている")
        print(f"  ログイン成功: 表示名「{name}」")

        # 4. 各画面を実データで描画する。
        # レールは 1024px 未満で折りたたまれるので、要素の click() を直接呼ぶ。
        # ルータは document 上の委譲リスナなので実際のクリックと同じ経路を通る。
        for route, heading in ROUTES:
            page.eval_on_selector(f'a[data-route="{route}"]', "el => el.click()")
            page.wait_for_function(
                "([r]) => location.pathname === r", arg=[route], timeout=15000)
            # ログイン画面にも h1 があるので、本文側に限って待つ
            page.wait_for_selector("#view h1", timeout=15000)
            page.wait_for_timeout(600)
            h1 = page.inner_text("#view h1")
            check(h1.strip() == heading, f"{route} の見出しが {h1!r}（{heading!r} を期待）")
            kind = page.get_attribute("#data-source", "data-kind")
            check(kind == "live", f"{route} の出どころが {kind}（live を期待）")
            print(f"  {route:14} 見出し「{h1}」 出どころ {kind}")

        # 5. リロードしてもログインが保たれる
        page.reload(wait_until="load")
        page.wait_for_selector("#app:not([hidden])", timeout=20000)
        check(page.is_hidden("#signin"), "リロードでログインが切れた")
        print("  リロード: ログインが保たれる")

        # 6. ログアウト
        page.eval_on_selector("#logout", "el => el.click()")
        page.wait_for_selector("#signin:not([hidden])", timeout=25000)
        print("  ログアウト: ログイン画面に戻る")

        after = page.evaluate(
            "async () => (await fetch('/api/reports', "
            "{ headers: { Accept: 'application/json' } })).status")
        check(after == 401, f"ログアウト後の /api/reports が {after}（401 を期待）")
        print(f"  ログアウト後の /api/reports: {after}")

        browser.close()

    failures.extend(f"console: {e}" for e in errors)

    print()
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print("PASS: ログイン画面・誤資格情報のエラー・ログイン・6 画面の実データ描画・"
          "リロード後の維持・ログアウト")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
