/* session.js の封印・開封。ネットワーク不要。 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { seal, setCookieHeader, unseal } from '../src/session.js';

const SECRET = 'test-session-secret-for-unit-tests';

describe('session', () => {
  test('封印した Cookie を開ける', async () => {
    const token = await seal({ cookie: 'rails=abc', name: '太郎' }, SECRET);
    const opened = await unseal(token, SECRET);
    assert.equal(opened.cookie, 'rails=abc');
    assert.equal(opened.name, '太郎');
  });

  test('旧トークンの exp は無視する（4 時間制限の撤廃）', async () => {
    const token = await seal({
      cookie: 'rails=old',
      exp: Date.now() - 60_000
    }, SECRET);
    const opened = await unseal(token, SECRET);
    assert.ok(opened);
    assert.equal(opened.cookie, 'rails=old');
  });

  test('改竄や別鍵は null', async () => {
    const token = await seal({ cookie: 'rails=x' }, SECRET);
    assert.equal(await unseal('aaaa.bbbb', SECRET), null);
    assert.equal(await unseal(token, 'other-secret'), null);
  });

  test('Set-Cookie は 4 時間より長い Max-Age', () => {
    const header = setCookieHeader('tok');
    assert.match(header, /Max-Age=(\d+)/);
    const age = Number(header.match(/Max-Age=(\d+)/)[1]);
    assert.ok(age > 4 * 60 * 60, `Max-Age が短い: ${age}`);
  });
});
