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
