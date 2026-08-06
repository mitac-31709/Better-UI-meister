/* 画面 JSON のタブ内メモリ。遷移を即時にし、裏更新の結果も保持する。 */

const store = new Map();

export function remember(route, data) {
  if (!route || !data) return;
  store.set(route, data);
}

export function recall(route) {
  return store.get(route) || null;
}

export function forget(route) {
  store.delete(route);
}

export function forgetAll() {
  store.clear();
}

/** 表示内容が変わったか（source / revalidating は無視）。 */
export function contentChanged(a, b) {
  if (!a || !b) return a !== b;
  if (a.fetchedAt !== b.fetchedAt) return true;
  return stablePayload(a) !== stablePayload(b);
}

function stablePayload(data) {
  const copy = { ...data };
  delete copy.source;
  delete copy.revalidating;
  return JSON.stringify(copy);
}

/** 現在画面のレールから行ける他ルート。 */
export function reachableRoutes(allRoutes, current) {
  return allRoutes.filter((r) => r !== current);
}
