# Cron CPU 時間の検証（2026-08-05）

Cron を `0 * * * *`（毎時）にしたうえで、1 回あたりの CPU 時間を概算した。

## Cloudflare の上限

| プラン | Cron 間隔 | CPU time / 回 |
| --- | --- | --- |
| Free | 問わず | **10 ms** |
| Paid | **≥ 1 時間**（今回） | **最大 15 分** |
| Paid | < 1 時間 | 30 秒 |

`fetch` の待ち時間は CPU time に含まれない。測定対象は HTML パース・差分・Discord ペイロード組み立て・AES 封印のみ。

## 測定方法

```bash
cd deploy
MATRIX=1 node test/cpu-budget.mjs
# 結果: artifacts/cpu-budget.json
```

Node `process.cpuUsage()` による概算。Workers の V8 アイソレートと完全一致はしないが、オーダー感の確認用。

## 結果サマリ（p95）

| 購読者 / Cron | 通知 0 | 通知 20 | 通知 100 |
| --- | ---: | ---: | ---: |
| 1 | 0.7 ms | 1.8 ms | 3.5 ms |
| 5 | 2.8 ms | 1.5 ms | 5.2 ms |
| 10 | 3.0 ms | 4.6 ms | 7.4 ms |
| 25 | 8.7 ms | 8.0 ms | **29.7 ms**（Free 超過） |

想定規模（購読者数人・未読数十件）では Free の 10 ms 内に収まる。購読者 25 × 通知 100 のような極端ケースだけ Free を超える。

## 結論

- **1 時間間隔**で問題なし（即時性不要の要件どおり）。
- Paid なら上限 15 分なので余裕は十分。
- Free でも個人利用〜少数購読なら現実的に足りる。スケールするなら Paid を推奨。
