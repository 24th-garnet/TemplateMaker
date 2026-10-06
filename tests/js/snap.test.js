// 吸着。**軸ごとに独立して効くこと**と、優先順を固める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapMove, ABUT, FLUSH, CENTER } from '../../templatemaker/web/snap.js';

/** 中心と寸法から外接を作る */
const box = (cx, cz, w, d, aligned = true) => ({
  x0: cx - w / 2, x1: cx + w / 2, cx,
  z0: cz - d / 2, z1: cz + d / 2, cz, aligned,
});
const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('許容が 0 なら何も吸わない', () => {
  const r = snapMove(box(0, 0, 1, 1), [box(1.0, 0, 1, 1)], [], 0);
  assert.equal(r.x, null); assert.equal(r.z, null);
});

test('横に並べると辺が接面で吸う', () => {
  // 自分の右端 0.5、相手の左端 0.52 → 0.02 寄せれば接する
  const m = box(0, 0, 1, 1), o = box(1.02, 0, 1, 1);
  const r = snapMove(m, [o], [], 0.05);
  assert.equal(r.x.rel, ABUT);
  near(r.x.d, 0.02);
  near(r.x.at, 0.52);
});

test('軸ごとに別の関係が同時に効く', () => {
  // X では接面、Z では辺揃え。1 操作で両方決まるのが要点
  // 自分 x:-0.5..0.5 z:-1..1 / 相手 x:0.53..1.53 z:-0.95..1.05
  const m = box(0, 0, 1, 2);
  const o = box(1.03, 0.05, 1, 2);
  const r = snapMove(m, [o], [], 0.08);
  assert.equal(r.x.rel, ABUT, 'X は接面（0.03 寄せる）');
  near(r.x.d, 0.03);
  assert.ok(r.z, 'Z も同時に吸う');
  assert.equal(r.z.rel, FLUSH, 'Z は奥の辺を揃える（0.05 寄せる）');
  near(r.z.d, 0.05);
});

test('中心が近ければ中心で揃う', () => {
  const r = snapMove(box(0.02, 0, 0.5, 0.5), [box(0, 0, 3, 1)], [], 0.05);
  assert.equal(r.x.rel, CENTER);
  near(r.x.d, -0.02);
});

test('同じだけ近いなら接面を選ぶ', () => {
  // 接面と中心が同距離。くっつける方が意図に近い
  const m = box(0, 0, 1, 1);
  const o = box(1.0, 0, 1, 1);         // 接面は d=0
  const r = snapMove(m, [o], [], 0.5);
  assert.equal(r.x.rel, ABUT);
});

test('回っている相手には中心しか出さない', () => {
  // 外接の辺は実際の側面ではないので、辺揃えは嘘になる
  const m = box(0, 0, 1, 1, true);
  const o = box(1.02, 0, 1, 1, false);   // 斜めに回っている
  const r = snapMove(m, [o], [], 0.05);
  assert.ok(!r.x || r.x.rel === CENTER, '辺では吸わない');
});

test('自分が回っていても中心は効く', () => {
  const m = box(0.02, 0, 1, 1, false);
  const r = snapMove(m, [box(0, 0, 1, 1, true)], [], 0.05);
  assert.equal(r.x.rel, CENTER);
});

test('壁に寄せると接面で吸う', () => {
  const m = box(0, 0, 1, 1);
  const r = snapMove(m, [], [{ axis: 'x', at: -0.52 }], 0.05);
  assert.equal(r.x.rel, ABUT);
  near(r.x.d, -0.02);
  assert.equal(r.x.wall, true);
});

test('同じだけ近いなら壁を優先する', () => {
  // 壁は動かないので、迷ったら壁に合わせる方が後で困らない
  // 相手を大きくして、辺は遠く中心だけが一致する形にする。
  // 家具の中心と部屋の中心線がどちらも d=0 で並ぶ
  const m = box(0, 0, 1, 1);
  const o = box(0, 0, 3, 1);
  const r = snapMove(m, [o], [], 0.05, true);
  assert.equal(r.x.rel, CENTER);
  assert.equal(r.x.wall, true, '動かない壁を優先する');
});

test('部屋が無ければ中心線は候補に入らない', () => {
  const r = snapMove(box(0.01, 0, 1, 1), [], [], 0.05, false);
  assert.equal(r.x, null);
});

test('遠ければ吸わない', () => {
  // 両軸とも離す。z を揃えたままにすると z は正しく吸ってしまう
  const r = snapMove(box(0, 0, 1, 1), [box(5, 5, 1, 1)], [], 0.05);
  assert.equal(r.x, null); assert.equal(r.z, null);
});

test('片方の軸だけ揃っていれば、その軸だけ吸う', () => {
  // z は揃っているので吸うのが正しい。x は遠いので吸わない
  const r = snapMove(box(0, 0, 1, 1), [box(5, 0, 1, 1)], [], 0.05);
  assert.equal(r.x, null);
  assert.ok(r.z, 'z は揃っている');
  near(r.z.d, 0);
});

test('ガイド線は両方を覆う範囲を持つ', () => {
  const m = box(0, 0, 1, 1);             // z は -0.5..0.5
  const o = box(1.02, 2, 1, 1);          // z は 1.5..2.5
  const r = snapMove(m, [o], [], 0.05);
  assert.ok(r.x.span[0] <= -0.5 && r.x.span[1] >= 2.5, '両方を覆う');
});

test('相手が複数なら一番近いものに吸う', () => {
  const m = box(0, 0, 1, 1);
  const near1 = box(1.01, 0, 1, 1);      // d = 0.01
  const far = box(1.04, 0, 1, 1);        // d = 0.04
  const r = snapMove(m, [far, near1], [], 0.05);
  near(r.x.d, 0.01);
});

test('相手が居なければ落ちない', () => {
  const r = snapMove(box(0, 0, 1, 1), [], [], 0.05);
  assert.equal(r.x, null); assert.equal(r.z, null);
});
