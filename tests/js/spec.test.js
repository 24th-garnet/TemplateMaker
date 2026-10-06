// 領域の知識としての数。**畳の寸法と、壁に付くものの高さ。**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TATAMI, ROOM_H, PRESETS, defaultY, EYE }
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

test('壁に掛けるものは中心が目線に来る', () => {
  // **下端を固定しない。** 自分の高さを見て決めないと、大きいものほど上へ行く
  for (const h of [0.31, 0.61, 1.22]) {
    const y = defaultY('wall', 'wall_decor', h);
    near(y + h / 2, EYE, 1e-9);
  }
});

test('背の高い壁掛けでも天井を突き抜けない', () => {
  // 実測で 1.22m の壁掛けが、下端 1.40m 固定だと 2.62m に達していた
  for (const h of [1.22, 2.0, 2.39]) {
    const y = defaultY('wall', 'wall_decor', h);
    assert.ok(y + h <= ROOM_H + 1e-9, `${h}m が天井を越える`);
    assert.ok(y >= 0, `${h}m が床より下`);
  }
});

test('鏡も中心を合わせる', () => {
  near(defaultY('wall', 'mirror', 0.77) + 0.77 / 2, EYE);
});

test('ヘッドボードは床から立つ', () => {
  // ベッドに付くものなので、目線に掛けるのではない
  near(defaultY('wall', 'headboard', 1.0), 0);
});

test('知らない壁掛けでも床には落とさない', () => {
  assert.ok(defaultY('wall', 'unknown', 0.5) > 0);
});

test('天井より背の高い器具でも床より下へは行かない', () => {
  near(defaultY('ceiling', 'ceiling_light', 99), 0);
});
