# Design — Meister Management System（フォーク）

このアプリの設計システムを固定したファイル。以降どの画面を作るときも最初にこれを読む。
ページごとに作り直さない。システムを広げる必要が出たらこのファイルを直す。

土台は `../clone/site/auth/` で取得した実物と、`../audit/HALLMARK_AUDIT.md` の指摘。
Hallmark の `redesign` verb（multi-page flow）に従う。

## Genre

**modern-minimal**

社内向けのデータ管理ツール。週次で溜まる一覧を読み、絞り込み、1 件開いて書く。
派手さは要らないが、無彩色に逃げた「選んでいない」ミニマルにもしない。

## Macrostructure family

| ページ種別 | family | 変える余地 |
| --- | --- | --- |
| アプリ画面 | **Workbench** — サイドレール + ツールバー + 高密度テーブル + スライドオーバー | ツールバーの構成、一覧の列、詳細パネルの中身 |
| 公開ページ | 未定（このフォークの対象外） | — |

- **Nav: N3 サイドレール**（≥1024px）。1024px 未満は上部バー + シート。
  元 UI の「ワードマーク左・リンク 4〜5 個・ボタン右・全幅・下罫線 1px・白背景」は
  Hallmark の gate 42 が落とす典型形。レールにすると横幅がテーブルに戻り、
  遷移先が増えても（`/ta` `/admin` がある）縦に伸ばせる。
- **Footer: Ft2 インライン 1 行**。レール下端に 1 行だけ。アプリ画面にフッタは要らない。
- **Enrichment: なし。** アプリ画面は機能が主役。ヒーロー画像も装飾 SVG も置かない。

## Theme

**Cobalt** — 冷たい engineered near-white の地、電気的なコバルトのアクセント 1 色、
定規で引いた 1px 罫線、6〜10px の詰まった角丸。

元 UI が青〜藍系だったブランドの向きは保つ。critical だったのは
グラデーション（`from-purple-50 to-indigo-50` を 3 箇所 + トップページ全面）で、
色そのものではない。

| トークン | 値 |
| --- | --- |
| `--color-paper` | `oklch(98.5% 0.004 250)` |
| `--color-paper-2` | `oklch(96.5% 0.005 252)` |
| `--color-paper-3` | `oklch(94% 0.006 254)` |
| `--color-rule` | `oklch(91% 0.008 255)` |
| `--color-rule-2` | `oklch(83% 0.011 255)` |
| `--color-muted` | `oklch(56% 0.013 255)` |
| `--color-neutral` | `oklch(46% 0.015 255)` |
| `--color-ink-2` | `oklch(34% 0.018 257)` |
| `--color-ink` | `oklch(24% 0.020 258)` |
| `--color-accent` | `oklch(58% 0.20 256)` |
| `--color-accent-ink` | `oklch(99% 0.004 256)` |
| `--color-focus` | `oklch(58% 0.20 256)` |
| `--color-warn` | `oklch(56% 0.15 45)` |

アクセントは 1 色。使うのは現在地の表示、フォーカスリング、主ボタン、
選択行の左辺だけ。1 画面あたりの占有は 5% 未満に抑える。

`--color-warn` は「期限を過ぎている」だけに使う。色だけに意味を持たせないため、
必ずグリフ（△）と文字（「2日超過」）を添える。

## Typography

3 ファミリーが上限。日本語グリフは**同じ `font-family` スタックの後段**に置く。
別トークンにすると 4 ファミリー目になって gate 37 に落ちる。

| ロール | スタック | weight |
| --- | --- | --- |
| display | `"Space Grotesk", "Zen Kaku Gothic New", ui-sans-serif, system-ui, sans-serif` | 700 |
| body | `"Inter", "Noto Sans JP", ui-sans-serif, system-ui, sans-serif` | 400 |
| label / mono | `"JetBrains Mono", "Noto Sans Mono", ui-monospace, monospace` | 500 |

- body の Inter は元アプリから引き継ぐ。critical だった「Inter だけで組んでいる」は
  display を別に立てることで解消する。
- display tracking `-0.03em`、label tracking `0.08em` + 大文字。
- mono の役割は **2 つだけ**（gate 38）。小さいラベルと、桁を揃える数字。
  それ以外に mono を使わない。
- 数字を並べる列は `font-variant-numeric: tabular-nums`。
- 見出しは全て roman。イタリックの見出しは使わない（gate 38a）。

## Spacing

4pt の名前付きスケール。`tokens.css` に定義した `var(--space-*)` だけを使う。
生の値を書かない。

## Motion

- easing は 3 つ。`--ease-out` / `--ease-in` / `--ease-in-out`。ブラウザ既定の `ease` は使わない。
- animate するのは `transform` と `opacity` だけ。
- **primitive は 3 つまで**: パネルのスライド、行のフォーカス移動、トーストの出入り。
  行の hover に lift も scale も付けない。
- `prefers-reduced-motion: reduce` で空間移動を 150ms のクロスフェードに落とす。
- フォーカスリングは**遷移させない**。即座に出す。

## Microinteractions stance

- 成功は黙って反映する。祝うトーストは出さない。
- 取り消せる操作に確認ダイアログを出さない。楽観的に実行して「元に戻す」を出す。
  不可逆な操作にだけダイアログを残す。
- ツールチップは hover 800ms / focus 0ms。
- 一覧の更新（絞り込み・並べ替え）でページを再読み込みしない。状態は URL に同期して
  リンクは共有できるままにする。

## CTA voice

- 主ボタン: `--color-accent` 塗り、文字は `--color-accent-ink`、`--radius-pill`（6px）。
- 副ボタン: 地は `--color-paper`、`1px solid var(--color-rule-2)`、文字は `--color-ink`。
- 破壊的ボタン: 地は透明、文字は `--color-warn`、罫線は `--color-rule-2`。
- 高さは入力欄と揃えて 40px（タッチ領域は `::before` で 44px に広げる）。
- ラベルは折り返さない（`white-space: nowrap`、gate 49）。

## 8 状態

操作できる要素は全部 8 状態を書く。default / hover / focus-visible / active /
disabled / loading / error / success。border-width は全状態で 1px 固定にして、
状態変化は `background-color` と `outline` に出す。レイアウトをずらさない。

## Per-page allowances

- アプリ画面は enrichment 禁止。
- アクセントの置き場所（現在地・フォーカス・主ボタン・選択行）は全画面共通。
- ワードマーク、display / body / mono の 3 スタック、ボタンの形は全画面共通。
- 画面ごとに変えていいのは、ツールバーの構成と一覧の列と詳細パネルの中身だけ。

## 元 UI から引き継ぐもの

`redesign` verb は情報構造と文言の意図を保つ。

- ナビの遷移先 5 つ: ダッシュボード / 注文 / 機材 / 貸出 / 週報
- ワードマーク `MMS`
- 見出し「週報一覧」
- 集計の 3 つ: 未完了 / 完了 / 合計
- 一覧の列 5 つ: タイトル / 期間 / ステータス / 期限 / 作成日
- 空状態の文言「週報がありません」「管理者によって新しいレポートの締め切りが設定されると、
  ここにレポートが表示されます。」
- ディープリンクの `?report_id=`
- 詳細は右からのスライドオーバー
- 本文の自動保存と、他人が編集中の項目をロックする挙動

## 確認できていないので推測で埋めないもの

クローンは一般ユーザー権限・データ 0 件のアカウントで取得した（`../clone/NOTES.md`）。
以下は実物を見ていない。

- ステータスの語彙 → 根拠がある **未完了 / 完了 の 2 値だけ**にする。
  「下書き」「差し戻し」などの中間状態は勝手に作らない。
- 詳細パネルの項目 → 一覧と同じ 5 項目 + 本文 1 つに留める。
  項目名を捏造しない。自動保存とロックは JS に根拠があるので入れる。
- 一覧の件数とページネーション → デモは 14 件。ページ送りは作らない。

## Exports

### tokens.css

`tokens.css` を参照。全トークンの定義はそこ 1 箇所にある。

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper:      oklch(98.5% 0.004 250);
  --color-paper-2:    oklch(96.5% 0.005 252);
  --color-paper-3:    oklch(94%   0.006 254);
  --color-rule:       oklch(91%   0.008 255);
  --color-rule-2:     oklch(83%   0.011 255);
  --color-muted:      oklch(56%   0.013 255);
  --color-neutral:    oklch(46%   0.015 255);
  --color-ink-2:      oklch(34%   0.018 257);
  --color-ink:        oklch(24%   0.020 258);
  --color-accent:     oklch(58%   0.20  256);
  --color-accent-ink: oklch(99%   0.004 256);
  --color-warn:       oklch(56%   0.15  45);

  --font-display: "Space Grotesk", "Zen Kaku Gothic New", ui-sans-serif, sans-serif;
  --font-body:    "Inter", "Noto Sans JP", ui-sans-serif, sans-serif;
  --font-mono:    "JetBrains Mono", "Noto Sans Mono", ui-monospace, monospace;

  --spacing-3xs: 0.125rem; --spacing-2xs: 0.25rem; --spacing-xs: 0.5rem;
  --spacing-sm:  0.75rem;  --spacing-md:  1rem;    --spacing-lg: 1.5rem;
  --spacing-xl:  2.5rem;   --spacing-2xl: 4rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper":      { "$value": "oklch(98.5% 0.004 250)", "$type": "color" },
    "ink":        { "$value": "oklch(24% 0.020 258)",   "$type": "color" },
    "accent":     { "$value": "oklch(58% 0.20 256)",    "$type": "color" },
    "accent-ink": { "$value": "oklch(99% 0.004 256)",   "$type": "color" },
    "warn":       { "$value": "oklch(56% 0.15 45)",     "$type": "color" }
  },
  "font": {
    "display": { "$value": "Space Grotesk", "$type": "fontFamily" },
    "body":    { "$value": "Inter",         "$type": "fontFamily" },
    "mono":    { "$value": "JetBrains Mono","$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1rem",   "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background:         98.5% 0.004 250;
  --foreground:         24%   0.020 258;
  --primary:            58%   0.20  256;
  --primary-foreground: 99%   0.004 256;
  --muted:              94%   0.006 254;
  --muted-foreground:   56%   0.013 255;
  --border:             91%   0.008 255;
  --input:              91%   0.008 255;
  --ring:               58%   0.20  256;
  --radius:             6px;
}
```
