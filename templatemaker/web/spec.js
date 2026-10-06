// 領域の知識としての数。**依存を持たない。**
//
// 畳の寸法も通路の幅も、見れば分かるものではないし、根拠を失うと誰も動かせ
// なくなる。計算と混ぜずに 1 か所へ集め、なぜその数かを添える。

//: 江戸間（関東間）。関西の京間は約 8% 広いが、分譲マンションで最も一般的
//: なのはこちら。畳は地域で寸法が違うので、どれを採ったかを明示しておく
export const TATAMI = { w: 1.76, d: 0.88 };

//: 天井の高さ。目安なので UI には出さない
export const ROOM_H = 2.4;

//: 部屋の目安。面積は畳数 × 江戸間 1 枚ぶん
export const PRESETS = {
  '': null,
  '4.5畳': [2.64, 2.64],
  '6畳': [2.64, 3.52],
  '8畳': [3.52, 3.52],
  '10畳': [3.52, 4.40],
};

//: 壁に掛けるものの中心を合わせる高さ。絵も鏡も、下端ではなく**中心**を
//: 目線に合わせて掛ける。下端を固定すると、背の高いものほど上へ行き、
//: 実測では 1.22m の壁掛けが天井（2.4m）を 0.22m 突き抜けていた
export const EYE = 1.45;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** 品目と置き方から、置いたときの既定の高さ（下端）を決める。
 *
 * **自分の高さを見て決める。** 品目ごとの固定値だと、大きいものが天井を
 * 突き抜け、小さいものが床すれすれに来る。
 */
export function defaultY(placement, category, height) {
  const h = height || 0;
  if (placement === 'ceiling') return clamp(ROOM_H - h, 0, ROOM_H);
  if (placement === 'wall') {
    if (category === 'headboard') return 0;   // ベッドに付くので床から立つ
    return clamp(EYE - h / 2, 0, ROOM_H - h);
  }
  return 0;
}

//: 接しているだけの状態を重なりに数えないための余裕。
//:
//: **この数が無いと吸着と警告が打ち消し合う。** 接面で寄せた瞬間に「重なって
//: いる」と出ると、2 つの機能が互いを無意味にする。
export const OVERLAP_EPS = 0.002;

//: 下に入れて使う組み合わせ。**高さでは分けられない。**
//: 椅子は座面より背もたれが高く（約 0.85m）、食卓の天板は約 0.73m なので、
//: 高さで判定すると 4 脚の食卓セットが毎回警告を出す。押し込んだ椅子は
//: 誤りではなく正しい状態なので、組み合わせで明示的に許す
export const TUCK = new Set([
  'chair|table', 'chair|desk', 'stool|desk', 'stool|table', 'bench|table',
]);

/** 品目の組を正規化した鍵にする。順序に依らない */
export const pairKey = (a, b) => [a, b].sort().join('|');

//: 通路と動作域の基準（m）。人が通れるか、扉が開くかで決まる数で、
//: 和室・洋室どちらでも使われている一般値
export const CLEAR = {
  walk: 0.60,        // 通路。横向きなら通れる最小
  walkBusy: 0.80,    // よく通る所
  door: 0.80,        // 扉・引き出しの前
  sofaTable: 0.30,   // ソファ↔ローテーブル（30〜45cm の下限）
  dining: 0.90,      // 食卓まわり（90〜120cm）
  bedWall: 0.60,     // ベッド↔壁。寝具を直すのに要る
};

//: 品目の組ごとの下限。**近いのが正しい組み合わせ**がある
export const GAP = {
  'sofa|table': CLEAR.sofaTable,
  'bench|table': CLEAR.sofaTable,
  'chair|table': 0,      // 押し込むものなので間隔を問わない
  'chair|desk': 0,
  'stool|table': 0,
  'stool|desk': 0,
};

/** 2 品目の間に要る最小の間隔。
 *
 * **食卓まわりの 90〜120cm は自動で判定しない。** `table` がローテーブルと
 * 食卓を兼ねており、語彙は用途ではなく置き方で切ってあるため、どちらかを
 * 推測することになる。推測で警告を出すより、凡例に書いて人に委ねる。
 */
export const minGap = (a, b) => GAP[pairKey(a, b)] ?? CLEAR.walk;
