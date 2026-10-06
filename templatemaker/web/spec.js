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

//: 壁に付くものの既定の高さ（下端）。部屋が無くても使う
export const WALL_Y = { mirror: 0.90, wall_decor: 1.40, headboard: 0 };

/** 品目と置き方から、置いたときの既定の高さを決める。
 *
 * 壁掛けや天井吊りを床に置いても意味がない。
 */
export function defaultY(placement, category, height) {
  if (placement === 'ceiling') return Math.max(0, ROOM_H - (height || 0));
  if (placement === 'wall') return WALL_Y[category] ?? 1.0;
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
