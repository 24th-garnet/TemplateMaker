// 領域の知識としての数。**畳の寸法と、壁に付くものの高さ。**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TATAMI, ROOM_H, PRESETS, defaultY, WALL_Y }
  from '../../templatemaker/web/spec.js';

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('江戸間を採っている', () => {
  // 京間（1.91×0.955）だと約 8% 広くなる。どちらを採ったかで
  // 「6畳に入るか」の答えが変わるので、ここで固定する
  near(TATAMI.w, 1.76);
  near(TATAMI.d, 0.88);
});

test('畳数と面積が合う', () => {
  const unit = TATAMI.w * TATAMI.d;
  let checked = 0;
  for (const [name, dims] of Object.entries(PRESETS)) {
    if (!dims) continue;                       // 「なし」は寸法を持たない
    near(dims[0] * dims[1], parseFloat(name) * unit, 1e-6);
    checked++;
  }
  assert.equal(checked, 4);
});

test('6畳は 2.64 × 3.52', () => {
  assert.deepEqual(PRESETS['6畳'], [2.64, 3.52]);
  assert.deepEqual(PRESETS['4.5畳'], [2.64, 2.64]);
});

test('なしは部屋を出さない', () => {
  assert.equal(PRESETS[''], null);
});

test('床置きは高さ 0', () => {
  near(defaultY('floor', 'chair', 0.9), 0);
  near(defaultY('floor_flat', 'rug', 0.02), 0);
});

test('壁に付くものは品目ごとの高さ', () => {
  near(defaultY('wall', 'mirror', 1.2), WALL_Y.mirror);
  near(defaultY('wall', 'wall_decor', 0.6), WALL_Y.wall_decor);
  near(defaultY('wall', 'headboard', 1.0), 0);
});

test('知らない壁掛けでも床には落とさない', () => {
  assert.ok(defaultY('wall', 'unknown', 0.5) > 0);
});

test('天井吊りは天井から下げる', () => {
  // 器具の高さぶん下がった位置が下端になる
  near(defaultY('ceiling', 'ceiling_light', 0.4), ROOM_H - 0.4);
  near(defaultY('ceiling', 'ceiling_light', 0), ROOM_H);
});

test('天井より背の高い器具でも床より下へは行かない', () => {
  near(defaultY('ceiling', 'ceiling_light', 99), 0);
});
