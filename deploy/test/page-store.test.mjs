/* page-store.js の純関数。ネットワーク不要。 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(here, '../../fork/page-store.js')).href);
const {
  contentChanged, forget, forgetAll, reachableRoutes, recall, remember
} = mod;

describe('page-store', () => {
  test('remember / recall / forget', () => {
    forgetAll();
    remember('/orders', { source: 'live', fetchedAt: 'a', n: 1 });
    assert.equal(recall('/orders').n, 1);
    forget('/orders');
    assert.equal(recall('/orders'), null);
  });

  test('contentChanged は source の差を無視する', () => {
    const a = { source: 'cache', revalidating: true, fetchedAt: 't1', n: 1 };
    const b = { source: 'live', fetchedAt: 't1', n: 1 };
    const c = { source: 'live', fetchedAt: 't2', n: 1 };
    assert.equal(contentChanged(a, b), false);
    assert.equal(contentChanged(a, c), true);
  });

  test('reachableRoutes は現在以外', () => {
    assert.deepEqual(
      reachableRoutes(['/a', '/b', '/c'], '/b'),
      ['/a', '/c']
    );
  });
});
