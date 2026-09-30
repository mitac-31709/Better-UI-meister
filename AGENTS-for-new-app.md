# AGENTS.md — Meister Management System フォークの保守

このフォークは、元アプリ **`https://meister.tokyo-ct.org`**（Rails のサーバサイド
レンダリング）の HTML を Worker が JSON に変換し、それを描画している。
つまり **元アプリの HTML の形に依存している**。元アプリが変われば壊れる。

この文書は、壊れたときに何をどう直すか、そもそも壊れにくく書くにはどうするかを
まとめたもの。クローンとフォークを実際に作る過程で踏んだことだけを書いている。
推測は「未検証」と明示する。

---

## 0. 最初に読むもの

| 見たいもの | 場所 |
| --- | --- |
| 元アプリの実 HTML（スナップショット） | `clone/site/` |
| 取得の経緯と元アプリの構造 | `clone/NOTES.md` |
| 元 UI の問題点と、フォークでの直し方の対応表 | `audit/HALLMARK_AUDIT.md`、`fork/README.md` |
| 設計システム（色・書体・余白・モーション） | `fork/design.md` |
| Worker と API の設計 | `deploy/README.md` |

**コードを触る前に `clone/site/` の実物を見ること。** 記憶や推測で HTML の形を
決めない。このリポジトリには元アプリの実 HTML がバイト単位で入っている。

---

## 1. 何を相手にしているか

### 元アプリの技術構成

- Rails 7 + Propshaft + importmap
- Hotwire（Turbo / Stimulus）、ActionCable（`report_edit_channel`）
- Tailwind CSS のビルド済み 1 ファイル + DaisyUI（`bg-base-*` などが混在）
- Devise 認証、セッションは **Rails の `cookie_store`**
- フォントは Inter のみ（日本語はブラウザのフォールバック任せ）

### JSON を返す口はほぼ無い

| 元アプリのパス | 返すもの |
| --- | --- |
| `/dashboard` `/reports` `/orders` `/equipments` `/loans` `/notifications` | HTML |
| `/reports/:id` | HTML（Turbo Frame。タイトル・提出期限・作業期間・コメント。本文項目は無い） |
| `/reports/:id/edit` | HTML（Turbo Frame。`data-field-name` 付きの本文項目） |
| `/notifications/unread_count` | **JSON** `{"count":0}` — 唯一 |
| `/reports/:id/auto_save` | POST で JSON を受ける（このフォークからは呼ばない） |

### なぜ Worker（BFF）が要るのか

ブラウザから元アプリを直接叩けない。理由は 2 つ。

1. CORS ヘッダが無い
2. セッション Cookie が `HttpOnly` + `SameSite=Lax` — 別オリジンの静的ページから送れない

そこで Worker が中に入る。

```
ブラウザ ──/api/orders──▶ Worker ──セッション + GET /orders (HTML)──▶ 元アプリ
         ◀────JSON───────        ◀────HTML─────────────────────────
```

**HTML → JSON の変換が全ての要**。ここが元アプリの変更を受ける唯一の面なので、
ここを守る作りにする。

---

## 2. 変更に強く書くための原則

順番に重要度が高い。既存コードもこの原則で書いてある。破るときは理由を書くこと。

### 原則 1: CSS クラスを鍵にしない

**Tailwind のクラスはこのアプリで最も変わりやすい。** デザイン調整のたびに変わる。
クラスを鍵にしたパーサは、変更のたびに、しかも**静かに** `null` を返して壊れる。

実際に踏んだ例。他の画面の見出しは `text-3xl font-bold text-gray-900` なのに、
貸出だけ `text-2xl font-semibold text-gray-900` だった。リード文も
`text-gray-600 mt-2` ではなく `mt-2 text-sm text-gray-700`。クラスで引いていたら
貸出だけ見出しが取れない実装になっていた。

鍵にしてよいもの、悪いものは次のとおり。

| 優先 | 鍵 | 理由 |
| --- | --- | --- |
| ◎ | 元アプリ自身の JS が使っている `id` / `data-*` | アプリが壊れるので簡単には変えられない |
| ◎ | 意味のあるタグと DOM 上の位置（`<main>` 内の最初の `<h1>`、`<thead>` の `<th>` の順序） | 構造が変わらない限り効く |
| ○ | 表示文言（空状態のメッセージなど） | 変わるが、変わったら気づくべき対象でもある |
| × | Tailwind / DaisyUI のクラス | 見た目の調整で変わる |
| × | 空白・改行・インデント | ERB の整形で変わる |

「元アプリ自身の JS が使っているもの」は `clone/site/assets/controllers/` を読めば
分かる。ここには**ビルド済みの Stimulus コントローラが全ページ共通で公開されている**。
権限が無くて画面を開けなくても、その画面の挙動はここから読める。実際、行の id 規約
（`#report_<id>` `#order_<id>`）はこれで分かった。

### 原則 2: 判定できないものを断定しない

取れなかったら `null` を返す。形を埋めるために値を作らない。

```js
// 悪い: 既読か分からないのに false と言い切る
read: html.includes('unread') ? false : true

// 良い: 判定材料が無ければ null。描画側が「—」を出す
read: /data-read="(true|false)"/.exec(html)?.[1] === 'true' ? true
    : /data-read="false"/.test(html) ? false
    : null
```

金額も同じ。`¥1,200（税込）` のように数値にできない文字列が来たら `null` にして、
描画側で**元の文字列をそのまま出す**。`0` にしてはいけない。
ただし `¥0` は正当な 0 円なので `null` と混同しないこと。この 2 つの取り違えは
`fork/test_pages.py` で固定してある。

### 原則 3: 語彙を作らない

ステータスなどの語彙は、**実際に観測できたものだけ**を使う。
今のフォークは週報のステータスを `未完了` / `完了` の 2 値しか持っていない。
「下書き」「差し戻し」といった中間状態は、元アプリで見ていないので作っていない。

パーサはステータス文字列を**素通し**にする。マッピングしない。
描画側が知らない値を受け取っても壊れないようにする（既定は「未完了」側の見た目）。

### 原則 4: 実 HTML を残す

`clone/site/` は**元アプリが返したバイトそのもの**。これがあるから、

- パーサのテストを実物に対して書ける
- 元アプリが変わったときに差分を取れる
- 「昔はこうだった」を確認できる

**書き換えてはいけない。** 例えばクローンした HTML には `<meta charset>` が無く、
ローカルで開くと文字化けするが、HTML に charset を足して直してはいけない。
それはクローンを元と別物にする改変になる。配信側で
`Content-Type: text/html; charset=utf-8` を返す（`clone/serve.py` がそれ）。

### 原則 5: 「無い」「空」「権限が無い」を区別する

3 つは別物で、画面に出す文言も別。

| 状態 | 見分け方 | 出すもの |
| --- | --- | --- |
| データが 0 件 | 一覧の器はあるが行が無い | 元アプリの空状態の文言 |
| 絞り込みで 0 件 | 検索語やフィルタが効いている | 「条件に合う◯◯がありません」＋解除ボタン |
| 権限が無い | `/dashboard` にリダイレクトされる | ここでは扱わない（後述） |
| 取得に失敗 | HTTP エラー / 例外 | エラー表示と再試行 |

### 原則 6: 利用者ごとの内容を共有の場所に置かない

Worker のモジュールスコープ変数は**アイソレート内で複数リクエストに共有される**。
利用者ごとの内容をそこに置くと他人に見える。

`/api/*` の取得結果は**利用者区画の stale-while-revalidate**（`deploy/src/page-cache.js`）。
鍵にセッション Cookie の SHA-256 を入れ、他人のデータが混ざらないようにする。
裏更新は `waitUntil` で行うが、先読み温めで枠を食い潰すと再検証の書き込みまで
キャンセルされる（本番ログで確認済み）。温める処理は fresh ヒット時に限定する。

---

## 3. 元アプリが変わったときの手順

### 3.1 まず気づく

3 つの検知手段がある。上から順に軽い。

**(a) アセットの digest を見る。** 元アプリは Propshaft で内容ハッシュ付きの
ファイル名を配る。デプロイされれば変わる。

```bash
curl -sS https://meister.tokyo-ct.org/ \
  | grep -oE '/assets/(tailwind|application)-[a-f0-9]+\.(css|js)' | sort -u
```

クローン時の値と比べる。

```bash
grep -oE '/assets/(tailwind|application)-[a-f0-9]+\.(css|js)' \
  clone/site/public/index.html | sort -u
```

digest が同じなら、少なくともアセットは変わっていない。ERB だけの変更は
これでは検知できないので (b) と併用する。

**(b) 契約テストを流す。** パーサが依存している不変条件（列見出し、id 規約、
空状態の文言）を実サーバに対して確かめる。壊れたらここで落ちる。

```bash
cd deploy && MEISTER_EMAIL=... MEISTER_PASSWORD=... node --test test/api.test.mjs
```

**(c) 利用者からの報告。** 画面が空になる／項目が `—` だらけになる、が典型。
その場合は原則 1 を破った箇所（クラス依存）を疑う。

### 3.2 スナップショットを取り直して差分を見る

```bash
cd clone
cp -r site site.old
MEISTER_EMAIL=... MEISTER_PASSWORD=... python3 crawl.py --out site --max-pages 400
```

**そのまま `diff` してはいけない。** 同じ URL を 2 回取るだけで差分が出る。
実測したところ、リクエストごとに変わるのは**次の 2 つだけ**だった。

```
<meta name="csrf-token" content="...">        ← 毎回変わる
<input name="authenticity_token" value="...">  ← 毎回変わる
```

この 2 つを潰してから比べる。

```bash
norm() {
  sed -E 's/(name="csrf-token" content=)"[^"]*"/\1"X"/;
          s/(name="authenticity_token" value=)"[^"]*"/\1"X"/' "$1"
}
for f in $(cd site && find . -name '*.html'); do
  diff <(norm "site.old/$f") <(norm "site/$f") > /dev/null \
    || echo "変更あり: $f"
done
```

アセットの digest は**ノイズではなく信号**。変わっていたら再デプロイされている。

### 3.3 差分を分類する

| 差分の種類 | 影響 | 直す場所 |
| --- | --- | --- |
| 表示文言だけ変わった | パーサは動くが、フォールバック文言が古くなる | `fork/demo.js` の文言、テストの期待値 |
| 列が増えた / 減った / 並びが変わった | 一覧が崩れる | `deploy/src/parse*.js` と該当の `fork/pages/*.js` |
| クラスだけ変わった | 原則 1 を守っていれば**影響なし** | 影響があったならパーサがクラス依存になっている。直す |
| タグ構造が変わった（`<table>` → `<ul>` など） | パーサが 0 件を返す | パーサ。テストの合成データも作り直す |
| `id` / `data-*` の規約が変わった | 行が引けない、詳細が開けない | パーサと画面の両方 |
| ルートが増えた / 消えた | 404 か、静かにダッシュボードへ | `deploy/src/index.js` の `PAGES`、`fork/pages/` |
| 認証の流れが変わった | 全滅 | `deploy/src/meister.js`（後述の落とし穴を先に読む） |

### 3.4 直す順番

1. **パーサのテストを新しい HTML に対して落とす。** `clone/site/` を差し替えれば
   `deploy/test/parse*.test.mjs` は自動的に新しい HTML を読む。落ちた項目が
   影響範囲そのもの。落ちないなら影響は無い。
2. **パーサを直す。** 原則 1〜3 を守る。
3. **テストの期待値を直す。** ここで「テストを緩めて通す」のは禁止。
   期待値を新しい事実に合わせるのはよいが、`assert` を消して通してはいけない。
4. **画面を直す。** API の形が変わったなら `fork/pages/*.js` と `fork/demo.js` の
   両方を揃える（デモは API と同じ形であることが前提になっている）。
5. **通しで確認する。**
   ```bash
   cd deploy && node --test test/*.mjs        # パーサと API
   cd deploy && python3 test/e2e.py           # ログイン〜全画面〜ログアウト
   cd fork   && python3 test_responsive.py    # 幅と操作
   cd fork   && python3 test_pages.py         # 値が欠けた形の描画
   ```
6. **`clone/NOTES.md` を更新する。** 何が変わったか、いつ確認したかを残す。

---

## 4. 元アプリについて分かっている事実

すべて実測。出典を添える。**ここを疑う前に再実測すること。**

### 認証

**ログイン後のリダイレクトは 303。** Rails 7 + Turbo は POST 後に 302 ではなく
303（See Other）を返す。`status === 302` だけを見ると失敗扱いになる。
3xx をまとめて受けること。

**CSRF トークンはセッション Cookie と対。** Rails のセッションは Cookie に入って
いて**応答ごとに再発行される**。ある応答から取ったトークンは、その応答で返った
Cookie とセットでないと通らない。古い Cookie + 新しいトークンで POST すると **422**。

これでログアウトが動いていなかった。`/dashboard` を取ってトークンを抜き、
**元の Cookie のまま** `POST /users/sign_out` していたため 422。
`/dashboard` の応答の `Set-Cookie` を使う必要があった。

```js
const page = await origin('/dashboard', ..., cookie);
const token = authenticityToken(await page.text(), { formAction: '/users/sign_out' });
const fresh = sessionCookieFrom(page) || cookie;   // ← これが要る
await origin('/users/sign_out', { method: 'POST', body: ... }, fresh);
```

**フォームごとに authenticity_token が違う（per-form CSRF）。** `/orders/new` では
ナビのログアウト用と注文フォームで**別の値**になる。ページ先頭のトークンを使うと
ログアウト用になり、`POST /orders` が 422 になる（本番ログで確認）。
`authenticityToken(html, { formAction: '/orders' })` のように、投げる先の
`<form action>` に紐づくトークンを取ること。

**POST を足すときは必ず「そのフォームのトークン + 応答の Cookie」の組で送る。**
本文の自動保存（`/reports/:id/auto_save`）を実装するなら同じ罠がある。

**422 には 2 通りの理由がある。** メールアドレス／パスワードの不一致と、CSRF の
不成立。まとめて扱うと原因が読めない。本文で切り分ける。

| 本文に含まれる | 意味 |
| --- | --- |
| `メールアドレスまたはパスワードが違います` | 資格情報の誤り。利用者にそのまま見せる |
| `InvalidAuthenticityToken` / `authenticity` | CSRF。こちらの実装の問題 |

**`cookie_store` なのでサインアウトで発行済み Cookie を無効化できない。** 実測:

```
サインアウト後に新しい Cookie で /reports        → 302 → /users/sign_in
サインアウト前に保存した古い Cookie で /reports  → 200
```

サーバ側に破棄できる状態が無いので**直せない**。できるのは、こちらの Cookie を
確実に消すこと、封印トークンの期限を短く切ること（現在 4 時間）、`HttpOnly` に
すること。**ここを「直した」と書かないこと。**

### HTML の癖

**`<meta charset>` が無い。** 文字コードは HTTP ヘッダだけで伝えられている。
ローカルで開くときは `clone/serve.py` を使う。`python3 -m http.server` だと
文字化けする。

**空状態がデスクトップ用とモバイル用で 2 回出力される。** 同じ文言が DOM に 2 つある。
`parseEmptyState` は最初の 1 つを取る。件数を数える処理を書くなら注意。

**列見出しはラベルが入れ子。** `<th><div><svg/><span>商品</span></div></th>`。
タグを落としてテキストにすること。`data-column` 属性は付いていない。

**画面ごとに見出しのクラスが違う。**（原則 1 の実例。位置で引くこと）

**貸出の節に安定したクラスが無い。** 申請中は `<div class="">`、貸出中は
`<div class="mt-8">`。節は `<h2>` を境界にして切る。

### id の規約

| 対象 | 規約 | 出典 |
| --- | --- | --- |
| 週報の行 | `id="report_<id>"` | `user_report_sidebar_controller.js` |
| 注文の行 | `id="order_<id>"` | `user_order_sidebar_controller.js` |
| 注文のモバイルカード | `id="order_card_<id>"` | `side_panel_controller.js` |
| 通知の項目 | **`data-notification-id`**（`id="notification_<id>"` ではない） | `notification_list_controller.js` |
| 詳細パネル | `id="side_panel"`（Turbo Frame） | `side_panel_controller.js` |

通知だけ規約が違う。ここは実際に間違えかけた。**id 規約を推測しないこと。**
`clone/site/assets/controllers/` を `rg` で引けば確定できる。

### 権限で弾かれ方が 2 通りある

| パス | 応答 |
| --- | --- |
| `/admin/users` | ダッシュボードの本文 + **「管理者権限が必要です」** のフラッシュ（15,299 バイト） |
| `/admin` `/admin/reports` `/admin/orders` `/ta` `/ta/reports` `/ta/orders` | `dashboard.html` と**バイト単位で同一**（14,464 バイト） |

後者は、ルートが存在して黙って飛ばされたのか、そもそも無いのかを**区別できない**。
したがって「ダッシュボードとして解析できた」ことを、権限のある画面に到達した
証拠にしてはいけない。TA / 管理者画面を作るなら、権限のあるアカウントで
クローンを取り直すところから始める。

### 金額の形式

元アプリ自身が `'¥' + total.toLocaleString('ja-JP')` で描いている
（`order_total_controller.js`、`orders/new.html` の初期値が `¥0`）。
つまり `¥1,200` の形。`toNumber` はこれを剥がす。

---

## 5. パーサを書く・直すときのルール

置き場所は `deploy/src/parse.js`（週報）と `deploy/src/parse-pages.js`（他）。

- **ネットワークに触らない純関数にする。** HTML 文字列を受けてオブジェクトを返すだけ。
  そうすれば Node でそのままテストできる。
- **HTMLRewriter を使わない。** Cloudflare 専用で Node でテストできなくなる。
  正規表現と文字列操作で足りている。
- 共通処理（`text` `toIso` `parseColumns` `parseEmptyState`）は `parse.js` から
  import する。複製しない。
- 取れなかった値は `null`。例外を投げない。
- **検証できていない形にはコメントで「未検証」と理由を書く。**
  今はどのリストも 0 件のアカウントしか無いので、行の解析は全部これに当たる。

```js
/** 注文の行。
 *  **未検証**: 取得できたアカウントは注文が 0 件で、データが入った行を見ていない。
 *  形は user_order_sidebar_controller.js の `#order_<id>` と列の順序から組んだもの。 */
```

### テストの書き方

`deploy/test/parse*.test.mjs` の形に合わせる。

1. **実 HTML に対して**、見出し・列見出し・リード文・空状態の文言を検証する
2. **実 HTML に対して**、リストが 0 件であることを検証する（それが今の事実）
3. **実 HTML の器に合成した行を差し込んで**、行の解析を検証する

3 が重要。器（`<tbody>` や grid の `<div>`）は実物のまま、中身だけ合成する。
まるごと合成した HTML でテストすると、器の構造が変わったことに気づけない。

```js
const populated = html.replace(
  /(<tbody\b[^>]*>)([\s\S]*?)(<\/tbody>)/,
  (_all, open, _inner, close) => `${open}${SYNTHETIC_ROWS}${close}`
);
```

---

## 6. 画面を書く・直すときのルール

置き場所は `fork/pages/*.js`。1 画面 1 ファイルで、次の 3 つを export する。

```js
export const meta = { route: '/orders', nav: '注文', title: '注文' };
export async function load(ctx) { return ctx.demo ? demoOrders() : api.orders(); }
export function render(data, ctx) { /* ノードを 1 つ返す */ }
```

- **画面ごとに HTML を複製しない。** シェル（レール・詳細パネル・トースト）は
  `fork/index.html` に 1 組だけ。中身をクライアント側で差し替える。
  複製すると、元 UI で指摘した「空状態のマークアップが 2 重」と同じ問題を自分で作る。
- **DOM は `ui.js` の `h()` で組む。** `innerHTML` とテンプレート文字列の HTML は使わない。
- **新しい CSS クラスを作らない。** `fork/app.css` にあるものを使う。
  足りないときは `fork/design.md` を読んでから、トークン（`fork/tokens.css`）を
  参照する形で足す。生の色・生の余白を書かない。
- **操作できる要素は本物の `<button>` か `<a>`** にする。div にクリックを付けない。
- **取り消せる操作に確認ダイアログを出さない。** 実行して「元に戻す」を出す。
- **デモと実データで形を揃える。** `fork/demo.js` は API の応答と同じ形を返す。
  API を変えたらデモも変える。片方だけ直すと、デモでは動くのに実データで壊れる
  （またはその逆）状態になる。
- **実データを「ダミー」と書かない。** 注記は出どころで書き分ける。
  データの出どころは画面に常時出す（`#data-source`）。

---

## 7. 認証まわりの落とし穴

`deploy/src/meister.js` と `deploy/src/session.js`。

- **資格情報を保存しない。** 元アプリへの中継にしか使わない。
- **共有の資格情報を Worker に置かない。** 利用者ごとにログインさせる。
  以前は共有アカウントを secret に置いていたが、全員が同じ人の週報を見る形になる。
- セッションは元アプリの Cookie を **AES-GCM で封印**して自ドメインの Cookie に入れる。
  鍵は `SESSION_SECRET`。**鍵を差し替えれば全セッションを一括失効できる。**
  漏えいが疑われるときの手段はこれ。
- Cookie は `HttpOnly` `Secure` `SameSite=Lax`。
- **401 を一律で Cookie 削除にしない。** ログインの入力ミスで既存のセッションが
  落ちる。失効（`ApiError.clearSession = true`）のときだけ落とす。
- **失敗を握り潰さない。** ログアウトが元アプリに効いたかどうかは
  `DELETE /api/session` の応答（`originSignedOut`）に載せる。
  黙って `false` を返していたせいで、動いていないことに長く気づけなかった。

---

## 8. テストの決まり

| ファイル | 見るもの | ネットワーク |
| --- | --- | --- |
| `deploy/test/parse.test.mjs` `parse-pages.test.mjs` | HTML → JSON | 不要 |
| `deploy/test/api.test.mjs` | 動いている Worker の API | 元アプリに実ログイン |
| `deploy/test/e2e.py` | ログイン〜全画面〜ログアウト | 元アプリに実ログイン |
| `fork/test_responsive.py` | 320〜1920px の幅と操作 | 不要（デモで動く） |
| `fork/test_pages.py` | 値が欠けた形の描画 | 不要 |

- **テストを緩めて通さない。** 期待値を新しい事実に合わせるのはよいが、
  `assert` を消す・条件を弱めるのは禁止。
- **セッションを共有するテストは直列に流す。** `node --test` は並行に走るため、
  共有した Cookie 変数を書き換えるテストと使うテストが混ざって落ちる。
  ローカルは速くて隠れ、本番でだけ落ちた。`describe(..., { concurrency: 1 })` を使う。
- **想定内のコンソールエラーは URL で絞って無視する。** 未ログイン確認や
  静的配信で `/api/*` が 401 / 404 になるのは想定内。
  メッセージ本文ではなく `location.url` で判定する。
- **要素の可視性に依存した待ち方をしない。** レールは 1024px 未満で折りたたまれる。
  ルータは document 上の委譲リスナなので、`el.click()` を直接呼べば実クリックと
  同じ経路を通る。

---

## 9. デプロイと運用

```bash
cd deploy
export CLOUDFLARE_ACCOUNT_ID=<account id>
./build.sh          # fork/ から公開するファイルだけ public/ に揃える
npx wrangler deploy
```

- **`.dev.vars` の値は必ず引用する。** dotenv 形式で読まれるため、引用しないと
  `#` 以降が捨てられる。これで 127 文字のパスワードが 40 文字になり、
  原因が分からないまま「資格情報が違う」と言われ続けた。
  `wrangler secret put` は標準入力をそのまま読むのでこの問題は無い。
- **`assets.run_worker_first: ["/api/*"]` を消さない。** 既定では静的資産が
  Worker より先に配られるため、`/api/*` が SPA フォールバックで `index.html` に
  なってしまう。
- **デプロイ直後の数秒は secret が反映されていないことがある。** 直後にテストを
  流すと未設定として扱われる瞬間がある。数秒待つ。
- `public/` は生成物。コミットしない。`design.md` / `README.md` / テストは配らない。

---

## 10. 元アプリの URL が変わったとき

`https://meister.tokyo-ct.org` は次の 3 箇所にハードコードされている。

| 場所 | 用途 |
| --- | --- |
| `deploy/src/meister.js` の `ORIGIN` | 実際のアクセス先 |
| `deploy/src/index.js` の `/api/health` と `page()` | 応答に載せる出典表示 |
| `clone/crawl.py` の `BASE` | スナップショットの取得先 |

加えて次も見直す。

- `fork/index.html` のログイン画面の説明文（`meister.tokyo-ct.org` を明記している）
- `fork/pages/orders.js` と `fork/pages/equipments.js` の外部リンク
  （`/orders/new` と貸出申請を元アプリの絶対 URL に解決している）
- `deploy/test/api.test.mjs` の `origin` の期待値

**URL を変えたら、まずスナップショットを取り直して差分を見ること**（3.2）。
移設に伴って HTML も変わっている可能性が高い。

---

## 11. やってはいけないこと

- 元アプリに**書き込む**（POST / PATCH / DELETE）ことを、指示なく足す。
  今のフォークは読み取りだけ。削除も自動保存も画面の中だけで完結していて、
  元アプリには送っていない。
- クローン（`clone/site/`）を書き換える。
- 見ていない画面を「たぶんこうだろう」で作る。
- ステータスや項目名を創作する。
- 数値にできない値を `0` にする。
- 利用者ごとの取得結果を Worker の共有変数に置く。
- テストを緩めて通す。
- 元アプリのサインアウト仕様（`cookie_store`）を「直した」と書く。

---

## 12. 変更時のチェックリスト

```
[ ] clone/site/ を取り直した（crawl.py）
[ ] csrf-token と authenticity_token を潰して差分を取った
[ ] アセットの digest が変わったか確認した
[ ] 差分を 3.3 の表で分類した
[ ] パーサのテストが落ちる箇所を確認した（落ちないなら影響なし）
[ ] パーサを直した（クラス依存を作っていない／null を返す／語彙を作らない）
[ ] テストの期待値を新しい事実に合わせた（assert を消していない）
[ ] API の形を変えたなら fork/demo.js も揃えた
[ ] 4 つのテストを全部流した
[ ] clone/NOTES.md に何がいつ変わったかを書いた
[ ] 未検証のまま残した箇所にコメントで理由を書いた
```

---

## 付録: よく使うコマンド

```bash
# 元アプリの実 HTML から、ある文言がどこにあるか探す
rg -n "週報がありません" clone/site/auth/

# 元アプリの JS から id / data 属性の規約を確定する
rg -n "getElementById|querySelector|dataset\." clone/site/assets/controllers/

# 元アプリのある画面の見えるテキストだけ抜く
python3 - <<'PY'
import re, html
s = open("clone/site/auth/orders.html", encoding="utf-8").read()
b = re.sub(r"<script[\s\S]*?</script>", " ", s.split("</head>", 1)[1])
print(" | ".join(l.strip() for l in re.sub(r"<[^>]+>", "\n", html.unescape(b)).splitlines() if l.strip()))
PY

# 元アプリに 1 回だけログインして任意のパスを見る
cd deploy && python3 - <<'PY'
import os, re, urllib.request, http.cookiejar, urllib.parse
BASE = "https://meister.tokyo-ct.org"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
op.addheaders = [("User-Agent", "Mozilla/5.0 Chrome/126")]
tok = re.search(r'name="authenticity_token"\s+value="([^"]+)"',
                op.open(BASE + "/users/sign_in").read().decode()).group(1)
op.open(urllib.request.Request(BASE + "/users/sign_in", data=urllib.parse.urlencode({
    "authenticity_token": tok, "user[email]": os.environ["MEISTER_EMAIL"],
    "user[password]": os.environ["MEISTER_PASSWORD"], "commit": "ログイン"}).encode(),
    headers={"Content-Type": "application/x-www-form-urlencoded", "Origin": BASE}))
print(op.open(BASE + "/reports").read().decode()[:2000])
PY
```
