/* デモ用のダミーデータ。
 *
 * 通常は Worker の `/api/*` から元アプリの実データを取る。これはログインせずに
 * 画面の作りを見るとき（`?demo=1`）と、`/api/*` が無い静的配信のときの代わり。
 *
 * 形は API の応答に合わせる。画面側が 1 本の描画経路で済むようにするため。
 * 語彙は元アプリで確認できた範囲だけを使う（`../clone/NOTES.md`）。
 * ステータスは 未完了 / 完了 の 2 値だけ。中間状態を勝手に作らない。
 *
 * 期限の残り日数を出すため基準日を固定する。実データのときは当日を使う。
 */

export const DEMO_TODAY = '2026-08-05';
export const DEMO_USER = { name: '三谷 慧介', badge: 'U' };

const iso = (s) => s;

function wrap(payload) {
  return { source: 'demo', fetchedAt: new Date().toISOString(), ...payload };
}

// ── 週報 ───────────────────────────────────────────
const REPORT_SEED = [
  [102, '第2週 週報', '05-04', '05-10', '05-13', '05-06', '完了',
    '旋盤の基本操作を確認。端面削りと外径削りを一通り試し、切削条件をノートにまとめた。\n来週は突切りに入る。'],
  [103, '第3週 週報', '05-11', '05-17', '05-20', '05-12', '完了',
    '突切りで刃物が食い込む症状が出たので、送り速度を落として再試行。\n刃物台の剛性不足が原因と判断し、締結を見直した。'],
  [104, '第4週 週報', '05-18', '05-24', '05-27', '05-20', '完了',
    'フライス盤の段取りを担当。バイスの平行出しに時間がかかったので、手順を書き出して次回に備える。'],
  [105, '第5週 週報', '05-25', '05-31', '06-03', '05-27', '完了',
    '図面のはめあい公差を読み違えて再加工が発生した。指示記号の一覧を手元に置くことにした。'],
  [106, '第6週 週報', '06-01', '06-07', '06-10', '06-02', '完了',
    '治具の設計を開始。位置決めをピン 2 本で行う方針にして、担当と方式をすり合わせた。'],
  [107, '第7週 週報', '06-08', '06-14', '06-17', '06-10', '完了',
    '治具の部品を発注。納期が読めない部品があり、代替品の候補も併せて出した。'],
  [108, '第8週 週報', '06-15', '06-21', '06-24', '06-16', '完了',
    '溶接の練習。ビードが蛇行するので、運棒の速度を一定に保つ練習に時間を割いた。'],
  [109, '第9週 週報', '06-22', '06-28', '07-01', '06-24', '完了',
    '治具の仮組み。ピン穴の位置がわずかにずれていたため、リーマで修正した。'],
  [110, '第10週 週報', '06-29', '07-05', '07-08', '06-30', '完了',
    '治具を使って本加工。段取り替えの時間が短くなり、狙いどおりの効果を確認できた。'],
  [111, '第11週 週報', '07-06', '07-12', '07-15', '07-08', '完了',
    '検査工程を担当。マイクロメータの読み取りを 3 回平均に統一し、記録用紙を作り直した。'],
  [112, '第12週 週報', '07-13', '07-19', '07-22', '07-14', '未完了',
    '中間発表の資料づくりに入った。加工手順の写真がまだ足りない。'],
  [113, '第13週 週報', '07-20', '07-26', '07-29', '07-21', '未完了',
    '中間発表。質疑で治具の位置決め精度を聞かれ、根拠となる測定データが手元に無かった。', '岸 洋輔'],
  [114, '第14週 週報', '07-27', '08-02', '08-05', '07-28', '未完了',
    '位置決め精度の測定をやり直し中。'],
  [115, '第15週 週報', '08-03', '08-09', '08-12', '08-03', '未完了', '']
];

const YEAR = '2026';
const md = (v) => v.replace('-', '/');

export function demoReports() {
  const reports = REPORT_SEED.map(([id, title, from, to, due, created, status, body, lockedBy]) => ({
    id,
    title,
    period: `${md(from)} – ${md(to)}`,
    status,
    due: `${YEAR}/${md(due)}`,
    createdAt: `${YEAR}/${md(created)}`,
    dueISO: iso(`${YEAR}-${due}`),
    createdAtISO: iso(`${YEAR}-${created}`),
    periodStartISO: iso(`${YEAR}-${from}`),
    periodEndISO: iso(`${YEAR}-${to}`),
    body,
    lockedBy: lockedBy || null
  }));

  return wrap({
    columns: [
      { label: 'タイトル' }, { label: '期間' }, { label: 'ステータス' },
      { label: '期限' }, { label: '作成日' }
    ],
    counts: {
      未完了: reports.filter((r) => r.status === '未完了').length,
      完了: reports.filter((r) => r.status === '完了').length,
      合計: reports.length
    },
    empty: {
      title: '週報がありません',
      body: '管理者によって新しいレポートの締め切りが設定されると、ここにレポートが表示されます。'
    },
    reports
  });
}

// ── ダッシュボード ──────────────────────────────────
export function demoDashboard() {
  return wrap({
    heading: 'ダッシュボード',
    team: 'チーム: 10(未定)',
    notice: '調整中'
  });
}

// ── 注文 ───────────────────────────────────────────
const ORDER_SEED = [
  [21, 'アルミ丸棒 φ20 1m', 1480, 4, '08-01', '完了'],
  [22, '超硬バイト 12mm', 3280, 2, '07-28', '完了'],
  [23, 'ノギス 150mm', 5600, 1, '07-24', '完了'],
  [24, 'M4 六角穴付ボルト 100本', 980, 3, '07-20', '未完了'],
  [25, '位置決めピン φ6 h7', 220, 12, '07-16', '未完了'],
  [26, '切削油 1L', 1750, 2, '07-10', '完了']
];

export function demoOrders() {
  const orders = ORDER_SEED.map(([id, product, unitPrice, quantity, created, status]) => ({
    id,
    product,
    unitPrice: `¥${unitPrice.toLocaleString('ja-JP')}`,
    quantity: String(quantity),
    total: `¥${(unitPrice * quantity).toLocaleString('ja-JP')}`,
    status,
    createdAt: `${YEAR}/${md(created)}`,
    createdAtISO: iso(`${YEAR}-${created}`),
    unitPriceValue: unitPrice,
    quantityValue: quantity,
    totalValue: unitPrice * quantity
  }));

  return wrap({
    columns: [
      { label: '商品' }, { label: '単価' }, { label: '数量' },
      { label: '合計' }, { label: 'ステータス' }, { label: '作成日' }
    ],
    empty: { title: '注文がありません', body: '新しい注文を作成して始めましょう。' },
    orders
  });
}

// ── 機材 ───────────────────────────────────────────
export function demoEquipments() {
  return wrap({
    heading: '利用可能な機材',
    lede: '貸出申請可能な機材一覧',
    empty: { text: '現在利用可能な機材はありません。' },
    equipments: [
      { id: 3, name: 'デジタルノギス 150mm', meta: '計測 · 在庫 2', action: null },
      { id: 5, name: 'トルクレンチ 5–25N·m', meta: '工具 · 在庫 1', action: null },
      { id: 8, name: '卓上ボール盤', meta: '加工 · 在庫 1', action: null },
      { id: 11, name: '熱電対データロガー', meta: '計測 · 在庫 3', action: null }
    ]
  });
}

// ── 貸出 ───────────────────────────────────────────
export function demoLoans() {
  return wrap({
    heading: '機材貸出',
    lede: 'チームの現在と過去の機材貸出を確認できます',
    sections: [
      {
        key: 'pending',
        title: '申請中',
        empty: '申請中の貸出はありません。',
        items: [{ id: 41, name: 'トルクレンチ 5–25N·m', meta: '08/04 申請 · 承認待ち' }]
      },
      {
        key: 'active',
        title: '貸出中',
        empty: 'アクティブな貸出はありません。',
        items: [
          { id: 38, name: 'デジタルノギス 150mm', meta: '07/29 から · 返却予定 08/12' },
          { id: 36, name: '熱電対データロガー', meta: '07/22 から · 返却予定 08/19' }
        ]
      }
    ]
  });
}

// ── 通知 ───────────────────────────────────────────
export function demoNotifications() {
  return wrap({
    heading: '通知',
    unreadText: '未読 2 件',
    empty: { title: '通知はありません', body: '新しい通知が届くとここに表示されます。' },
    notifications: [
      {
        id: 91, title: '第14週 週報の期限が近づいています',
        body: '期限は 2026/08/05 です。', at: `${YEAR}/08/04`,
        atISO: `${YEAR}-08-04`, read: false
      },
      {
        id: 90, title: '「トルクレンチ 5–25N·m」の貸出申請を受け付けました',
        body: '担当者の承認をお待ちください。', at: `${YEAR}/08/04`,
        atISO: `${YEAR}-08-04`, read: false
      },
      {
        id: 88, title: '注文「ノギス 150mm」が完了しました',
        body: '受け取り場所は実習棟 2F です。', at: `${YEAR}/07/26`,
        atISO: `${YEAR}-07-26`, read: true
      }
    ]
  });
}
