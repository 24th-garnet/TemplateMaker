// 整列と等間隔。**依存を持たない。**
//
// 軸は 2D の見た目どおり。`cam2.up = (0,0,-1)` にしてあるので、画面右が +X、
// 画面の奥が −Z。3D で視点を回しても**世界軸のまま**にする——回すたびに
// 意味が変わるボタンの方が、抽象的なボタンより悪い。

//: 揃え方。`x0` は −X 側の辺、`xc` は中心、`x1` は +X 側の辺
export const MODES = ['x0', 'xc', 'x1', 'z0', 'zc', 'z1'];

const lo = (ax) => `${ax}0`;
const hi = (ax) => `${ax}1`;

/**
 * 揃えるための移動量。
 *
 * **中心ではなく外形の辺で揃える。** 家具を「左に揃える」と言うとき、
 * 揃えたいのは占めている場所の端であって、重心ではない。
 *
 * @param boxes `[{x0,x1,z0,z1,cx,cz}]`
 * @returns 各体の `{dx, dz}`
 */
export function alignDelta(boxes, mode) {
  const z = boxes.map(() => ({ dx: 0, dz: 0 }));
  if (boxes.length < 2 || !MODES.includes(mode)) return z;
  const ax = mode[0], kind = mode[1];
  const key = ax === 'x' ? 'dx' : 'dz';
  const min = Math.min(...boxes.map((b) => b[lo(ax)]));
  const max = Math.max(...boxes.map((b) => b[hi(ax)]));
  const mid = (min + max) / 2;
  boxes.forEach((b, i) => {
    if (kind === '0') z[i][key] = min - b[lo(ax)];
    else if (kind === '1') z[i][key] = max - b[hi(ax)];
    else z[i][key] = mid - b[`c${ax}`];
  });
  return z;
}

/**
 * 等間隔に並べるための移動量。
 *
 * **中心の間隔ではなく隙間を均す。** 家具の「等間隔」は、大きさが違っても
 * 通り道が同じ幅になることを指す。中心を均すと、大きいものの脇だけ狭くなる。
 *
 * 両端は動かさない。全体の位置まで変わると、整えたつもりが場所まで変わる。
 *
 * @returns `{deltas, fits}`。入りきらなければ `fits:false` で中心を均す
 */
export function spreadDelta(boxes, ax = 'x') {
  const z = boxes.map(() => ({ dx: 0, dz: 0 }));
  if (boxes.length < 3) return { deltas: z, fits: true };
  const key = ax === 'x' ? 'dx' : 'dz';
  const order = boxes.map((b, i) => i)
    .sort((a, b) => boxes[a][`c${ax}`] - boxes[b][`c${ax}`]);
  const first = boxes[order[0]], last = boxes[order.at(-1)];
  const span = last[hi(ax)] - first[lo(ax)];
  const sum = boxes.reduce((t, b) => t + (b[hi(ax)] - b[lo(ax)]), 0);
  const gap = (span - sum) / (boxes.length - 1);
  if (gap < 0) {
    // 入りきらない。中心を均して、少なくとも規則正しくする
    const a = first[`c${ax}`], b = last[`c${ax}`];
    order.forEach((idx, k) => {
      const want = a + (b - a) * k / (order.length - 1);
      z[idx][key] = want - boxes[idx][`c${ax}`];
    });
    return { deltas: z, fits: false };
  }
  let pos = first[lo(ax)];
  for (const idx of order) {
    z[idx][key] = pos - boxes[idx][lo(ax)];
    pos += (boxes[idx][hi(ax)] - boxes[idx][lo(ax)]) + gap;
  }
  return { deltas: z, fits: true };
}

/** 中心のまわりに回したときの位置。`holder.rotation.y` と同じ向き。 */
export function rotateAround(cx, cz, x, z, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const dx = x - cx, dz = z - cz;
  return { x: cx + dx * c + dz * s, z: cz - dx * s + dz * c };
}
