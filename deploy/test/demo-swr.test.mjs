/* demo.js の SWR シミュレーション。ネットワーク不要。 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(here, '../../fork/demo.js')).href);
const {
  DEMO_ORIGIN_MS, demoDashboard, resetDemoCache
} = mod;

describe('demo SWR', () => {
  test('初回は cache + revalidating、refresh で live になる', async () => {
    resetDemoCache();
    const first = await demoDashboard();
    assert.equal(first.source, 'cache');
    assert.equal(first.revalidating, true);
    assert.equal(first.notice, '調整中');

    const t0 = Date.now();
    const fresh = await demoDashboard({ refresh: true });
    assert.ok(Date.now() - t0 >= DEMO_ORIGIN_MS - 50);
    assert.equal(fresh.source, 'live');
    assert.equal(fresh.revalidating, undefined);
    assert.match(fresh.notice, /デモ再取得 #2/);
  });

  test('refresh 直後の再取得は cache（revalidating なし）', async () => {
    resetDemoCache();
    await demoDashboard({ refresh: true });
    const again = await demoDashboard();
    assert.equal(again.source, 'cache');
    assert.equal(again.revalidating, undefined);
  });
});
