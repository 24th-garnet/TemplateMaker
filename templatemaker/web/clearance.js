// 重なりと間隔。**three.js にも DOM にも依存しない。**
//
// 重なりは**許して警告する**。構成中の一時的な重なりは正常で、吸着が大半を
// 未然に防ぐ。置けなくすると、意図的に重ねたい配置まで止めることになる。
import { rectHit } from './geom.js';
import { OVERLAP_EPS, TUCK, pairKey } from './spec.js';

/**
 * 2 体が重なっているか。
 *
 * 形は `{rect, y0, y1, place, cat}`。`rect` は geom の長方形。
 */
export function collides(A, B, eps = OVERLAP_EPS) {
  // 壁付け・天井吊りは床置きとぶつからない。ヘッドボードはベッドに食い込んで
  // いるのが正しい姿
  const off = (p) => p === 'wall' || p === 'ceiling';
  if (A.place !== B.place && (off(A.place) || off(B.place))) return false;

  // 敷物の上には置ける。敷物どうしだけは見る
  if ((A.place === 'floor_flat') !== (B.place === 'floor_flat')) return false;

  // 高さが離れていれば重ならない（机の上のランプ）
  if (A.y1 <= B.y0 + eps || B.y1 <= A.y0 + eps) return false;

  if (TUCK.has(pairKey(A.cat, B.cat))) return false;

  return rectHit(A.rect, B.rect, eps);
}

/** 重なっている組をすべて返す。`[[i, j], ...]` */
export function overlapPairs(list, eps = OVERLAP_EPS) {
  const out = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (collides(list[i], list[j], eps)) out.push([i, j]);
  return out;
}

/** 重なっている体の添字。 */
export function overlapping(list, eps = OVERLAP_EPS) {
  const s = new Set();
  for (const [i, j] of overlapPairs(list, eps)) { s.add(i); s.add(j); }
  return s;
}

import { aabb } from './geom.js';
import { CLEAR, minGap } from './spec.js';

const SIDES = [
  { key: '+x', ax: 'x', dir: 1 }, { key: '-x', ax: 'x', dir: -1 },
  { key: '+z', ax: 'z', dir: 1 }, { key: '-z', ax: 'z', dir: -1 },
];

/**
 * 選んだ 1 体の四方の間隔。**辺ごとに 1 つ、最大 4 本。**
 *
 * 体数が 3 でも 30 でも表示量が変わらないのが、雑音にしないための仕掛け。
 * 向かい合っているものだけ測る——横にずれて並ぶものとの隙間は通り道ではない。
 */
export function gaps(subject, others, walls = []) {
  const S = { ...aabb(subject.rect), cat: subject.cat };
  const out = {};

  const put = (key, dist, at, span, cat) => {
    if (dist < 0) return;
    const need = minGap(S.cat, cat);
    if (!need) return;                       // 押し込む組み合わせは測らない
    if (!out[key] || dist < out[key].dist)
      out[key] = { key, dist, at, span, cat, need, tight: dist < need - 1e-9 };
  };

  for (const o of others) {
    // 高さが離れていれば通路の話ではない（机の上のランプ）
    if (o.y1 <= subject.y0 + 1e-6 || subject.y1 <= o.y0 + 1e-6) continue;
    if (o.place === 'wall' || o.place === 'ceiling') continue;
    const O = aabb(o.rect);
    for (const s of SIDES) {
      const ax = s.ax, b = ax === 'x' ? 'z' : 'x';
      // **向かい合っているか。** 直交する側で範囲が重なっていなければ、
      // その隙間は通り道ではない
      if (O[`${b}0`] >= S[`${b}1`] || O[`${b}1`] <= S[`${b}0`]) continue;
      const span = [Math.max(S[`${b}0`], O[`${b}0`]),
                    Math.min(S[`${b}1`], O[`${b}1`])];
      if (s.dir > 0 && O[`${ax}0`] >= S[`${ax}1`])
        put(s.key, O[`${ax}0`] - S[`${ax}1`], S[`${ax}1`], span, o.cat);
      if (s.dir < 0 && O[`${ax}1`] <= S[`${ax}0`])
        put(s.key, S[`${ax}0`] - O[`${ax}1`], S[`${ax}0`], span, o.cat);
    }
  }

  for (const w of walls) {
    const ax = w.axis, b = ax === 'x' ? 'z' : 'x';
    const span = [S[`${b}0`], S[`${b}1`]];
    if (w.at >= S[`${ax}1`]) put(`+${ax}`, w.at - S[`${ax}1`], S[`${ax}1`], span, 'wall');
    if (w.at <= S[`${ax}0`]) put(`-${ax}`, S[`${ax}0`] - w.at, S[`${ax}0`], span, 'wall');
  }

  return Object.values(out);
}

export { CLEAR };
