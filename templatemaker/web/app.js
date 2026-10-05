// 家具テンプレートを組む。素材は GLB のまま受け取り、ここで解く。
//
// 素材の原点は素性がばらばらなので、サーバが外形から出した `offset` を
// 内側のノードへ入れて **bottom-center を自分の原点に揃える**。外側の
// Group が「どこに置いたか」だけを持つので、動かす・回すが素直になる。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as G from './geom.js';
import { createHistory } from './history.js';

const $ = (s) => document.querySelector(s);
const fmt = (v) => v.toFixed(2);
let lib = null, sizes = {}, items = [], dirty = false;
let uidSeq = 0;

// --- 場面 ---------------------------------------------------------------
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15161a);
const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
cam.position.set(4, 3.4, 4.6);
const controls = new OrbitControls(cam, renderer.domElement);
controls.target.set(0, 0.45, 0);
controls.maxPolarAngle = Math.PI / 2 - 0.02;

scene.add(new THREE.HemisphereLight(0xdfe6f2, 0x30343c, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, 7, 3);
scene.add(sun);
const grid = new THREE.GridHelper(16, 32, 0x3a3f4b, 0x24272e);
scene.add(grid);

// まとまりの外形を見せる枠。Sweet Home 3D の group がそれ自体 1 つの家具で
// あるのと同じで、**セットにも寸法がある**ことを目で見えるようにする
const groupBox = new THREE.Box3Helper(new THREE.Box3(), 0x7fb8ff);
groupBox.visible = false;
scene.add(groupBox);
// 選択の枠。**使い回す。** 選び直すたびに作ると GPU の物が積もる
const boxes = [];
function paintSelection() {
  boxes.forEach((b) => { b.visible = false; });
  selection.forEach((rec, i) => {
    // **モデル未到着の holder に当てると NaN の箱になる。**
    // 読み込み中のものを一覧からクリックすると起きる
    if (!rec.holder.children.length) return;
    if (!boxes[i]) {
      boxes[i] = new THREE.BoxHelper(undefined, 0xffb86b);
      scene.add(boxes[i]);
    }
    boxes[i].setFromObject(rec.holder);
    boxes[i].visible = true;
  });
}

// 選んだ順の配列。**主は最後に触れたもの**——いま触ったものが調整の対象
let selection = [];
const primary = () => selection.at(-1) ?? null;
const isSel = (rec) => selection.includes(rec);

// 唯一の入口。重複と、もう無い記録をここで落とす
function setSelection(list) {
  selection = [...new Set(list)].filter((r) => items.includes(r));
  want({ panel: true, scene: true });
}
const select = (rec) => setSelection(rec ? [rec] : []);
const selectAdd = (rec) => setSelection(
  isSel(rec) ? selection.filter((r) => r !== rec) : [...selection, rec]);

// 回転のつまみ。**掴む場所を 1 点に絞る。**
// 輪のどこでも掴めると、家具を選び直すつもりの操作で向きが変わる。
// つまみは素材の +Z に置く——ABO には正面の情報が無いので、どちらを向いて
// いるかはこれが唯一の手掛かりになる
const DIAL = 0xffb86b;
const dial = new THREE.Group();
dial.visible = false;
scene.add(dial);
let dialRadius = 0, dialHot = false, handle = null, guide = null;

// **回転つまみ専用。** つまみは自分で geometry を作り直すので解放してよい。
// 家具の holder に使ってはいけない——中身は原本からの借り物
function freeTree(o) {
  o.traverse((c) => {
    c.geometry?.dispose?.();
    for (const m of [c.material].flat()) m?.dispose?.();
  });
  o.clear();
}

function buildDial(r) {
  freeTree(dial);
  dialRadius = r;
  const flat = (g) => g.rotateX(-Math.PI / 2);
  const mat = (o) => new THREE.MeshBasicMaterial({ color: DIAL,
    transparent: true, opacity: o, side: THREE.DoubleSide, depthTest: false });

  dial.add(new THREE.Mesh(flat(new THREE.RingGeometry(r - 0.006, r + 0.006, 128)),
                          mat(0.3)));

  // 15 度ごとの目盛り。90 度だけ長くする——家具は壁に沿うので直角が目印になる
  const pts = [];
  for (let d = 0; d < 360; d += 15) {
    const a = THREE.MathUtils.degToRad(d);
    const inner = r - (d % 90 === 0 ? 0.055 : 0.026);
    pts.push(Math.cos(a) * inner, 0, Math.sin(a) * inner,
             Math.cos(a) * (r - 0.009), 0, Math.sin(a) * (r - 0.009));
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  dial.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
    color: DIAL, transparent: true, opacity: 0.45, depthTest: false })));

  guide = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, r)]),
    new THREE.LineBasicMaterial({ color: DIAL, transparent: true,
                                  opacity: 0.5, depthTest: false }));
  guide.visible = false;
  dial.add(guide);

  handle = new THREE.Group();
  handle.position.set(0, 0, r);
  handle.add(new THREE.Mesh(flat(new THREE.CircleGeometry(0.055, 28)), mat(0.95)));
  handle.add(new THREE.Mesh(
    new THREE.ConeGeometry(0.048, 0.1, 3).rotateX(Math.PI / 2)
      .translate(0, 0, 0.11), mat(0.95)));
  dial.add(handle);

  dial.traverse((o) => { o.renderOrder = 4; });
}

function placeDial() {
  if (selection.length !== 1) { dial.visible = false; return; }
  const sel = primary();
  const a = sizes[sel.asset_id];
  const r = Math.max(0.45, Math.hypot(a.size[0], a.size[2]) / 2 + 0.2);
  if (Math.abs(r - dialRadius) > 1e-6) buildDial(r);
  dial.position.set(sel.holder.position.x, 0.006, sel.holder.position.z);
  dial.rotation.y = sel.holder.rotation.y;
  dial.visible = true;
  const s = dialHot ? 1.25 : 1;
  handle.scale.setScalar(s);
}

// --- 描き直し ----------------------------------------------------------
// **要求を溜めて、次の 1 フレームでまとめて払う。**
// pointermove は 1 フレームに何度も来る。来るたびに組み直すと、指の速さ
// だけ無駄が積もる——いまは移動のたびに一覧の innerHTML を全部作っていた
const need = { scene: false, panel: false, list: false };
const want = (w) => Object.assign(need, w);
const touch = () => want({ scene: true, panel: true });
const redrawAll = () => want({ scene: true, panel: true, list: true });

function flush() {
  if (need.list) { need.list = false; syncList(); }
  if (need.scene) { need.scene = false; syncScene(); }
  if (need.panel) { need.panel = false; syncPanel(); }
}

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / h; cam.updateProjectionMatrix();
}
addEventListener('resize', resize);

(function loop() {
  requestAnimationFrame(loop);        // 先に次を予約する。flush が投げても止まらない
  flush();
  controls.update();
  renderer.render(scene, cam);
})();

// --- 素材の読み込み -----------------------------------------------------
const loader = new GLTFLoader();
const cache = new Map();

// **複製は借りるだけ。原本（キャッシュ）が持ち主。**
// three.js の clone は geometry と material を**参照で共有する**。借りた側で
// dispose すると、同じ素材の他の家具も、以後の追加も全部死ぬ。
// 原本は解放しない——1 セッションで触る素材は数十体で、一覧の 376 体ではない。
async function model(id) {
  if (!cache.has(id)) {
    const a = sizes[id];
    cache.set(id, loader.loadAsync(`/asset/${a.category}/${id}.glb`)
      .then((g) => g.scene));
  }
  return (await cache.get(id)).clone(true);
}

// --- 置く ---------------------------------------------------------------
// **配置の正は記録側。`holder` は見せるための写し。**
// 保存も寸法も履歴も記録を読む。数の持ち主を 1 つに決めておかないと、
// 取り消しのたびに単位と正規化の処理をもう一度書くことになる
function apply(rec) {
  rec.holder.position.set(...rec.translation);
  rec.holder.rotation.y = THREE.MathUtils.degToRad(rec.rotation);
}

function place(rec, x, z, y = rec.translation[1]) {
  rec.translation = [x, y, z];
  apply(rec); touch();
}

// 回転は鉛直軸まわりだけ。家具は倒れない
function setAngle(rec, deg) {
  rec.rotation = ((deg % 360) + 360) % 360;
  apply(rec); touch();
}

async function add(id, at = { x: 0, z: 0 }, rot = 0, y = 0) {
  const a = sizes[id];
  if (!a) return null;
  // **足す前に写しを取る。** 後だと新しい体が写しに入ってしまい、
  // 取り消しても消えない
  const before = history.begin();
  const holder = new THREE.Group();
  scene.add(holder);
  const rec = { uid: ++uidSeq, asset_id: id, category: a.category, holder,
                translation: [at.x, y, at.z], rotation: ((rot % 360) + 360) % 360 };
  holder.userData.rec = rec;        // 当たった mesh から持ち主へ遡るため
  apply(rec);
  items.push(rec);
  want({ list: true, panel: true });
  try {
    const obj = await model(id);
    obj.position.set(...a.offset);          // bottom-center を原点へ
    holder.add(obj);
  } catch (e) {
    note(`読めない: ${a.name}`, true);
    remove(rec);
    return null;
  }
  // **モデルが届いてから積む。** 読み込みに失敗したら履歴を残さない
  history.commit(before, '追加');
  select(rec); redrawAll();
  return rec;
}

function remove(rec) {
  scene.remove(rec.holder);
  // dispose せず預ける。取り消しで scene.add するだけで戻せる
  grave.set(rec.uid, rec);
  items = items.filter((x) => x !== rec);
  setSelection(selection.filter((r) => r !== rec));
  redrawAll();
}

function handleWorld() {
  return handle.getWorldPosition(new THREE.Vector3());
}

// --- 履歴 ---------------------------------------------------------------
// 消した記録は捨てずに預ける。holder ごと取っておけば、取り消しは scene.add
// だけで**同期的に**戻る——GLB を読み直さないので瞬きもしない。
// 借り物を dispose しないようにしてあるから成立する（`model` を見よ）
const grave = new Map();

function snapshot() {
  return items.map((r) => ({ uid: r.uid, asset_id: r.asset_id,
    category: r.category, translation: [...r.translation], rotation: r.rotation }));
}

function restore(snap) {
  const live = new Map(items.map((r) => [r.uid, r]));
  const keep = new Set(snap.map((x) => x.uid));
  for (const r of items)
    if (!keep.has(r.uid)) { scene.remove(r.holder); grave.set(r.uid, r); }
  items = snap.map((x) => {
    let r = live.get(x.uid);
    if (!r) { r = grave.get(x.uid); grave.delete(x.uid); scene.add(r.holder); }
    r.translation = [...x.translation]; r.rotation = x.rotation;
    apply(r);
    return r;
  });
  setSelection(selection);        // もう無い記録はここで落ちる
  redrawAll();
}

const history = createHistory({
  snapshot, restore,
  onChange: () => {
    mark(history.dirty);
    // 履歴から消えた体は墓場からも落とす。dispose はしない（借り物）
    const alive = history.liveUids(items.map((r) => r.uid));
    for (const uid of [...grave.keys()]) if (!alive.has(uid)) grave.delete(uid);
  },
});

/** 1 つの操作として積む。中で何度動かしても 1 段。 */
function step(label, fn) {
  const b = history.begin();
  fn();
  history.commit(b, label);
}

// --- まとまりの外形 -----------------------------------------------------
// 回した後の水平の占有から出す。回転は鉛直軸まわりだけなので 2 次元で足りる
function groupBounds(list = items) {
  if (!list.length) return null;
  const b = new THREE.Box3();
  for (const it of list) {
    const a = sizes[it.asset_id];
    const t = THREE.MathUtils.degToRad(it.rotation);
    const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
    const w = a.size[0] * c + a.size[2] * s;
    const d = a.size[0] * s + a.size[2] * c;
    const [x, y, z] = it.translation;
    b.union(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y, z - d / 2),
      new THREE.Vector3(x + w / 2, y + a.size[1], z + d / 2)));
  }
  return b;
}

// --- 一覧から落として置く -----------------------------------------------
// **落とした場所がそのまま置き場所。** どこへ出るかをアプリが決めずに済む。
// 落ちる前に床の枠を出すのは、奥行のある場面で「どこに着くか」が
// 画面の高さだけでは読めないため
const ghost = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x7fb8ff, transparent: true,
                                opacity: 0.25, depthWrite: false }));
const ghostEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
  new THREE.LineBasicMaterial({ color: 0x7fb8ff }));
ghost.add(ghostEdge);
ghost.visible = false;
ghost.renderOrder = 2;
scene.add(ghost);
let dropping = null;

function floorPoint(ev) {
  pointerRay(ev);
  plane.constant = 0;
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(plane, p) ? p : null;
}

const snap = (v) => Math.round(v * 200) / 200;

view.addEventListener('dragover', (ev) => {
  if (!dropping) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
  const p = floorPoint(ev);
  if (!p) return;
  const a = sizes[dropping];
  ghost.scale.set(a.size[0], 1, a.size[2]);
  ghost.position.set(snap(p.x), 0.004, snap(p.z));
  ghost.visible = true;
});

const hideGhost = () => { ghost.visible = false; };
view.addEventListener('dragleave', hideGhost);
addEventListener('dragend', () => { hideGhost(); dropping = null; });

view.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  const id = ev.dataTransfer.getData('text/plain') || dropping;
  hideGhost(); dropping = null;
  if (!id || !sizes[id]) return;
  const p = floorPoint(ev);
  if (p) await add(id, { x: snap(p.x), z: snap(p.z) });
});

// --- 操作 ---------------------------------------------------------------
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
let drag = null;

// 画面の点から光線を作る。**`ray` を残す副作用に後段が依存している**
function pointerRay(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(
    ((ev.clientX - r.left) / r.width) * 2 - 1,
    -((ev.clientY - r.top) / r.height) * 2 + 1), cam);
  return ray;
}

// 当たった mesh から持ち主の記録へ遡る
function recOf(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData.rec) return o.userData.rec;
  return null;
}

// **一番手前を選ぶ。** 配列順で返すと、先に置いたものが手前のものより
// 優先される（ラグの上のソファを掴めない）。intersectObjects は距離順
function pick(ev) {
  pointerRay(ev);
  const hits = ray.intersectObjects(items.map((it) => it.holder), true);
  return hits.length ? recOf(hits[0].object) : null;
}

function angleAt(ev, cx, cz) {
  const p = floorPoint(ev);
  return p ? Math.atan2(p.z - cz, p.x - cx) : null;
}

// つまみの上か。画面上の距離で見る——寝かせた視点だと床の距離では掴めない
function onHandle(ev) {
  if (!dial.visible) return false;
  const r = renderer.domElement.getBoundingClientRect();
  const h = handleWorld().project(cam);
  const hx = r.left + (h.x + 1) / 2 * r.width;
  const hy = r.top + (-h.y + 1) / 2 * r.height;
  return Math.hypot(ev.clientX - hx, ev.clientY - hy) < 22;
}

let spin = null;

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;

  // つまみを先に見る。家具の真上に重なっていても回転が取れるように
  if (selection.length === 1 && onHandle(ev)) {
    const sel = primary();
    const a = angleAt(ev, sel.holder.position.x, sel.holder.position.z);
    if (a !== null) {
      spin = { rec: sel, from: a, start: sel.holder.rotation.y,
               before: history.begin() };
      guide.visible = true;
      controls.enabled = false;
      renderer.domElement.setPointerCapture(ev.pointerId);
      return;
    }
  }

  const rec = pick(ev);
  select(rec);
  if (!rec) return;
  plane.constant = -rec.holder.position.y;
  if (ray.ray.intersectPlane(plane, hit)) {
    drag = { rec, dx: rec.holder.position.x - hit.x,
             dz: rec.holder.position.z - hit.z, before: history.begin() };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(ev.pointerId);
  }
});

// 既定は 15 度刻み。Shift で 1 度——**既定を細かくしない。**
// 家具は壁に沿うのが普通で、端数の角度は直したいものであることが多い
const snapDeg = (d, fine) => {
  const step = fine ? 1 : 15;
  return Math.round(d / step) * step;
};

renderer.domElement.addEventListener('pointermove', (ev) => {
  if (spin) {
    const a = angleAt(ev, spin.rec.holder.position.x, spin.rec.holder.position.z);
    if (a === null) return;
    setAngle(spin.rec,
      snapDeg(THREE.MathUtils.radToDeg(spin.start - (a - spin.from)), ev.shiftKey));
    showAngle();
    return;
  }
  if (!drag) return;
  pointerRay(ev);
  if (!ray.ray.intersectPlane(plane, hit)) return;
  // 5mm 刻み。目分量で置いたものが端数だらけにならないように
  place(drag.rec, snap(hit.x + drag.dx), snap(hit.z + drag.dz));
});

const endDrag = () => {
  // **区切りは指を離したとき。** 途中経過を積むと、1 回動かすのに
  // 何十回も取り消すことになる
  if (drag) { history.commit(drag.before, '移動'); drag = null; }
  if (spin) {
    history.commit(spin.before, '回転');
    spin = null; guide.visible = false; hideAngle();
  }
  controls.enabled = true;
};

// 掴める所に来たら膨らませる。掴めることを触る前に見せる
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (spin || drag) return;
  const hot = onHandle(ev);
  if (hot !== dialHot) {
    dialHot = hot;
    renderer.domElement.style.cursor = hot ? 'grab' : '';
    placeDial();
  }
});

// 角度はつまみの脇に出す。右の欄まで目を動かさずに読めるように
const tag = $('#angle');
function showAngle() {
  if (!spin) return;
  const r = renderer.domElement.getBoundingClientRect();
  const h = handleWorld().project(cam);
  tag.style.left = `${(h.x + 1) / 2 * r.width}px`;
  tag.style.top = `${(-h.y + 1) / 2 * r.height}px`;
  tag.textContent = `${Math.round(spin.rec.rotation)}°`;
  tag.hidden = false;
}
const hideAngle = () => { tag.hidden = true; };
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

function focusOn(rec) {
  const t = new THREE.Vector3(rec.holder.position.x,
    rec.holder.position.y + sizes[rec.asset_id].size[1] / 2, rec.holder.position.z);
  const d = cam.position.clone().sub(controls.target);
  controls.target.copy(t);
  cam.position.copy(t).add(d);
}

addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  if (ev.key === 'Escape') return select(null);

  // **何も選んでいなくても効く必要がある**ので、選択の判定より前に置く。
  // macOS の Cmd+Shift+Z は key が 'Z' で来るため小文字に寄せる
  const meta = ev.metaKey || ev.ctrlKey;
  if (meta && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    if (drag || spin) return;     // 掴んでいる最中に足元を入れ替えない
    return void (ev.shiftKey ? history.redo() : history.undo());
  }
  if (meta && ev.key.toLowerCase() === 'y') {
    ev.preventDefault();
    if (!drag && !spin) history.redo();
    return;
  }

  if (!selection.length) return;
  if (ev.key === 'f' || ev.key === 'F') return focusOn(primary());
  const turn = ev.shiftKey ? 1 : 15;
  if (ev.key.toLowerCase() === 'q') {
    step('回転', () => selection.forEach(
      (r) => setAngle(r, snapDeg(r.rotation + turn, ev.shiftKey))));
  } else if (ev.key.toLowerCase() === 'e') {
    step('回転', () => selection.forEach(
      (r) => setAngle(r, snapDeg(r.rotation - turn, ev.shiftKey))));
  } else if (ev.key === 'Backspace' || ev.key === 'Delete') {
    ev.preventDefault();
    step('削除', () => [...selection].forEach(remove));
  }
});

// --- 描き直し -----------------------------------------------------------
// 場面だけ。**毎フレーム走りうる経路**なので DOM を触らない
function syncScene() {
  const b = groupBounds();
  groupBox.visible = !!b && items.length > 1;
  if (b) groupBox.box.copy(b);
  paintSelection();
  placeDial();
}

// 右の欄。数字は動くが、要素は作り直さない
function syncPanel() {
  const n = items.length;
  $('#count').textContent = n ? `(${n})` : '';
  $('#hint').style.display = n ? 'none' : '';

  const b = groupBounds();
  const g = $('#group');
  if (!b) {
    g.innerHTML = '<tr><td colspan="2" class="note">まだ何も置いていません</td></tr>';
  } else {
    const sz = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    g.innerHTML = `
      <tr><td>幅 W</td><td>${fmt(Math.max(sz.x, sz.z))} m</td></tr>
      <tr><td>奥行 D</td><td>${fmt(Math.min(sz.x, sz.z))} m</td></tr>
      <tr><td>高さ H</td><td>${fmt(sz.y)} m</td></tr>
      <tr><td>中心</td><td>${fmt(c.x)}, ${fmt(c.z)}</td></tr>`;
  }

  for (const it of items) {
    if (!it.li) continue;
    it.li.classList.toggle('on', isSel(it));
    it.li.lastElementChild.textContent = `${Math.round(it.rotation)}°`;
  }

  const sel = primary();
  if (!selection.length) {
    $('#sel').innerHTML = '<span class="note">なし</span>';
  } else if (selection.length === 1) {
    const a = sizes[sel.asset_id];
    $('#sel').innerHTML = `${a.name.slice(0, 70)}
      <span class="note">${a.width}×${a.depth}×${a.height} m ·
      ${fmt(sel.translation[0])}, ${fmt(sel.translation[2])}</span>`;
  } else {
    const sb = groupBounds(selection);
    const sz = sb.getSize(new THREE.Vector3());
    $('#sel').innerHTML = `${selection.length} 体を選択
      <span class="note">${fmt(Math.max(sz.x, sz.z))}×${fmt(Math.min(sz.x, sz.z))} m</span>`;
  }
  $('#rot').hidden = !selection.length;
  if (sel) $('#deg').value = Math.round(sel.rotation * 10) / 10;
}

// 一覧の行。**体が増減したときだけ。**
// 行は記録に持たせて使い回す——並べ直しは同じ節点を append すれば動く
function syncList() {
  const ul = $('#placed');
  for (const it of items) {
    if (!it.li) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${it.category}</b><span></span>`;
      li.onclick = (ev) => {
        if (ev.shiftKey) selectAdd(it);
        else { select(it); focusOn(it); }
      };
      it.li = li;
    }
    ul.append(it.li);
  }
  for (const li of [...ul.children]) if (!items.some((it) => it.li === li)) li.remove();
  want({ panel: true });
}

// --- 回転の口 -----------------------------------------------------------
$('#deg').addEventListener('change', () => {
  const sel = primary();
  if (!sel) return;
  const v = parseFloat($('#deg').value);
  if (Number.isFinite(v)) step('向き', () => selection.forEach((r) => setAngle(r, v)));
  else $('#deg').value = Math.round(sel.rotation);
});
for (const b of document.querySelectorAll('#rot [data-turn]')) {
  b.onclick = () => step('回転',
    () => selection.forEach((r) => setAngle(r, r.rotation + (+b.dataset.turn))));
}
for (const b of document.querySelectorAll('#rot [data-face]')) {
  b.onclick = () => step('向き',
    () => selection.forEach((r) => setAngle(r, +b.dataset.face)));
}

function mark(d) { dirty = d; note(d ? '未保存' : ''); }
let noteTimer;
function note(s, warn = false) {
  const el = $('#msg');
  el.textContent = s; el.className = warn ? 'warn' : '';
  if (s && s !== '未保存') {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { if (dirty) note('未保存'); else note(''); }, 2600);
  }
}

// --- 一覧 ---------------------------------------------------------------
function paintAssets() {
  const cat = $('#cat').value, q = $('#find').value.trim().toLowerCase();
  const list = lib.items.filter((a) =>
    (!cat || a.category === cat) &&
    (!q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)));
  const ul = $('#assets');
  ul.innerHTML = '';
  for (const a of list.slice(0, 400)) {
    const li = document.createElement('li');
    li.draggable = true;
    const img = a.thumb
      ? `<img src="/thumb/${a.id}.jpg" alt="" loading="lazy" draggable="false">`
      : '<i class="noimg"></i>';
    li.innerHTML = `${img}<div><b>${a.name}</b>` +
      `<span>${a.category} · ${a.width}×${a.depth}×${a.height} m</span></div>`;
    li.addEventListener('dragstart', (ev) => {
      dropping = a.id;
      ev.dataTransfer.setData('text/plain', a.id);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    // 落とす先が分からないときのために、見ている場所へ置く道も残す
    li.ondblclick = () => add(a.id, { x: snap(controls.target.x),
                                      z: snap(controls.target.z) });
    ul.append(li);
  }
  $('#libnote').textContent =
    `${list.length} / ${lib.items.length} 体 · ${lib.license} · 原点 ${lib.origin}`;
}

// --- テンプレート -------------------------------------------------------
async function refreshList() {
  const r = await fetch('/api/templates').then((x) => x.json());
  const s = $('#open');
  s.innerHTML = '<option value="">テンプレートを開く…</option>';
  for (const t of r) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.error ? `${t.name}（壊れている）` : `${t.name}（${t.count}）`;
    s.append(o);
  }
}

function clearAll() {
  for (const it of [...items]) scene.remove(it.holder);
  items.forEach((r) => grave.set(r.uid, r));
  items = []; setSelection([]); redrawAll();
}

$('#save').onclick = async () => {
  const name = $('#name').value.trim();
  if (!name) { note('名前を入れてください', true); $('#name').focus(); return; }
  // id は決めない。日本語の名前を ASCII に落とす規則がこことサーバで
  // 二重になると、片方だけ直ったとき別のファイルに保存される
  const body = {
    schema_version: 'tm-template-1', name,
    source_manifest: lib.source,
    items: items.map((it) => ({
      asset_id: it.asset_id, category: it.category,
      translation: it.translation.map((v) => Math.round(v * 1000) / 1000),
      rotation: Math.round(it.rotation * 10) / 10,
    })),
  };
  const r = await fetch('/api/templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) return note(j.error || '保存できない', true);
  history.savePoint();          // ここまで戻れば「未保存」は消える
  note(`保存しました（${j.count} 体）`);
  await refreshList();
  $('#open').value = j.id;
};

$('#new').onclick = () => {
  if (dirty && !confirm('保存していない変更があります。新規にしますか。')) return;
  clearAll(); $('#name').value = ''; $('#open').value = '';
  // **跨いで戻れないようにする。** 別の書類の記録が蘇ると辻褄が合わない
  grave.clear(); history.reset();
};

$('#open').onchange = async (ev) => {
  const id = ev.target.value;
  if (!id) return;
  if (dirty && !confirm('保存していない変更があります。開きますか。')) {
    ev.target.value = ''; return;
  }
  const t = await fetch(`/api/templates/${id}`).then((x) => x.json());
  if (t.error) return note(t.error, true);
  // 読み込みは履歴に残さない。30 体が 30 段になっても誰も得をしない
  await history.freeze(async () => {
    clearAll();
    $('#name').value = t.name;
    for (const it of t.items) {
      await add(it.asset_id, { x: it.translation[0], z: it.translation[2] },
                it.rotation, it.translation[1]);
    }
  });
  grave.clear(); history.reset();
  select(null); note(`${t.items.length} 体を読み込みました`);
};

addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// --- 起動 ---------------------------------------------------------------
(async function start() {
  lib = await fetch('/api/library').then((r) => r.json());
  for (const a of lib.items) sizes[a.id] = a;
  const c = $('#cat');
  c.innerHTML = '<option value="">すべて</option>';
  for (const [k, n] of Object.entries(lib.categories)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = `${k} (${n})`;
    c.append(o);
  }
  c.onchange = paintAssets;
  $('#find').oninput = paintAssets;
  paintAssets();
  await refreshList();
  resize(); redrawAll();
})();
