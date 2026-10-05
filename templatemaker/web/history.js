// 取り消しと やり直し。**three.js にも DOM にも依存しない。**
//
// 逆操作ではなく**丸ごとの写し**を積む。配置は 30 体 × 数スカラで 3KB ほどしか
// なく、操作は今後も増え続ける（整列・等間隔・まとめて移動…）。逆操作方式だと
// 操作の種類だけ対になる処理が要るが、写しなら `begin`/`commit` で挟むだけで
// どんな操作にも取り消しが付く。
//
// 難しいのは同一性だけ。記録は three の物を抱えていて写せないので、**背番号で
// 指す**。復元は差分で当てるので同期的に終わり、GLB を読み直さない。

/** 履歴を作る。外とのやりとりは渡された口だけで行う。 */
export function createHistory({ snapshot, restore, onChange = () => {},
                                limit = 50 } = {}) {
  let undoStack = [], redoStack = [];
  let frozen = 0, epoch = 0, savedAt = 0;

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** 操作の前に呼ぶ。凍結中は null を返す。 */
  const begin = () => (frozen ? null : { snap: snapshot(), epoch });

  /** 操作の後に呼ぶ。動いていなければ段を作らない。 */
  function commit(b, label = '') {
    // **取ってから世が変わっていたら捨てる。** 読み込み中に取り消されたとき、
    // 古い写しを積むと消したはずの状態が蘇る
    if (!b || frozen || b.epoch !== epoch) return false;
    const after = snapshot();
    if (same(b.snap, after)) return false;        // ただのクリックは段を作らない
    undoStack.push({ label, before: b.snap, after });
    if (undoStack.length > limit) {
      undoStack.shift();
      if (savedAt >= 0) savedAt -= 1;
    }
    redoStack.length = 0;
    // 捨てた先に保存点があったなら、もう戻れない
    if (savedAt > undoStack.length) savedAt = -1;
    onChange();
    return true;
  }

  function undo() {
    const e = undoStack.pop();
    if (!e) return false;
    epoch++;
    redoStack.push(e);
    restore(e.before);
    onChange();
    return true;
  }

  function redo() {
    const e = redoStack.pop();
    if (!e) return false;
    epoch++;
    undoStack.push(e);
    restore(e.after);
    onChange();
    return true;
  }

  /** 中を履歴に残さずに実行する。テンプレートの読み込みなど。 */
  async function freeze(fn) {
    frozen++; epoch++;
    try { return await fn(); } finally { frozen--; }
  }

  /** 別のテンプレートを開いたら捨てる。跨いで戻れると記録が混ざる。 */
  function reset() {
    undoStack = []; redoStack = []; epoch++; savedAt = 0;
    onChange();
  }

  /** 保存した時点を覚える。ここまで戻れば「未保存」は消える。 */
  function savePoint() { savedAt = undoStack.length; onChange(); }

  return {
    begin, commit, undo, redo, freeze, reset, savePoint,
    get dirty() { return undoStack.length !== savedAt; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get depth() { return undoStack.length; },
    get label() { return undoStack.at(-1)?.label ?? ''; },
    /** 生きている背番号。墓場の掃除に使う。 */
    liveUids(extra = []) {
      const s = new Set(extra);
      for (const e of [...undoStack, ...redoStack])
        for (const snap of [e.before, e.after])
          for (const r of snap) s.add(r.uid);
      return s;
    },
  };
}
