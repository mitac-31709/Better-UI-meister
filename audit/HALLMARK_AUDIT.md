# `hallmark audit` — 元 `/reports` の採点

対象: `clone/site/auth/reports.html`（2026-08-05 取得）と共通レイアウト、
`clone/site/assets/controllers/side_panel_controller-1d75203f.js`

genre: **modern-minimal**（社内向けのデータ管理ツール）として採点。
このジャンルでは純白の paper と無彩色のニュートラルは許容される（gate 7・22 が緩む）。

参照: `vendor/hallmark/skills/hallmark/references/anti-patterns.md`

---

## critical（そのまま出すと slop）

### 1. パープルグラデーション — The purple-gradient hero

`reports.html` ヘッダカード、テーブルヘッダ、空状態アイコンの 3 箇所。

```html
<div class="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl ...">   <!-- ヘッダカード -->
<th class="bg-gradient-to-r from-slate-50 to-gray-50 ...">                    <!-- 全 5 列 -->
<div class="p-6 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-full">  <!-- 空状態 -->
```

公開トップ（`clone/site/public/index.html`）はさらに露骨で、ヒーロー右半分が
`bg-gradient-to-r from-indigo-500 to-purple-600` の全面グラデーション。
最も認識されやすい AI 生成の見た目そのもの。

→ **fix**: アンカー色を 1 つに決め、グラデーションを全廃する。暖かみが欲しければ
ニュートラルに色味を寄せる。

### 2. Inter だけで組んでいる — Inter-everywhere

`clone/site/public/index.html` の `<head>`:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
```

display も body もラベルも Inter。しかも weight 100–900 を全部読み込んでいて、
実際に使っているのは 3–4 種類。1 フォントのページはテンプレートのページ。

→ **fix**: display 用の顔を別に立て、body は Inter を残す。日本語は本文用の
ゴシックを別途指定する（Inter に日本語グリフは無く、現状はブラウザの
フォールバックに任せている＝環境ごとに字面が変わる）。

### 3. カードの中のカード — Card-in-card

テーブルカードが `.bg-base-100.shadow-lg.rounded-lg` > `.p-0` > `<table>` の 3 重。
ヘッダカードは「グラデーションのカード」の中に「白いカード」（アイコン）と
「白いピル」（集計チップ）を入れた 2 重。意味のない入れ子。

→ **fix**: 包む層を 1 つに決める。テーブルは罫線で区切れば影もカードも不要。

### 4. スクロールコンテナが二重 — 実際の操作性の不具合

```html
<main class="pt-20 pb-6 min-h-screen bg-gray-50">
  <div class="relative h-screen overflow-hidden">
    <div class="pt-4 h-full overflow-y-auto ...">
```

`main` に 80px の上パディングを入れた上で内側を `h-screen`（= 100vh）にしているため、
文書全体の高さが `80px + 100vh + 24px` になる。結果として**ページ自身のスクロールバーと
内側のスクロールバーが同時に出る**。行が増えれば増えるほど、どちらを掴めばいいのか
分からなくなる。ヘッダは `fixed` なので内側だけスクロールさせたいはずで、実装意図と
噛み合っていない。

→ **fix**: スクロールは 1 箇所に集約する。ヘッダを `sticky` にして、本文は文書の
通常フローに戻す。

---

## major（AI 生成に見える）

### 5. 列見出し 5 つ全部にアイコン — Icon-tile の変種

タイトル・期間・ステータス・期限・作成日、5 列すべてに 16px の装飾 SVG が付く。
どれも列名の意味を足しておらず、視線が名前ではなくアイコンに引っかかる。
`aria-hidden` も付いていないので支援技術には無意味なノードとして残る。

→ **fix**: 列見出しのアイコンは落とす。文字だけで足りる。装飾 SVG が残る場合は
`aria-hidden="true"` を付ける。

### 6. `<th>` にグラデーション + 2px の下罫線

```html
<th class="bg-gradient-to-r from-slate-50 to-gray-50 ... border-b-2 border-slate-200 py-4 px-6">
```

ヘッダ行が本文よりも視覚的に重く、行数が増えたときにヘッダばかりが目立つ。
`py-4 px-6` は 1 行あたり 56px 前後になり、データ一覧としては行密度が低い。

→ **fix**: ヘッダは 1px の罫線と小さめのラベル書体に落とす。行の高さを詰める。

### 7. ソートも検索もフィルタも無い

```html
<!-- Filters Section -->
<div class="mb-6">

</div>
```

フィルタ用の枠だけがあって中身が空。`data-controller="sortable-table"` も
一般ユーザー画面には無い（`clone/NOTES.md` 参照）。週報は週次で溜まっていくので、
期限順・ステータス絞り込みが無い一覧はすぐ使えなくなる。

→ **fix**: ステータスの絞り込みと列ソートを入れる。件数が増える前提の画面。

### 8. ソートがフルページリロード（TA / 管理者画面）

`sortable_table_controller-ad879dee.js`:

```js
window.location.href = url.toString()   // Turbo を経由しない
```

Hotwire を入れているのに、ソートだけ `window.location.href` で画面全体を作り直す。
スクロール位置も開いていたパネルも失われる。

→ **fix**: 一覧の更新は DOM 内で完結させる。少なくとも Turbo のフレーム更新に乗せる。

### 9. スライドオーバーに Escape も背景も無い

```html
<turbo-frame class="fixed inset-y-0 right-0 w-96 ... z-[60] translate-x-full" id="side_panel"></turbo-frame>
```

`side_panel_controller` が持つのは `close()` とフレームイベントの購読だけで、
**Escape キーのハンドラが無い**。背景のオーバーレイも無く、`role="dialog"` も
`aria-modal` も無い。フォーカストラップも無いので、開いた状態で Tab を押すと
裏の一覧にフォーカスが抜ける。

→ **fix**: Escape で閉じる、背景クリックで閉じる、`role="dialog"` +
`aria-labelledby`、開いたら中にフォーカスを移し閉じたら呼び出した行へ返す。

### 10. 閉じるたびに中身を捨てるので開き直しが毎回フェッチ

```js
setTimeout(() => { panel.innerHTML = ""; panel.removeAttribute('src') }, 300)
```

同じ週報を見比べたいだけでも往復ごとに再取得になる。

→ **fix**: 直前の内容は保持して、再度開いたときは即座に見せる。

### 11. 空状態のマークアップが 2 つに複製されている

デスクトップ用（`hidden md:block`）とモバイル用（`md:hidden`）で、
同じアイコン・同じ見出し・同じ文章が丸ごと 2 回書かれている。
文言を直すときに 2 箇所直す必要があり、片方だけ古くなる。

→ **fix**: 空状態は 1 つにして、レイアウトだけ CSS で切り替える。

### 12. 削除がネイティブの `confirm()`

`side_panel_controller#resetBeforeDelete`:

```js
if (confirmMessage && !confirm(confirmMessage)) { event.preventDefault(); return }
```

取り消せる操作に確認ダイアログを出すのは Hallmark の禁止事項
（Confirmation dialogs for reversible actions）。しかもネイティブの `confirm()` は
デザインの外側に出る。

→ **fix**: 楽観的に削除して「元に戻す」を数秒出す。破壊的で不可逆な操作にだけ
ダイアログを残す。

### 13. 通知バッジを 5 分間隔でポーリング

`notifications-9c18f17a.js`:

```js
setInterval(() => { this.updateNotificationBadge() }, 300000)
```

ActionCable を既に使っているのに、通知だけ HTTP ポーリング。
最悪 5 分遅れで、その間バッジは嘘をつく。

→ **fix**: 既にある ActionCable に寄せる。

---

## minor（細かい詰め）

### 14. 集計チップが小さすぎる

`text-xs`（12px）+ `w-1.5 h-1.5`（6px）のドット。ページ内で唯一の要約情報なのに、
h1 の 30px に対して 12px しかなく、視線の順序が「見出し → テーブル」で
チップを飛ばす。

→ **fix**: 数字を本文より大きく組み、ラベルを小さくする。数字が主役。

### 15. `z-[60]` の直値

名前付きのスケールが無く、レイヤー順が読めない。

→ **fix**: `--z-*` の名前付きスケールにする。

### 16. Tailwind と DaisyUI の語彙が混ざっている

同じファイルの中に `bg-gray-50` / `text-slate-700`（Tailwind パレット）と
`bg-base-100` / `text-base-content/70` / `divide-base-300`（DaisyUI トークン）が同居。
どちらを直せばテーマが変わるのか分からない。

→ **fix**: どちらか一方に寄せる。

### 17. 数字に `tabular-nums` が無い

期限・作成日・件数が比例数字で組まれていて、行をまたいで桁が揃わない。

→ **fix**: 数字を並べる列に `font-variant-numeric: tabular-nums`。

### 18. Inter の weight 100–900 を全部読み込んでいる

使っているのは 4 種類程度。初回表示に不要な転送が乗る。

→ **fix**: 使う weight だけ読む。

---

## Summary

**5 critical · 9 major · 5 minor**

**Verdict — reads as AI-generated.**

グラデーション（3 箇所 + トップページ全面）と Inter 単独という critical 2 つが
見た目を決めてしまっている。加えて critical 4 のスクロール二重化と major 7 の
「ソートも検索も無い」は、見た目の問題ではなく**この画面が週次で溜まるデータを
扱えていない**という機能の欠落。フォークで優先して直すのはこの 2 つ。
