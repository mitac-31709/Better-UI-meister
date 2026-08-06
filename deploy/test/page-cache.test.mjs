/* page-cache.js の鮮度判定と SWR 挙動。ネットワーク不要。 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FRESH_MS, HARD_MAX_MS, STALE_WHILE_REVALIDATE_MS,
  ageMs, cacheRequest, createPageCache, freshness, userCacheKey, withSource
} from '../src/page-cache.js';

describe('page-cache helpers', () => {
  test('userCacheKey は Cookie の SHA-256 で、平文を含めない', async () => {
    const a = await userCacheKey('_meister_management_system_session=abc');
    const b = await userCacheKey('_meister_management_system_session=abc');
    const c = await userCacheKey('_meister_management_system_session=xyz');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(a.length, 64);
    assert.ok(!a.includes('abc'));
  });

  test('cacheRequest は区画ごとに別 URL', () => {
    const u = cacheRequest('deadbeef', '/orders');
    assert.equal(u.url, 'https://meister-page-cache.internal/v1/deadbeef/orders');
  });

  test('freshness は鮮度帯を分ける', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const at = (msAgo) => ({ fetchedAt: new Date(now - msAgo).toISOString() });

    assert.equal(freshness(null, now), 'miss');
    assert.equal(freshness(at(0), now), 'fresh');
    assert.equal(freshness(at(FRESH_MS - 1), now), 'fresh');
    assert.equal(freshness(at(FRESH_MS + 1), now), 'revalidate');
    assert.equal(freshness(at(STALE_WHILE_REVALIDATE_MS - 1), now), 'revalidate');
    assert.equal(freshness(at(STALE_WHILE_REVALIDATE_MS + 1), now), 'stale');
    assert.equal(freshness(at(HARD_MAX_MS + 1), now), 'expired');
    assert.ok(ageMs(at(1000), now) >= 1000);
  });

  test('withSource は source を上書きする', () => {
    assert.deepEqual(
      withSource({ source: 'live', fetchedAt: 'x', n: 1 }, 'cache'),
      { source: 'cache', fetchedAt: 'x', n: 1 }
    );
  });
});

describe('page-cache SWR', () => {
  function memoryBackend() {
    const map = new Map();
    return {
      match: async (req) => {
        const hit = map.get(req.url);
        return hit ? hit.clone() : undefined;
      },
      put: async (req, res) => {
        map.set(req.url, res.clone());
      },
      delete: async (req) => {
        map.delete(req.url);
      },
      map
    };
  }

  test('ミスなら元を待ち、次はキャッシュを即返す', async () => {
    const backend = memoryBackend();
    const cache = createPageCache(backend);
    let calls = 0;
    const fetchFresh = async () => {
      calls += 1;
      return { source: 'live', fetchedAt: new Date().toISOString(), value: calls };
    };

    const first = await cache.load({
      userKey: 'u1', path: '/orders', fetchFresh, ctx: { waitUntil: () => {} }
    });
    assert.equal(first.source, 'live');
    assert.equal(first.value, 1);
    assert.equal(calls, 1);

    const second = await cache.load({
      userKey: 'u1', path: '/orders', fetchFresh, ctx: { waitUntil: () => {} }
    });
    assert.equal(second.source, 'cache');
    assert.equal(second.value, 1);
    assert.equal(calls, 1);
  });

  test('revalidate 帯は即返しつつ裏で更新し revalidating を付ける', async () => {
    const backend = memoryBackend();
    const cache = createPageCache(backend);
    const now = Date.now();
    await cache.write('u1', '/reports', {
      source: 'live',
      fetchedAt: new Date(now - FRESH_MS - 1000).toISOString(),
      value: 'old'
    });

    let resolveFresh;
    const fetchFresh = () => new Promise((resolve) => {
      resolveFresh = () => resolve({
        source: 'live',
        fetchedAt: new Date(now).toISOString(),
        value: 'new'
      });
    });

    const pending = [];
    const ctx = { waitUntil: (p) => pending.push(p) };

    const served = await cache.load({
      userKey: 'u1', path: '/reports', fetchFresh, ctx, now
    });
    assert.equal(served.source, 'cache');
    assert.equal(served.revalidating, true);
    assert.equal(served.value, 'old');
    assert.equal(pending.length, 1);

    resolveFresh();
    await pending[0];
    const after = await cache.read('u1', '/reports');
    assert.equal(after.value, 'new');
  });

  test('mode=refresh は元を待って live を返す', async () => {
    const backend = memoryBackend();
    const cache = createPageCache(backend);
    const now = Date.now();
    await cache.write('u1', '/orders', {
      source: 'live',
      fetchedAt: new Date(now - 1000).toISOString(),
      value: 'old'
    });

    let calls = 0;
    const fresh = await cache.load({
      userKey: 'u1',
      path: '/orders',
      mode: 'refresh',
      now,
      fetchFresh: async () => {
        calls += 1;
        return { source: 'live', fetchedAt: new Date(now).toISOString(), value: 'new' };
      }
    });
    assert.equal(calls, 1);
    assert.equal(fresh.source, 'live');
    assert.equal(fresh.value, 'new');
    assert.equal((await cache.read('u1', '/orders')).value, 'new');
  });

  test('元アプリ失敗時は古いキャッシュを stale で返す', async () => {
    const backend = memoryBackend();
    const cache = createPageCache(backend);
    const now = Date.now();
    await cache.write('u1', '/dashboard', {
      source: 'live',
      fetchedAt: new Date(now - HARD_MAX_MS - 1000).toISOString(),
      value: 'last'
    });

    const served = await cache.load({
      userKey: 'u1',
      path: '/dashboard',
      now,
      ctx: { waitUntil: () => {} },
      fetchFresh: async () => {
        throw new Error('origin down');
      }
    });
    assert.equal(served.source, 'stale');
    assert.equal(served.value, 'last');
  });

  test('利用者区画が違えば混ざらない', async () => {
    const backend = memoryBackend();
    const cache = createPageCache(backend);
    await cache.write('alice', '/orders', {
      source: 'live', fetchedAt: new Date().toISOString(), who: 'alice'
    });
    await cache.write('bob', '/orders', {
      source: 'live', fetchedAt: new Date().toISOString(), who: 'bob'
    });
    assert.equal((await cache.read('alice', '/orders')).who, 'alice');
    assert.equal((await cache.read('bob', '/orders')).who, 'bob');
  });

  test('invalidate で消える', async () => {
    const backend = memoryBackend();
    const cache = createPageCache(backend);
    await cache.write('u1', '/orders', {
      source: 'live', fetchedAt: new Date().toISOString(), n: 1
    });
    await cache.invalidate('u1', ['/orders']);
    assert.equal(await cache.read('u1', '/orders'), null);
  });

  test('同時ミスは 1 回の取得にまとまる', async () => {
    const backend = memoryBackend();
    const cache = createPageCache(backend);
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchFresh = async () => {
      calls += 1;
      await gate;
      return { source: 'live', fetchedAt: new Date().toISOString(), value: calls };
    };

    const a = cache.load({
      userKey: 'u1', path: '/loans', fetchFresh, ctx: { waitUntil: () => {} }
    });
    const b = cache.load({
      userKey: 'u1', path: '/loans', fetchFresh, ctx: { waitUntil: () => {} }
    });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(calls, 1);
    assert.equal(ra.value, 1);
    assert.equal(rb.value, 1);
  });
});
