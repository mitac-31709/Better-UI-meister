#!/usr/bin/env node
/* Cron 1 回あたりの CPU 時間を概算する。
 *
 * Cloudflare の「CPU time」は待機（fetch）を含まない実行時間。
 * Node の process.cpuUsage() でパース・差分・ペイロード・AES 封印を測る。
 *
 * 上限（Cloudflare Workers limits）:
 *   Free:  Cron 1 回あたり 10 ms（間隔に依らない）
 *   Paid:  間隔 ≥ 1 時間の Cron は最大 15 分 / 間隔 < 1 時間は 30 秒
 *
 *   node test/cpu-budget.mjs
 *   SUBS=5 ITEMS=50 node test/cpu-budget.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

import {
  buildDiscordPayload, pickNewNotifications
} from '../src/background.js';
import { parseNotifications } from '../src/parse-pages.js';
import { seal, unseal } from '../src/session.js';

const here = dirname(fileURLToPath(import.meta.url));
const FREE_LIMIT_MS = 10;
const PAID_HOURLY_LIMIT_MS = 15 * 60 * 1000;

const SUBS = Math.max(1, Number(process.env.SUBS || 1));
const ITEMS_DEFAULT = Math.max(0, Number(process.env.ITEMS || 20));
const htmlPath = process.env.HTML
  || join(here, '../../clone/site/auth/notifications.html');

function itemList(n) {
  return Array.from({ length: n }, (_, i) => `
    <li id="notification_${1000 + i}" data-notification-id="${1000 + i}"
        data-read="${i % 5 === 0 ? 'true' : 'false'}" class="px-4 py-4">
      <h3>合成通知 ${i + 1}</h3>
      <p>本文 ${i + 1} — 週報・貸出・注文の変更を知らせるテキスト。${'詳細'.repeat(8)}</p>
      <time datetime="2026-08-05T12:00:00Z">2026/08/05</time>
    </li>`).join('');
}

function syntheticHtml(n) {
  return `<!doctype html><html><body><main>
    <h1>通知</h1>
    <div id="unread_count_display">未読 ${n} 件</div>
    <div class="bg-white"><ul>${itemList(n)}</ul></div>
  </main></body></html>`;
}

function loadHtml(itemCount) {
  if (process.env.HTML === 'synthetic' || !existsSync(htmlPath)) {
    return { html: syntheticHtml(itemCount), source: `synthetic:${itemCount}` };
  }
  const raw = readFileSync(htmlPath, 'utf8');
  if (itemCount <= 0) {
    return { html: raw, source: htmlPath };
  }
  // 実 HTML は 0 件なので測定用に一覧を差し込む。
  // bg-white の器がネストしていることがあるので、main 末尾に ul を足す。
  let html;
  if (/<\/main>/i.test(raw)) {
    html = raw.replace(/<\/main>/i, `<div class="bg-white"><ul>${itemList(itemCount)}</ul></div></main>`);
  } else {
    html = `${raw}\n<div class="bg-white"><ul>${itemList(itemCount)}</ul></div>`;
  }
  return { html, source: `${htmlPath}+inject${itemCount}` };
}

function cpuMs(start) {
  const end = process.cpuUsage(start);
  return (end.user + end.system) / 1000;
}

async function workOneSubscriber(html, secret) {
  const parsed = parseNotifications(html);
  const unread = parsed.notifications.filter((n) => n.read === false).length;
  const result = pickNewNotifications({
    prev: { primed: true, count: 0, seenIds: [] },
    count: unread,
    notifications: parsed.notifications
  });
  const payload = buildDiscordPayload(
    result.items.length
      ? result.items
      : [{ id: 'x', title: 't', body: 'b', atISO: '2026-08-05' }],
    { origin: 'https://example.test' }
  );
  const sealed = await seal({
    id: 'bench',
    cookie: 'session=benchmark',
    webhookUrl: 'https://discord.com/api/webhooks/1234567890123456789/abcdefghijklmnopqrstuvwx-yz_ABCDE',
    primed: true,
    count: result.next.count,
    seenIds: result.next.seenIds,
    payloadBytes: JSON.stringify(payload).length
  }, secret);
  await unseal(sealed, secret);
  return { notifications: parsed.notifications.length, fresh: result.items.length };
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    mean: Number(mean.toFixed(3)),
    median: Number(at(0.5).toFixed(3)),
    p95: Number(at(0.95).toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3))
  };
}

async function runCase({ subs, items }) {
  const { html, source } = loadHtml(items);
  const secret = 'cpu-budget-bench-secret-not-for-prod';

  // warmup
  await workOneSubscriber(html, secret);

  const cpuSamples = [];
  const wallSamples = [];
  let last = null;
  for (let i = 0; i < 30; i += 1) {
    const start = process.cpuUsage();
    const wall0 = performance.now();
    for (let s = 0; s < subs; s += 1) {
      last = await workOneSubscriber(html, secret);
    }
    wallSamples.push(performance.now() - wall0);
    cpuSamples.push(cpuMs(start));
  }

  const cpu = summarize(cpuSamples);
  return {
    subscribersPerCron: subs,
    itemsInjected: items,
    htmlBytes: Buffer.byteLength(html),
    htmlSource: source,
    notificationsParsed: last.notifications,
    cpuMs: cpu,
    wallMsMedian: Number(summarize(wallSamples).median.toFixed(3)),
    freeOk: cpu.p95 < FREE_LIMIT_MS,
    freeHeadroomMs: Number((FREE_LIMIT_MS - cpu.p95).toFixed(3))
  };
}

async function main() {
  if (!globalThis.crypto) globalThis.crypto = webcrypto;

  // 単発（環境変数）か、マトリクス
  const matrix = process.env.MATRIX === '1';
  let cases;
  if (matrix) {
    cases = [];
    for (const subs of [1, 5, 10, 25]) {
      for (const items of [0, 20, 100]) {
        cases.push(await runCase({ subs, items }));
      }
    }
  } else {
    cases = [await runCase({ subs: SUBS, items: ITEMS_DEFAULT })];
  }

  const report = {
    measuredAt: new Date().toISOString(),
    runtime: `node ${process.version}`,
    cronSchedule: '0 * * * *',
    note: [
      'process.cpuUsage() による概算。Workers の V8 アイソレートとは完全一致しない。',
      'fetch 待ちは Cloudflare CPU time に含まれないので、ここでは意図的に測っていない。',
      'Free: Cron 10ms / Paid（1時間間隔）: 最大 15 分。'
    ].join(' '),
    limits: {
      workersFreeCronMs: FREE_LIMIT_MS,
      workersPaidHourlyCronMs: PAID_HOURLY_LIMIT_MS
    },
    cases,
    verdict: (() => {
      const worst = cases.reduce((a, c) => (c.cpuMs.p95 > a.cpuMs.p95 ? c : a));
      const freeOk = cases.every((c) => c.freeOk);
      return {
        worstCase: {
          subscribersPerCron: worst.subscribersPerCron,
          itemsInjected: worst.itemsInjected,
          p95Ms: worst.cpuMs.p95
        },
        freePlanLikelyOkForTestedCases: freeOk,
        paidHourlyOk: true,
        recommendation: freeOk
          ? '測定した範囲では Free の 10ms に収まった。本番はダッシュボードの Cron CPU time で再確認すること。'
          : '測定上 Free の 10ms を超えるケースがある。Paid（1 時間 Cron は最大 15 分）を推奨。'
      };
    })()
  };

  const outDir = join(here, '../artifacts');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'cpu-budget.json');
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
