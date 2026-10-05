// 取り消しの積み下ろし。**off-by-one が潜むのはここ。**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../../templatemaker/web/history.js';

// 配置の代わりに素の配列を動かす差し替え
function rig(limit) {
  let state = [];
  const h = createHistory({
    snapshot: () => state.map((r) => ({ ...r })),
    restore: (s) => { state = s.map((r) => ({ ...r })); },
    limit,
  });
  return {
    h,
    get state() { return state; },
    put(uid, x = 0) { state.push({ uid, x }); },
    move(uid, x) { state.find((r) => r.uid === uid).x = x; },
    drop(uid) { state = state.filter((r) => r.uid !== uid); },
    xs: () => state.map((r) => r.x),
    uids: () => state.map((r) => r.uid),
  };
}

test('動かしていなければ段を作らない', () => {
  // ただのクリックが履歴に残ると、取り消しが空振りする
  const r = rig();
  const b = r.h.begin();
  assert.equal(r.h.commit(b), false);
  assert.equal(r.h.depth, 0);
  assert.equal(r.h.canUndo, false);
});

test('一度の操作が一段になる', () => {
  const r = rig();
  r.put(1, 0);
  const b = r.h.begin();
  // ドラッグの途中経過。間に何度値が変わっても段は 1 つ
  r.move(1, 0.1); r.move(1, 0.2); r.move(1, 0.5);
  r.h.commit(b, '移動');
  assert.equal(r.h.depth, 1);
  assert.deepEqual(r.xs(), [0.5]);
  r.h.undo();
  assert.deepEqual(r.xs(), [0]);
});

test('やり直しで戻る', () => {
  const r = rig();
  r.put(1, 0);
  const b = r.h.begin(); r.move(1, 2); r.h.commit(b);
  r.h.undo(); assert.deepEqual(r.xs(), [0]);
  r.h.redo(); assert.deepEqual(r.xs(), [2]);
  assert.equal(r.h.canRedo, false);
});

test('新しい操作でやり直しは消える', () => {
  const r = rig();
  r.put(1, 0);
  let b = r.h.begin(); r.move(1, 2); r.h.commit(b);
  r.h.undo();
  assert.equal(r.h.canRedo, true);
  b = r.h.begin(); r.move(1, 9); r.h.commit(b);
  assert.equal(r.h.canRedo, false);
});

test('削除を戻すと順番どおりに返る', () => {
  const r = rig();
  r.put(1); r.put(2); r.put(3);
  const b = r.h.begin(); r.drop(2); r.h.commit(b, '削除');
  assert.deepEqual(r.uids(), [1, 3]);
  r.h.undo();
  assert.deepEqual(r.uids(), [1, 2, 3], '元の位置へ戻る');
});

test('深さの上限で古いものから落ちる', () => {
  const r = rig(3);
  r.put(1, 0);
  for (let i = 1; i <= 5; i++) {
    const b = r.h.begin(); r.move(1, i); r.h.commit(b);
  }
  assert.equal(r.h.depth, 3);
  for (let i = 0; i < 3; i++) r.h.undo();
  assert.deepEqual(r.xs(), [2], '3 段ぶんしか戻れない');
  assert.equal(r.h.canUndo, false);
});

test('凍結中は積まない', () => {
  const r = rig();
  return r.h.freeze(async () => {
    const b = r.h.begin();
    assert.equal(b, null);
    r.put(1); r.put(2);
    assert.equal(r.h.commit(b), false);
    assert.equal(r.h.depth, 0);
  });
});

test('読み込み中に取り消されたら、その commit は捨てる', async () => {
  // GLB を待っている間に Cmd+Z が来た場面。古い写しを積むと
  // 消したはずの状態が蘇る
  const r = rig();
  r.put(1, 0);
  let b0 = r.h.begin(); r.move(1, 5); r.h.commit(b0);

  const late = r.h.begin();       // 遅れている操作が写しを取った
  r.h.undo();                     // その隙に取り消し
  r.put(9, 9);
  assert.equal(r.h.commit(late), false, '世が変わっているので捨てる');
  assert.equal(r.h.depth, 0);
});

test('保存した所まで戻れば未保存が消える', () => {
  const r = rig();
  r.put(1, 0);
  let b = r.h.begin(); r.move(1, 1); r.h.commit(b);
  assert.equal(r.h.dirty, true);
  r.h.savePoint();
  assert.equal(r.h.dirty, false);

  b = r.h.begin(); r.move(1, 2); r.h.commit(b);
  assert.equal(r.h.dirty, true, '保存後に動かせば未保存');
  r.h.undo();
  assert.equal(r.h.dirty, false, '保存した所まで戻れば消える');
  r.h.redo();
  assert.equal(r.h.dirty, true);
});

test('保存点が上限で押し出されたら、もう戻れない', () => {
  const r = rig(2);
  r.put(1, 0);
  let b = r.h.begin(); r.move(1, 1); r.h.commit(b);
  r.h.savePoint();                       // 深さ 1 の所
  for (const x of [2, 3, 4]) { b = r.h.begin(); r.move(1, x); r.h.commit(b); }
  // 保存点は押し出されている。戻れないなら、ずっと未保存のまま
  assert.equal(r.h.dirty, true);
  r.h.undo(); r.h.undo();
  assert.equal(r.h.dirty, true, '別の状態を保存済みと誤認しない');
});

test('作り直すと履歴を捨てる', () => {
  const r = rig();
  r.put(1, 0);
  const b = r.h.begin(); r.move(1, 1); r.h.commit(b);
  r.h.reset();
  assert.equal(r.h.depth, 0);
  assert.equal(r.h.canUndo, false);
  assert.equal(r.h.dirty, false);
});

test('生きている背番号を集められる', () => {
  const r = rig();
  r.put(1); r.put(2);
  const b = r.h.begin(); r.drop(2); r.h.commit(b);
  const live = r.h.liveUids(r.uids());
  assert.ok(live.has(2), '消した体も履歴の中では生きている');
  assert.ok(live.has(1));
});

test('何も無い所で取り消しても落ちない', () => {
  const r = rig();
  assert.equal(r.h.undo(), false);
  assert.equal(r.h.redo(), false);
});

test('変化のたびに知らせる', () => {
  let n = 0;
  let state = [];
  const h = createHistory({
    snapshot: () => [...state], restore: (s) => { state = [...s]; },
    onChange: () => { n++; },
  });
  const b = h.begin(); state = [{ uid: 1 }]; h.commit(b);
  h.undo(); h.redo(); h.savePoint();
  assert.equal(n, 4);
});
