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
