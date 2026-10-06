// 吸着。**依存を持たない。**
//
// Sweet Home 3D の磁着（家具どうしが横に並んでくっつく）と、Figma のスマート
// ガイド（辺と中心が揃い、揃っている間だけ線が出る）を合わせたもの。
//
// **軸ごとに独立して 1 つだけ吸着する。** これでナイトテーブルが「X で接面、
// Z で頭側に辺揃え」のように 1 操作で決まる。両軸をまとめて 1 つにすると、
// どちらかを諦めることになる。
//
// 許容は**画面のピクセルで測る**（呼ぶ側が世界の長さに直して渡す）。引いて
// 全体を見ているときに 5mm しか吸わないのでは、吸う意味がない。

//: 関係の優先順。同じだけ近いなら、くっつく方を選ぶ
export const ABUT = 0;      // 接面。相手の辺に自分の辺を突き当てる
export const FLUSH = 1;     // 辺揃え。同じ側の辺を揃える
export const CENTER = 2;    // 中心揃え

const lo = (ax) => `${ax}0`;
const hi = (ax) => `${ax}1`;
const mid = (ax) => `c${ax}`;
const other = (ax) => (ax === 'x' ? 'z' : 'x');

/** 動かしているものと相手から、軸ごとの候補を並べる。 */
function candidates(m, others, walls, hasRoom) {
  const out = { x: [], z: [] };
  const pad = 0.15;

  for (const o of others) {
    // **90 度の倍数でない相手に辺は出さない。** 外接の辺は実際の側面では
    // ないので、辺揃えは嘘になる。中心だけなら回っていても正しい
    const edges = m.aligned && o.aligned;
    for (const ax of ['x', 'z']) {
      const b = other(ax);
      const span = [Math.min(m[lo(b)], o[lo(b)]) - pad,
                    Math.max(m[hi(b)], o[hi(b)]) + pad];
      if (edges) {
        out[ax].push({ d: o[lo(ax)] - m[hi(ax)], at: o[lo(ax)], rel: ABUT, span });
        out[ax].push({ d: o[hi(ax)] - m[lo(ax)], at: o[hi(ax)], rel: ABUT, span });
        out[ax].push({ d: o[lo(ax)] - m[lo(ax)], at: o[lo(ax)], rel: FLUSH, span });
        out[ax].push({ d: o[hi(ax)] - m[hi(ax)], at: o[hi(ax)], rel: FLUSH, span });
      }
      out[ax].push({ d: o[mid(ax)] - m[mid(ax)], at: o[mid(ax)], rel: CENTER, span });
    }
  }

  for (const w of walls) {
    const ax = w.axis, b = other(ax);
    const span = [m[lo(b)] - pad, m[hi(b)] + pad];
    out[ax].push({ d: w.at - m[lo(ax)], at: w.at, rel: ABUT, wall: true, span });
    out[ax].push({ d: w.at - m[hi(ax)], at: w.at, rel: ABUT, wall: true, span });
  }
  if (hasRoom) {
    // 部屋の中心線。ソファを壁の真ん中に据えるのはこれ
    for (const ax of ['x', 'z']) {
      const b = other(ax);
      out[ax].push({ d: 0 - m[mid(ax)], at: 0, rel: CENTER, wall: true,
                     span: [m[lo(b)] - pad, m[hi(b)] + pad] });
    }
  }
  return out;
}

/** 軸ごとに 1 つ選ぶ。近い順、同じなら接面を、さらに同じなら壁を優先。 */
function best(list, tol) {
  let win = null;
  for (const c of list) {
    if (Math.abs(c.d) > tol) continue;
    if (!win) { win = c; continue; }
    const a = [Math.abs(c.d), c.rel, c.wall ? 0 : 1];
    const b = [Math.abs(win.d), win.rel, win.wall ? 0 : 1];
    // 1mm 以内の差は「同じだけ近い」とみなす。でないと順位が震える
    if (a[0] < b[0] - 0.001
        || (Math.abs(a[0] - b[0]) <= 0.001 && (a[1] < b[1]
            || (a[1] === b[1] && a[2] < b[2])))) win = c;
  }
  return win;
}

/**
 * 吸着先を決める。
 *
 * @param m       動かしているものの外接 `{x0,x1,z0,z1,cx,cz,aligned}`
 * @param others  相手の外接（同じ形）。自分自身は呼ぶ側で外しておく
 * @param walls   `[{axis:'x'|'z', at}]`。内側の面の位置
 * @param tol     許容（世界の長さ）
 * @param hasRoom 部屋の中心線を候補に入れるか
 * @returns `{x: hit|null, z: hit|null}`。`hit` は `{d, at, rel, span}`
 */
export function snapMove(m, others, walls = [], tol = 0, hasRoom = false) {
  if (tol <= 0) return { x: null, z: null };
  const c = candidates(m, others, walls, hasRoom);
  return { x: best(c.x, tol), z: best(c.z, tol) };
}
