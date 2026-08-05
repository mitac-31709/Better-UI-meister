# Cron CPU 時間（1 人ずつの HTTP 振り分け）

## Cloudflare の上限

| プラン | 呼び出し | CPU time |
| --- | --- | --- |
| Free | Cron 1 回 | **10 ms** |
| Free | HTTP 1 回 | **10 ms** |
| Paid | Cron（間隔 ≥ 1 時間） | 最大 15 分 |
| Paid | HTTP | 既定 30 秒（最大 5 分） |

`fetch` / KV の待ちは CPU に含まれない。

## 設計

### 1 人ごとに別 Cron は？

**動的にはできない。** Cron 式は `wrangler` に静的定義。Free はアカウントあたり **5 本**まで。
代わりに **Cron 1 本 → 購読ごとに別 HTTP**（`/api/notify/cron-tick`）へ振り分け、
**1 人 = 1 呼び出し = 別 CPU 枠**にする。一覧パースは毎ティック行う（取りこぼしを避ける）。

## パース込みの参考行列

`MATRIX=1 node test/cpu-budget.mjs`

| 購読者 | 通知 20 p95 | 通知 100 p95 |
| --- | ---: | ---: |
| 1 | 1.8 ms | 3.5 ms |
| 10 | 4.6 ms | 7.4 ms |

本番 1 人・パースありで約 5 ms だった実績あり。1 人 1 HTTP なら Free の 10 ms 枠に収まりやすい。
