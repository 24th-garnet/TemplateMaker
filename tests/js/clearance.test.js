// 重なりの判定。**吸着と打ち消し合わないこと**と、例外を固める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collides, overlapPairs, overlapping }
  from '../../templatemaker/web/clearance.js';
import { rect } from '../../templatemaker/web/geom.js';
import { OVERLAP_EPS } from '../../templatemaker/web/spec.js';

/** 床置きの 1 体 */
const it = (cx, cz, w, d, cat = 'sofa', opt = {}) => ({
  rect: rect(cx, cz, w, d, opt.t ?? 0),
  y0: opt.y0 ?? 0, y1: (opt.y0 ?? 0) + (opt.h ?? 0.8),
  place: opt.place ?? 'floor', cat,
});

test('食い込んでいれば重なり', () => {
  assert.equal(collides(it(0, 0, 1, 1), it(0.5, 0, 1, 1)), true);
});

test('離れていれば重ならない', () => {
  assert.equal(collides(it(0, 0, 1, 1), it(3, 0, 1, 1)), false);
});

test('接面で寄せた直後に警告が出ない', () => {
  // **これが無いと吸着と警告が互いを無意味にする。**
  // 吸着はぴったり接する位置へ寄せるので、接触を重なりに数えてはいけない
  assert.equal(collides(it(0, 0, 1, 1), it(1, 0, 1, 1)), false);
  // 1mm の食い込みも許す（丸めの誤差の範囲）
  assert.equal(collides(it(0, 0, 1, 1), it(0.999, 0, 1, 1)), false);
  // 10mm は重なり
  assert.equal(collides(it(0, 0, 1, 1), it(0.99, 0, 1, 1)), true);
});

test('机の上のランプは重なりに数えない', () => {
  const desk = it(0, 0, 1.2, 0.6, 'desk', { h: 0.75 });
  const lamp = it(0, 0, 0.2, 0.2, 'lamp', { y0: 0.75, h: 0.4 });
  assert.equal(collides(desk, lamp), false);
});

test('同じ高さに重なれば数える', () => {
  const desk = it(0, 0, 1.2, 0.6, 'desk', { h: 0.75 });
  const box = it(0, 0, 0.2, 0.2, 'storage', { y0: 0.3, h: 0.4 });
  assert.equal(collides(desk, box), true);
});

test('椅子は机や食卓の下に入る', () => {
  // 椅子 0.85m・天板 0.73m で高さでは分けられない。これが無いと
  // 4 脚の食卓セットが毎回警告を出す
  const table = it(0, 0, 1.6, 0.9, 'table', { h: 0.73 });
  const chair = it(0, 0.3, 0.5, 0.5, 'chair', { h: 0.85 });
  assert.equal(collides(table, chair), false);
  assert.equal(collides(chair, table), false, '順序に依らない');
  const desk = it(0, 0, 1.2, 0.6, 'desk', { h: 0.73 });
  assert.equal(collides(desk, chair), false);
});

test('椅子どうしは重なりを見る', () => {
  const a = it(0, 0, 0.5, 0.5, 'chair', { h: 0.85 });
  const b = it(0.2, 0, 0.5, 0.5, 'chair', { h: 0.85 });
  assert.equal(collides(a, b), true);
});

test('敷物の上には置ける', () => {
  const rug = it(0, 0, 2, 1.5, 'rug', { place: 'floor_flat', h: 0.02 });
  const sofa = it(0, 0, 2, 0.9, 'sofa', { h: 0.8 });
  assert.equal(collides(rug, sofa), false);
});

test('敷物どうしの重なりは見る', () => {
  const a = it(0, 0, 2, 1.5, 'rug', { place: 'floor_flat', h: 0.02 });
  const b = it(0.5, 0, 2, 1.5, 'rug', { place: 'floor_flat', h: 0.02 });
  assert.equal(collides(a, b), true);
});

test('壁付けは床置きとぶつからない', () => {
  // ヘッドボードはベッドに食い込んでいるのが正しい
  const bed = it(0, 0, 1.4, 2, 'bed', { h: 0.5 });
  const hb = it(0, -0.9, 1.4, 0.1, 'headboard', { place: 'wall', h: 1.0 });
  assert.equal(collides(bed, hb), false);
});

test('壁付けどうしは重なりを見る', () => {
  const a = it(0, 0, 1, 0.1, 'mirror', { place: 'wall', y0: 0.9, h: 1 });
  const b = it(0.2, 0, 1, 0.1, 'wall_decor', { place: 'wall', y0: 0.9, h: 1 });
  assert.equal(collides(a, b), true);
});

test('天井吊りは床置きとぶつからない', () => {
  const light = it(0, 0, 0.5, 0.5, 'ceiling_light', { place: 'ceiling', y0: 2, h: 0.4 });
  const table = it(0, 0, 1.6, 0.9, 'table', { h: 0.73 });
  assert.equal(collides(light, table), false);
});

test('回した相手でも判定する', () => {
  const a = it(0, 0, 2, 0.8, 'sofa', { t: 0 });
  const b = it(0.3, 0.2, 2, 0.8, 'sofa', { t: Math.PI / 4 });
  assert.equal(collides(a, b), true);
});

test('組をすべて拾う', () => {
  const list = [it(0, 0, 1, 1), it(0.5, 0, 1, 1), it(5, 5, 1, 1)];
  assert.deepEqual(overlapPairs(list), [[0, 1]]);
  assert.deepEqual([...overlapping(list)].sort(), [0, 1]);
});

test('何も無ければ空', () => {
  assert.deepEqual(overlapPairs([]), []);
  assert.equal(overlapping([it(0, 0, 1, 1)]).size, 0);
});

test('許容は外から変えられる', () => {
  const a = it(0, 0, 1, 1), b = it(0.995, 0, 1, 1);  // 5mm 食い込み
  assert.equal(collides(a, b, OVERLAP_EPS), true);
  assert.equal(collides(a, b, 0.01), false, '許容を広げれば見逃す');
});

// --- 間隔 -----------------------------------------------------------------
import { gaps } from '../../templatemaker/web/clearance.js';
import { CLEAR } from '../../templatemaker/web/spec.js';

const side = (g, k) => g.find((x) => x.key === k);
const nearly = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('向かい合うものとの隙間を測る', () => {
  const s = it(0, 0, 1, 1);
  const o = it(1.7, 0, 1, 1);           // 隙間 0.7
  const g = gaps(s, [o]);
  nearly(side(g, '+x').dist, 0.7);
  assert.equal(side(g, '+x').tight, false, '通路 0.6 を満たす');
});

test('狭ければ警告になる', () => {
  const g = gaps(it(0, 0, 1, 1), [it(1.4, 0, 1, 1)]);   // 隙間 0.4
  assert.equal(side(g, '+x').tight, true);
  nearly(side(g, '+x').need, CLEAR.walk);
});

test('横にずれているだけなら通り道ではない', () => {
  // 直交する側で範囲が重なっていなければ測らない
  const g = gaps(it(0, 0, 1, 1), [it(1.7, 5, 1, 1)]);
  assert.equal(g.length, 0);
});

test('辺ごとに一番近いものだけ', () => {
  const s = it(0, 0, 1, 1);
  const g = gaps(s, [it(1.7, 0, 1, 1), it(2.5, 0, 1, 1)]);
  assert.equal(g.filter((x) => x.key === '+x').length, 1);
  nearly(side(g, '+x').dist, 0.7);
});

test('四方で最大 4 本', () => {
  // 体数が増えても表示量が変わらないのが雑音対策
  const s = it(0, 0, 1, 1);
  const o = [];
  for (let i = 0; i < 20; i++) o.push(it(1.7 + i * 0.1, 0, 1, 1));
  o.push(it(-1.7, 0, 1, 1), it(0, 1.7, 1, 1), it(0, -1.7, 1, 1));
  assert.ok(gaps(s, o).length <= 4);
});

test('壁との隙間も測る', () => {
  const g = gaps(it(0, 0, 1, 1), [], [{ axis: 'x', at: 1.0 }]);
  nearly(side(g, '+x').dist, 0.5);
  assert.equal(side(g, '+x').cat, 'wall');
  assert.equal(side(g, '+x').tight, true, 'ベッド↔壁の 0.6 を割る');
});

test('ソファとローテーブルは近くてよい', () => {
  // 通路の 0.6 を当てると、正しい配置に警告が出る
  const sofa = it(0, 0, 2, 0.9, 'sofa');
  const tbl = it(0, 1.05, 1.1, 0.5, 'table');   // 隙間 0.4
  const g = gaps(sofa, [tbl]);
  nearly(side(g, '+z').need, CLEAR.sofaTable);
  assert.equal(side(g, '+z').tight, false);
});

test('押し込む組み合わせは測らない', () => {
  const tbl = it(0, 0, 1.6, 0.9, 'table', { h: 0.73 });
  const chair = it(0, 0.8, 0.5, 0.5, 'chair', { h: 0.85 });
  assert.equal(gaps(tbl, [chair]).length, 0);
});

test('高さが離れていれば通路の話ではない', () => {
  const desk = it(0, 0, 1.2, 0.6, 'desk', { h: 0.75 });
  const lamp = it(0, 0.5, 0.2, 0.2, 'lamp', { y0: 0.75, h: 0.4 });
  assert.equal(gaps(desk, [lamp]).length, 0);
});

test('壁掛けは床の通路に数えない', () => {
  const sofa = it(0, 0, 2, 0.9, 'sofa');
  const art = it(0, 1.2, 1, 0.1, 'wall_decor', { place: 'wall', y0: 1.2, h: 0.6 });
  assert.equal(gaps(sofa, [art]).length, 0);
});

test('重なっているものは隙間を持たない', () => {
  assert.equal(gaps(it(0, 0, 1, 1), [it(0.5, 0, 1, 1)]).length, 0);
});

test('線を引く範囲は向かい合う部分だけ', () => {
  const s = it(0, 0, 1, 2);            // z: -1..1
  const o = it(1.7, 0.5, 1, 1);        // z: 0..1
  const g = side(gaps(s, [o]), '+x');
  nearly(g.span[0], 0); nearly(g.span[1], 1);
});
