// 回した長方形の算術。**three.js に依存しない。**
//
// 家具は鉛直軸まわりにしか回らないので、配置の判断はすべて 2 次元で足りる。
// ここを素の数だけで書いておくと `node --test` で試せる——符号と軸の取り違えは
// 目で見て気づきにくく、45° 付近でだけ壊れる類の誤りが出る。
//
// **軸の約束。** `holder.rotation.y = t` のとき、ローカルの点 (lx, lz) は
// 世界の (lx·cos t + lz·sin t, −lx·sin t + lz·cos t) へ写る（three.js の +Y
// まわりの回転行列そのもの）。したがって
//   ローカル +X の向き = ( cos t, −sin t)
//   ローカル +Z の向き = ( sin t,  cos t)   ← **正面**。回転つまみの印と同じ
// この 2 行を間違えると、整列も吸着も間隔もまとめてずれる。

/** 長方形。`t` は鉛直軸まわりの角（ラジアン）。 */
export function rect(cx, cz, w, d, t = 0) {
  return { cx, cz, hw: w / 2, hd: d / 2, t };
}

/** ローカル軸の世界での向き。 */
export const axisX = (t) => [Math.cos(t), -Math.sin(t)];
export const axisZ = (t) => [Math.sin(t), Math.cos(t)];

/** 回した後の、軸に沿った外接。 */
export function aabb(r) {
  const c = Math.abs(Math.cos(r.t)), s = Math.abs(Math.sin(r.t));
  const w = r.hw * 2 * c + r.hd * 2 * s;
  const d = r.hw * 2 * s + r.hd * 2 * c;
  return { x0: r.cx - w / 2, x1: r.cx + w / 2,
           z0: r.cz - d / 2, z1: r.cz + d / 2, w, d };
}

/** 四隅。足元の輪郭を描くのと、画面に投げるのに使う。 */
export function corners(r) {
  const [ux, uz] = axisX(r.t), [vx, vz] = axisZ(r.t);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [
    r.cx + a * r.hw * ux + b * r.hd * vx,
    r.cz + a * r.hw * uz + b * r.hd * vz,
  ]);
}

/** 1 本の軸へ落としたときの、中心と半幅。 */
function proj(r, ax) {
  const [ax0, ax1] = ax;
  return {
    c: r.cx * ax0 + r.cz * ax1,
    e: r.hw * Math.abs(Math.cos(r.t) * ax0 - Math.sin(r.t) * ax1)
     + r.hd * Math.abs(Math.sin(r.t) * ax0 + Math.cos(r.t) * ax1),
  };
}

/** 回した長方形どうしが重なるか（分離軸）。
 *
 * **外接矩形で代用しない。** 45° の椅子は外接が 1.41 倍に膨らむので、
 * 既定の刻みが 15° であるこの道具では誤報が常態になる。
 *
 * `eps` を正にすると、接しているだけの状態は重なりに数えない。吸着で
 * ぴったり寄せた直後に警告が出ると、2 つの機能が打ち消し合う。
 */
export function rectHit(A, B, eps = 0) {
  for (const r of [A, B]) {
    for (const ax of [axisX(r.t), axisZ(r.t)]) {
      const a = proj(A, ax), b = proj(B, ax);
      if (a.c + a.e <= b.c - b.e + eps) return false;
      if (b.c + b.e <= a.c - a.e + eps) return false;
    }
  }
  return true;
}

/** 外接の和。空なら null。 */
export function unionAabb(rects) {
  let out = null;
  for (const r of rects) {
    const b = aabb(r);
    if (!out) { out = { ...b }; continue; }
    out.x0 = Math.min(out.x0, b.x0); out.x1 = Math.max(out.x1, b.x1);
    out.z0 = Math.min(out.z0, b.z0); out.z1 = Math.max(out.z1, b.z1);
  }
  if (out) { out.w = out.x1 - out.x0; out.d = out.z1 - out.z0; }
  return out;
}

/** 90 度の倍数か。辺どうしの吸着を許してよい相手かの判定に使う。 */
export function axisAligned(t, tolDeg = 0.5) {
  const d = ((t * 180 / Math.PI) % 90 + 90) % 90;
  return Math.min(d, 90 - d) <= tolDeg;
}

/** 刻みに丸める。既定は 5mm。 */
export const snapTo = (v, step = 0.005) => Math.round(v / step) * step;
