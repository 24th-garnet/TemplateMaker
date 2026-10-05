// 回した長方形の算術。**符号と軸を固定する。**
// 45° 付近でだけ壊れる誤りは目で見て気づけないので、ここで押さえる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rect, aabb, corners, rectHit, unionAabb, axisAligned, axisX, axisZ, snapTo }
  from '../../templatemaker/web/geom.js';

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const D = (deg) => deg * Math.PI / 180;

test('回さなければ外接は寸法そのもの', () => {
  const b = aabb(rect(0, 0, 2, 1));
  near(b.w, 2); near(b.d, 1);
});

test('90度で幅と奥行が入れ替わる', () => {
  const b = aabb(rect(0, 0, 2, 1, D(90)));
  near(b.w, 1); near(b.d, 2);
});

test('45度で外接が膨らむ', () => {
  // 外接で重なりを判定してはいけない理由がこれ
  const b = aabb(rect(0, 0, 1, 1, D(45)));
  near(b.w, Math.SQRT2, 1e-12);
});

test('正面はローカル+Z', () => {
  // 回転つまみの印と同じ約束。ここがずれると壁付けの向きが裏返る
  const [x, z] = axisZ(0); near(x, 0); near(z, 1);
  const [x2, z2] = axisZ(D(90)); near(x2, 1); near(z2, 0, 1e-15);
  const [ux, uz] = axisX(D(90)); near(ux, 0, 1e-15); near(uz, -1);
});

test('四隅は中心のまわりに散る', () => {
  const c = corners(rect(1, 2, 2, 4));
  assert.equal(c.length, 4);
  near(c.reduce((s, p) => s + p[0], 0) / 4, 1);
  near(c.reduce((s, p) => s + p[1], 0) / 4, 2);
});

test('離れていれば重ならない', () => {
  assert.equal(rectHit(rect(0, 0, 1, 1), rect(5, 0, 1, 1)), false);
});

test('食い込んでいれば重なる', () => {
  assert.equal(rectHit(rect(0, 0, 1, 1), rect(0.5, 0, 1, 1)), true);
});

test('接しているだけなら重なりに数えない', () => {
  // 吸着でぴったり寄せた直後に警告が出ると、2 つの機能が打ち消し合う
  const a = rect(0, 0, 1, 1), b = rect(1, 0, 1, 1);
  assert.equal(rectHit(a, b, 0.002), false);
  assert.equal(rectHit(a, rect(0.999, 0, 1, 1), 0.002), false);  // 1mm 食い込みは許す
  assert.equal(rectHit(a, rect(0.99, 0, 1, 1), 0.002), true);    // 10mm は重なり
});

test('外接では重なるが実際は重ならない配置を見分ける', () => {
  // 45度に回した正方形を**斜めに**ずらす。軸の上に並べただけでは外接と
  // 分離軸が同じ答えになるので、SAT が要る理由が出ない
  const a = rect(0, 0, 1, 1, D(45));
  const b = rect(0.75, 0.75, 1, 1, D(45));
  assert.equal(rectHit(a, b), false, '菱形どうしは触れていない');

  const ab = aabb(a), bb = aabb(b);
  assert.ok(ab.x1 > bb.x0 && ab.z1 > bb.z0,
    '外接どうしは両軸で重なっている（だから外接では代用できない）');
});

test('回した相手でも食い込みは検出する', () => {
  assert.equal(rectHit(rect(0, 0, 2, 1, D(30)), rect(0.3, 0.2, 2, 1, D(70))), true);
});

test('重なり判定は順序によらない', () => {
  const a = rect(0, 0, 2, 1, D(23)), b = rect(1.2, 0.4, 1, 3, D(61));
  assert.equal(rectHit(a, b, 0.002), rectHit(b, a, 0.002));
});

test('外接の和', () => {
  const u = unionAabb([rect(0, 0, 1, 1), rect(3, 0, 1, 1)]);
  near(u.x0, -0.5); near(u.x1, 3.5); near(u.w, 4);
  assert.equal(unionAabb([]), null);
});

test('90度の倍数かどうか', () => {
  // 倍数でない相手には辺の吸着を出さない。外接の辺は実際の側面ではない
  for (const d of [0, 90, 180, 270, 360, -90]) assert.ok(axisAligned(D(d)), `${d}`);
  for (const d of [15, 45, 89, 1]) assert.equal(axisAligned(D(d)), false, `${d}`);
  assert.ok(axisAligned(D(90.3)), '0.5度までは許す');
});

test('刻みに丸める', () => {
  near(snapTo(0.1234), 0.125);
  near(snapTo(1.0), 1.0);
  near(snapTo(0.123, 0.05), 0.10);
});
