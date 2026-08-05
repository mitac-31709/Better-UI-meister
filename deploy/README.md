# Cloudflare へのデプロイ

Meister Management System のフォークを Cloudflare Workers（静的資産つき）で公開する。
データは元アプリ（`https://meister.tokyo-ct.org`）から取る。

- 公開 URL: `https://meister-reports-fork.mitac31709.workers.dev`
- Worker 名: `meister-reports-fork`
- アカウント: `Mitac31709@gmail.com's Account`（`ca0ec10c7f6f85ea5700ca86e63e580d`）

**認証は利用者ごと。** 誰でも自分の元アプリのアカウントでログインできる。
Worker は資格情報を保存しない。共有の資格情報も持たない。

## なぜ Worker が要るのか

元アプリは Rails のサーバサイドレンダリングで、**JSON の口がほぼ無い**。

| 元アプリのパス | 返すもの |
| --- | --- |
| `/dashboard` `/reports` `/orders` `/equipments` `/loans` `/notifications` | HTML |
| `/notifications/unread_count` | **JSON**（`{"count":0}`）— 唯一 |
| `/reports/:id/auto_save` | POST 用。JSON を受ける（このフォークからは呼ばない） |

加えてブラウザから直接は呼べない。CORS ヘッダが無く、セッション Cookie は
`HttpOnly` + `SameSite=Lax` なので、別オリジンの静的ページからは送れない。

そこで Worker が間に入る。利用者の資格情報で Devise にログインし、
各画面の HTML を取って JSON にして返す。

```
ブラウザ ──/api/orders──▶ Worker ──セッション + /orders (HTML)──▶ 元アプリ
         ◀────JSON───────         ◀────HTML───────────────────
```

## 認証の仕組み

1. 画面のログインフォームが `POST /api/session` に `{ email, password }` を送る
2. Worker が元アプリの Devise にそのまま中継する
3. 返ってきた Rails のセッション Cookie を **AES-GCM で封印**して、
   自ドメインの `mms_session` Cookie に入れる（`HttpOnly` `Secure` `SameSite=Lax`）
4. 以降の `/api/*` はその Cookie を解いて元アプリを叩く

資格情報は 2 の中継にしか使わず、どこにも保存しない。鍵は `SESSION_SECRET`。
Worker 側に状態を持たないので KV も D1 も要らない。

**取得結果はキャッシュしない。** 利用者ごとの内容なので、Worker のアイソレートに
共有で置くと他人のデータが混ざる。

### ログアウトの限界（元アプリの性質）

元アプリのセッションは Rails の `cookie_store` で、中身が Cookie 自体に入っている。
そのため**サインアウトしても発行済みの Cookie 値は無効にならない**。実測:

```
サインアウト後に新しい Cookie で /reports  → 302 → /users/sign_in
サインアウト前に保存した古い Cookie で /reports → 200
```

サーバ側に破棄できる状態が無いので、ここでは直せない。できるのは次の 3 つ。

- 元アプリのサインアウトを成立させ、結果を `DELETE /api/session` の応答に載せる
  （`originSignedOut`）。黙って失敗させない
- 自ドメインの Cookie を確実に消す
- 封印トークンの有効期限を **4 時間**に切って露出する時間を短くする

`mms_session` は `HttpOnly` なのでページの JavaScript からは読めない。

## API

| メソッド | パス | 中身 |
| --- | --- | --- |
| `POST` | `/api/session` | ログイン。`{ email, password }` |
| `DELETE` | `/api/session` | ログアウト。`originSignedOut` を返す |
| `GET` | `/api/me` | ログイン中の利用者（表示名は元アプリから読む） |
| `GET` | `/api/dashboard` | ダッシュボード |
| `GET` | `/api/reports` | 週報一覧 |
| `GET` | `/api/orders` | 注文 |
| `GET` | `/api/equipments` | 機材 |
| `GET` | `/api/loans` | 貸出 |
| `GET` | `/api/notifications` | 通知 |
| `GET` | `/api/notifications/unread_count` | 元アプリの JSON をそのまま通す |
| `GET` | `/api/health` | 設定の確認（秘密は返さない） |

画面系の応答は共通で `source` `origin` `fetchedAt` を持つ。例（`/api/orders`）:

```json
{
  "source": "live",
  "origin": "https://meister.tokyo-ct.org/orders",
  "fetchedAt": "2026-08-05T13:05:00.000Z",
  "columns": [{ "label": "商品" }, { "label": "単価" }, { "label": "数量" },
              { "label": "合計" }, { "label": "ステータス" }, { "label": "作成日" }],
  "empty": { "title": "注文がありません", "body": "新しい注文を作成して始めましょう。" },
  "orders": []
}
```

未ログインは全て `401` + `{ "code": "unauthenticated" }`。

## 構成

| ファイル | 中身 |
| --- | --- |
| `src/parse.js` | 週報の HTML → JSON。ネットワークに触らない純関数 |
| `src/parse-pages.js` | 他 5 画面と nav の HTML → JSON |
| `src/meister.js` | Devise ログイン／サインアウト、HTML 取得 |
| `src/session.js` | セッション Cookie の封印と開封（AES-GCM） |
| `src/index.js` | ルーティング、静的資産の配信 |
| `wrangler.jsonc` | Worker の設定 |
| `build.sh` | `../fork` から公開するファイルだけ `public/` に揃える |
| `test/parse.test.mjs` | 週報のパーサを実 HTML で検証 |
| `test/parse-pages.test.mjs` | 他 5 画面のパーサを実 HTML で検証 |
| `test/api.test.mjs` | 動いているエンドポイントに対して検証 |
| `test/e2e.py` | ログインから 6 画面・ログアウトまで実ブラウザで通す |

`public/` は生成物なのでコミットしない。`design.md` / `README.md` /
`test_responsive.py` は配らない。

`wrangler.jsonc` の要点。

- `assets.not_found_handling: "single-page-application"` — 画面はクライアント側で
  ルーティングするので、資産に無いパスは `index.html` を返す
- `assets.run_worker_first: ["/api/*"]` — API は必ず Worker に通す。
  資産が先に配られると `/api/*` が SPA フォールバックで `index.html` になる

## デプロイ

```bash
cd tasks/2026-08-05-meister-reports-ui-fork/deploy
export CLOUDFLARE_ACCOUNT_ID=ca0ec10c7f6f85ea5700ca86e63e580d
./build.sh
npx wrangler deploy
```

秘密は 1 つだけ。

```bash
printf '%s' "$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" \
  | npx wrangler secret put SESSION_SECRET
```

鍵を差し替えると、既に発行済みの `mms_session` は全て開けなくなり、
利用者は再ログインになる。漏えいが疑われるときはこれで一括失効できる。

## テスト

```bash
# パーサ（ネットワーク不要）
node --test test/parse.test.mjs test/parse-pages.test.mjs

# API。元アプリに実際にログインするので資格情報が必要
MEISTER_EMAIL=... MEISTER_PASSWORD=... node --test test/api.test.mjs
BASE=https://meister-reports-fork.mitac31709.workers.dev \
  MEISTER_EMAIL=... MEISTER_PASSWORD=... node --test test/api.test.mjs

# ログインから 6 画面・ログアウトまで実ブラウザで
MEISTER_EMAIL=... MEISTER_PASSWORD=... python3 test/e2e.py
python3 test/e2e.py --base https://meister-reports-fork.mitac31709.workers.dev
```

ローカル開発は `.dev.vars` を置いて `npx wrangler dev --port 8788`。

```
SESSION_SECRET='...'
```

**値は必ず引用する。** `.dev.vars` は dotenv 形式で読まれるため、引用しないと
`#` 以降が捨てられる。実際にこれで 127 文字のパスワードが 40 文字になり、
元アプリに拒否された。

## 実装で踏んだところ

**ログアウトが元アプリに効いていなかった。** Rails のセッションは Cookie に入って
いて応答ごとに再発行される。CSRF トークンはその応答で返った Cookie と対なので、
元の Cookie で `POST /users/sign_out` を投げると 422 になる。`/dashboard` の応答で
更新された Cookie を使う必要があった。結果を握り潰していたので気づけず、
`DELETE /api/session` の応答に載せるようにした。

**静的資産が Worker より先に配られる。** 既定では資産に一致するリクエストは
Worker を通らない。`run_worker_first` で API だけ先に通す。

**Rails 7 + Turbo はログイン後のリダイレクトに 303 を返す。** 302 だけを見ていて
「応答が想定外」で落ちた。3xx をまとめて受ける。

**422 の理由が 2 通りある。** メールアドレス／パスワードの不一致と CSRF の
不成立が同じ 422 で返る。まとめて「資格情報の拒否」と表示していて原因が読めなかった。

**ログインの入力ミスで既存のセッションが落ちていた。** 401 を一律で Cookie 削除に
していたため。`ApiError` に `clearSession` を持たせ、失効のときだけ落とす。

**デプロイ直後は secret の反映に数秒かかる。** 直後にテストを走らせると
未設定として扱われる瞬間があった。

**テストが本番だけで落ちた。** `node --test` の並行実行で、共有していた Cookie 変数を
書き換えるテストと使うテストが混ざっていた。ローカルは速くて隠れていた。
`describe(..., { concurrency: 1 })` にして、Cookie を書き換えない形に直した。

## 分かっていないこと

**行やカードの解析は実データで検証できていない。** 取得できるアカウントは
どのリストも 0 件で、データが入った状態を一度も見ていない。見出し・列見出し・
リード文・空状態の文言は実 HTML で検証済み。行の形は公開されている Stimulus の
実装（`#report_<id>` `#order_<id>` で行を引く）と列の順序から組み、
テストでは実 HTML の器に合成した行を差し込んで検証している。

**書き込みはしない。** 本文の自動保存と削除は元アプリに送らない。実データのときは
本文を読み取り専用にして画面にそう出す。`?demo=1` の同梱データでのみ編集と削除の
挙動を確かめられる。

**`/orders/new` はフォークしていない。** 注文の作成フォームは元アプリへ案内する。

**TA / 管理者画面はフォークしていない。** 検証に使えたアカウントでは
`/ta/**` `/admin/**` が `/dashboard` にリダイレクトされるため、実物を見ていない。
