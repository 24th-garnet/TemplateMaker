// 整列と等間隔。**辺で揃えること**と**隙間を均すこと**を固める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignDelta, spreadDelta, rotateAround, MODES }
  from '../../templatemaker/web/arrange.js';

const box = (cx, cz, w, d) => ({
  x0: cx - w / 2, x1: cx + w / 2, cx,
  z0: cz - d / 2, z1: cz + d / 2, cz,
});
const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const moved = (boxes, ds, ax = 'x') =>
  boxes.map((b, i) => ({ ...b,
    x0: b.x0 + ds[i].dx, x1: b.x1 + ds[i].dx, cx: b.cx + ds[i].dx,
    z0: b.z0 + ds[i].dz, z1: b.z1 + ds[i].dz, cz: b.cz + ds[i].dz }));

test('左揃えは一番左の辺に寄せる', () => {
  // **中心ではなく辺。** 大きさが違っても端が揃うのが「左揃え」
  const bs = [box(0, 0, 1, 1), box(2, 0, 3, 1)];
  const out = moved(bs, alignDelta(bs, 'x0'));
  near(out[0].x0, out[1].x0);
  near(out[0].x0, -0.5, 1e-9);
});

test('右揃えは一番右の辺に寄せる', () => {
  const bs = [box(0, 0, 1, 1), box(2, 0, 3, 1)];
  const out = moved(bs, alignDelta(bs, 'x1'));
  near(out[0].x1, out[1].x1);
  near(out[0].x1, 3.5);
});

test('中央揃えは外形の真ん中', () => {
  const bs = [box(0, 0, 1, 1), box(4, 0, 1, 1)];
  const out = moved(bs, alignDelta(bs, 'xc'));
  near(out[0].cx, 2); near(out[1].cx, 2);
});

test('奥と手前にも効く', () => {
  const bs = [box(0, 0, 1, 1), box(0, 3, 1, 2)];
  const out = moved(bs, alignDelta(bs, 'z0'));
  near(out[0].z0, out[1].z0);
  near(out[0].z0, -0.5);
});

test('揃える軸と直交する側は動かさない', () => {
  const bs = [box(0, 5, 1, 1), box(2, -3, 1, 1)];
  const ds = alignDelta(bs, 'x0');
  for (const d of ds) near(d.dz, 0);
});

test('1 体では何も起きない', () => {
  const ds = alignDelta([box(0, 0, 1, 1)], 'x0');
  near(ds[0].dx, 0);
});

test('知らない揃え方は無視する', () => {
  const bs = [box(0, 0, 1, 1), box(2, 0, 1, 1)];
  for (const d of alignDelta(bs, 'y0')) { near(d.dx, 0); near(d.dz, 0); }
  assert.equal(MODES.length, 6);
});

test('等間隔は隙間を均す', () => {
  // **中心ではなく隙間。** 大きさが違っても通り道が同じ幅になる
  const bs = [box(0, 0, 1, 1), box(2, 0, 3, 1), box(8, 0, 1, 1)];
  const { deltas, fits } = spreadDelta(bs, 'x');
  assert.equal(fits, true);
  const out = moved(bs, deltas);
  const g1 = out[1].x0 - out[0].x1;
  const g2 = out[2].x0 - out[1].x1;
  near(g1, g2, 1e-9);
});

test('等間隔でも両端は動かない', () => {
  // 全体の位置まで変わると、整えたつもりが場所まで変わる
  const bs = [box(0, 0, 1, 1), box(2, 0, 3, 1), box(8, 0, 1, 1)];
  const out = moved(bs, spreadDelta(bs, 'x').deltas);
  near(out[0].x0, bs[0].x0);
  near(out[2].x1, bs[2].x1);
});

test('中心を均すのとは違う結果になる', () => {
  // 大きさが違うとき、中心を均すと大きいものの脇だけ狭くなる。
  // **両端の幅を変えておく**——同じ幅だと隙間を均しても中心の間隔が一致する
  const bs = [box(0, 0, 1, 1), box(3, 0, 3, 1), box(8, 0, 2, 1)];
  const out = moved(bs, spreadDelta(bs, 'x').deltas);
  const spacingByCenter = Math.abs((out[1].cx - out[0].cx) - (out[2].cx - out[1].cx));
  assert.ok(spacingByCenter > 1e-6, '中心の間隔は等しくならない');
});

test('入りきらなければ中心を均して知らせる', () => {
  const bs = [box(0, 0, 3, 1), box(1, 0, 3, 1), box(2, 0, 3, 1)];
  const { fits, deltas } = spreadDelta(bs, 'x');
  assert.equal(fits, false);
  const out = moved(bs, deltas);
  near(out[1].cx - out[0].cx, out[2].cx - out[1].cx, 1e-9);
});

test('並び順が入れ違っていても左から並べ直す', () => {
  const bs = [box(8, 0, 1, 1), box(0, 0, 1, 1), box(4, 0, 1, 1)];
  const out = moved(bs, spreadDelta(bs, 'x').deltas);
  near(out[1].x0, 0 - 0.5, 1e-9);     // 一番左だったものが端のまま
  near(out[0].x1, 8 + 0.5, 1e-9);
});

test('2 体以下では等間隔にしない', () => {
  const bs = [box(0, 0, 1, 1), box(5, 0, 1, 1)];
  for (const d of spreadDelta(bs, 'x').deltas) near(d.dx, 0);
});

test('中心のまわりに回す', () => {
  // holder.rotation.y と同じ向き（+X が −Z へ向かう）
  const p = rotateAround(0, 0, 1, 0, Math.PI / 2);
  near(p.x, 0, 1e-12); near(p.z, -1, 1e-12);
});

test('四回まわすと元に戻る', () => {
  let p = { x: 2, z: 1 };
  for (let i = 0; i < 4; i++) p = rotateAround(0.5, -0.5, p.x, p.z, Math.PI / 2);
  near(p.x, 2, 1e-12); near(p.z, 1, 1e-12);
});

test('中心からの距離は変わらない', () => {
  const d0 = Math.hypot(2 - 0.5, 1 + 0.5);
  const p = rotateAround(0.5, -0.5, 2, 1, 0.7);
  near(Math.hypot(p.x - 0.5, p.z + 0.5), d0, 1e-12);
});
