// 家具テンプレートを組む。素材は GLB のまま受け取り、ここで解く。
//
// 素材の原点は素性がばらばらなので、サーバが外形から出した `offset` を
// 内側のノードへ入れて **bottom-center を自分の原点に揃える**。外側の
// Group が「どこに置いたか」だけを持つので、動かす・回すが素直になる。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as G from './geom.js';
import { createHistory } from './history.js';
import { createView } from './view.js';
import { createRoom } from './room.js';
import { PRESETS, defaultY } from './spec.js';
import { snapMove } from './snap.js';
import { alignDelta, spreadDelta, rotateAround } from './arrange.js';
import { overlapping, gaps } from './clearance.js';
import { TUCK, pairKey } from './spec.js';

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
const V = createView(renderer, scene, view);

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
//: まとめて回した量（ラジアン）。**選び直すとゼロに戻る**——つまみが飛ばない
let groupAngle = 0;
const primary = () => selection.at(-1) ?? null;
const isSel = (rec) => selection.includes(rec);

// 唯一の入口。重複と、もう無い記録をここで落とす
function setSelection(list) {
  selection = [...new Set(list)].filter((r) => items.includes(r));
  groupAngle = 0;
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
  if (!selection.length) { dial.visible = false; return; }
  const single = selection.length === 1 ? primary() : null;
  const b = single ? null : unionBox(selection, 0, 0);
  if (!single && !b) { dial.visible = false; return; }
  const a = single && sizes[single.asset_id];
  const r = single
    ? Math.max(0.45, Math.hypot(a.size[0], a.size[2]) / 2 + 0.2)
    : Math.max(0.45, Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2 + 0.2);
  if (Math.abs(r - dialRadius) > 1e-6) buildDial(r);
  dial.position.set(single ? single.holder.position.x : b.cx, 0.006,
                    single ? single.holder.position.z : b.cz);
  dial.rotation.y = single ? single.holder.rotation.y : groupAngle;
  dial.visible = true;
  // 2D は引くと輪が点になる。掴める大きさを画面側で保つ
  dial.scale.setScalar(V.is2D ? Math.max(1, 40 * V.mpp() / dialRadius) : 1);
  handle.scale.setScalar(dialHot ? 1.25 : 1);
}

// --- 参照用の部屋 --------------------------------------------------------
// `items` に混ぜない。これだけで clearAll も外形も保存経路も無変更で正しく
// なる——「テンプレートに保存しない」が構造で保証される
const room = createRoom(scene);

function applyRoom(preset, w, d) {
  const custom = preset === 'カスタム';
  $('#roomsize').hidden = !custom;
  const wd = custom ? [w, d] : PRESETS[preset];
  const got = room.set(wd);
  if (got) { $('#roomw').value = got.w; $('#roomd').value = got.d; }
  // 作業環境の設定なので localStorage に残す。履歴の対象外
  try {
    localStorage.setItem('tm.room', JSON.stringify({ preset, w: got?.w, d: got?.d }));
  } catch { /* 私用窓では黙って諦める */ }
  want({ scene: true });
}

function setupRoom() {
  const sel = $('#room');
  for (const k of [...Object.keys(PRESETS), 'カスタム']) {
    const o = document.createElement('option');
    o.value = k; o.textContent = k || 'なし';
    sel.append(o);
  }
  const read = () => applyRoom(sel.value, +$('#roomw').value, +$('#roomd').value);
  sel.onchange = read;
  $('#roomw').onchange = read;
  $('#roomd').onchange = read;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('tm.room') || 'null'); } catch { /* */ }
  sel.value = saved?.preset ?? '6畳';
  if (saved?.w) { $('#roomw').value = saved.w; $('#roomd').value = saved.d; }
  read();
}

// --- 2D の重ね描き -------------------------------------------------------
// **メッシュは消さない。** 外形は外接しか無いので平面図形へ置き換えると
// ソファと本棚が同じ長方形になる。真上から見た実物は十分に見分けがつく。
// 足りないのは正確な外形と向きなので、そこだけ線で重ねる
const PLAN_CAP = 256;
const planGeo = new THREE.BufferGeometry();
planGeo.setAttribute('position', new THREE.BufferAttribute(
  new Float32Array(PLAN_CAP * 10 * 3), 3).setUsage(THREE.DynamicDrawUsage));
const plan = new THREE.LineSegments(planGeo, new THREE.LineBasicMaterial({
  color: 0x8d94a3, transparent: true, opacity: 0.85, depthTest: false }));
plan.renderOrder = 3;
plan.visible = false;
scene.add(plan);

/** 記録を長方形に直す。寸法と角度だけで決まる */
function footRect(it) {
  const a = sizes[it.asset_id];
  if (!a?.size) return null;
  return G.rect(it.translation[0], it.translation[2], a.size[0], a.size[2],
                THREE.MathUtils.degToRad(it.rotation));
}

function syncPlan() {
  plan.visible = V.is2D;
  if (!V.is2D) return;
  const arr = planGeo.attributes.position.array;
  let n = 0;
  const seg = (x1, z1, x2, z2) => {
    arr[n++] = x1; arr[n++] = 0.02; arr[n++] = z1;
    arr[n++] = x2; arr[n++] = 0.02; arr[n++] = z2;
  };
  for (const it of items.slice(0, PLAN_CAP)) {
    const r = footRect(it);
    if (!r) continue;
    const c = G.corners(r);
    for (let i = 0; i < 4; i++) seg(c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1]);
    const [vx, vz] = G.axisZ(r.t);          // 正面の印。つまみと同じ約束
    seg(r.cx, r.cz, r.cx + vx * (r.hd + 0.12), r.cz + vz * (r.hd + 0.12));

    // **札は footprint が 44px より広いときだけ。**
    // 全部に出すと 30 体で文字の壁になる
    const a = sizes[it.asset_id];
    const px = Math.min(a.size[0], a.size[2]) / V.mpp();
    if (px > 44) {
      const txt = isSel(it) ? `${a.category} ${a.width}×${a.depth}` : a.category;
      badge(txt, new THREE.Vector3(r.cx, 0.03, r.cz));
    }
  }
  planGeo.setDrawRange(0, n / 3);
  planGeo.attributes.position.needsUpdate = true;
  planGeo.computeBoundingSphere();
}

// --- 画面に重ねる札 ------------------------------------------------------
// 角度・品目名・間隔の寸法が共用する。作り直さず使い回す
const labelBox = $('#labels');
const labelPool = [];
let labelUsed = 0;
const labelsBegin = () => { labelUsed = 0; };
function badge(text, world, cls = '') {
  let el = labelPool[labelUsed];
  if (!el) {
    el = document.createElement('div');
    labelBox.append(el); labelPool.push(el);
  }
  labelUsed++;
  const r = renderer.domElement.getBoundingClientRect();
  const p = world.clone().project(V.cam);
  el.textContent = text;
  el.className = `badge ${cls}`;
  el.style.left = `${(p.x + 1) / 2 * r.width}px`;
  el.style.top = `${(-p.y + 1) / 2 * r.height}px`;
  el.hidden = false;
  return el;
}
const labelsEnd = () => {
  for (let i = labelUsed; i < labelPool.length; i++) labelPool[i].hidden = true;
};

// --- 重なり --------------------------------------------------------------
// **許して警告する。** 構成中の一時的な重なりは正常で、吸着が大半を未然に
// 防ぐ。置けなくすると、意図的に重ねたい配置まで止めることになる。
//
// 色は変えない。`model` が material を共有しているので、1 体を染めると同じ
// 素材の家具が全部染まる。輪郭だけを足す
const clashGeo = new THREE.BufferGeometry();
clashGeo.setAttribute('position', new THREE.BufferAttribute(
  new Float32Array(PLAN_CAP * 8 * 3), 3).setUsage(THREE.DynamicDrawUsage));
const clash = new THREE.LineSegments(clashGeo, new THREE.LineBasicMaterial({
  color: 0xffb86b, transparent: true, opacity: 0.95, depthTest: false }));
clash.renderOrder = 4;
clash.visible = false;
scene.add(clash);

/** 重なりの判定に渡す形 */
function clashItem(it) {
  const r = footRect(it);
  const a = sizes[it.asset_id];
  if (!r) return null;
  return { rect: r, y0: it.translation[1], y1: it.translation[1] + a.size[1],
           place: a.placement, cat: a.category };
}

let clashCount = 0;

function syncClash() {
  const list = [], recs = [];
  for (const it of items) {
    const d = clashItem(it);
    if (d) { list.push(d); recs.push(it); }
  }
  const bad = overlapping(list);
  clashCount = bad.size;
  for (const it of items) it.bad = false;
  const arr = clashGeo.attributes.position.array;
  let n = 0;
  for (const i of bad) {
    recs[i].bad = true;
    const c = G.corners(list[i].rect);
    const y = Math.max(0.025, list[i].y0 + 0.005);
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      arr[n++] = a[0]; arr[n++] = y; arr[n++] = a[1];
      arr[n++] = b[0]; arr[n++] = y; arr[n++] = b[1];
    }
  }
  clashGeo.setDrawRange(0, n / 3);
  clashGeo.attributes.position.needsUpdate = true;
  clashGeo.computeBoundingSphere();
  clash.visible = n > 0;
}

/** その点で支えになる面の高さ。
 *
 * **床置きだけが床の事情に従う。** 壁掛けや天井吊りに `null` を返すのは、
 * 掴んで動かしただけで床へ落ちないようにするため。
 *
 * 置くものが無ければ 0 を返す——机から外へ引き出したら床へ降りてほしい。
 */
function surfaceAt(x, z, newId, except) {
  const na = sizes[newId];
  if (na.placement !== 'floor') return null;
  const dot = G.rect(x, z, 0.001, 0.001, 0);
  let top = 0;
  for (const it of items) {
    if (it === except) continue;
    const a = sizes[it.asset_id];
    if (a.placement !== 'floor') continue;
    // 下に入れて使う組み合わせは、上に載せない（椅子は机の上に出さない）
    if (TUCK.has(pairKey(a.category, na.category))) continue;
    if (Math.max(na.size[0], na.size[2]) > Math.min(a.size[0], a.size[2])) continue;
    const r = footRect(it);
    if (!r || !G.rectHit(r, dot)) continue;
    top = Math.max(top, it.translation[1] + a.size[1]);
  }
  return snap(top);
}

// --- 間隔 ----------------------------------------------------------------
// **選んだ 1 体のときだけ。** 常時出すと 30 体で線だらけになる。
// 四方に 1 本ずつ、最大 4 本——体数が増えても表示量が変わらない
const DIM_CAP = 4 * 3;                       // 本線 + 両端の爪
const dimGeo = new THREE.BufferGeometry();
dimGeo.setAttribute('position', new THREE.BufferAttribute(
  new Float32Array(DIM_CAP * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
dimGeo.setAttribute('color', new THREE.BufferAttribute(
  new Float32Array(DIM_CAP * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
const dims = new THREE.LineSegments(dimGeo, new THREE.LineBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
dims.renderOrder = 5;
dims.visible = false;
scene.add(dims);

const DIM_OK = new THREE.Color(0x8d94a3);
const DIM_TIGHT = new THREE.Color(0xffb86b);

function syncGaps() {
  dims.visible = false;
  if (!$('#showgap')?.checked || selection.length !== 1) return;
  const sel = primary();
  const me = clashItem(sel);
  if (!me) return;
  const others = [];
  for (const it of items) {
    if (it === sel) continue;
    const d = clashItem(it);
    if (d) others.push(d);
  }
  const list = gaps(me, others, room.walls());
  const pos = dimGeo.attributes.position.array;
  const col = dimGeo.attributes.color.array;
  let n = 0;
  const seg = (x1, z1, x2, z2, c) => {
    for (const [x, z] of [[x1, z1], [x2, z2]]) {
      pos[n] = x; pos[n + 1] = 0.012; pos[n + 2] = z;
      col[n] = c.r; col[n + 1] = c.g; col[n + 2] = c.b;
      n += 3;
    }
  };
  for (const g of list) {
    const ax = g.key[1], out = g.key[0] === '+' ? 1 : -1;
    const mid = (g.span[0] + g.span[1]) / 2;
    const a = g.at, b = g.at + out * g.dist;
    const c = g.tight ? DIM_TIGHT : DIM_OK;
    const T = 0.05;                                   // 端の爪
    if (ax === 'x') {
      seg(a, mid, b, mid, c);
      seg(a, mid - T, a, mid + T, c);
      seg(b, mid - T, b, mid + T, c);
      badge(`${Math.round(g.dist * 100)} cm`,
            new THREE.Vector3((a + b) / 2, 0.03, mid), g.tight ? 'tight' : 'dim');
    } else {
      seg(mid, a, mid, b, c);
      seg(mid - T, a, mid + T, a, c);
      seg(mid - T, b, mid + T, b, c);
      badge(`${Math.round(g.dist * 100)} cm`,
            new THREE.Vector3(mid, 0.03, (a + b) / 2), g.tight ? 'tight' : 'dim');
    }
  }
  dimGeo.setDrawRange(0, n / 3);
  dimGeo.attributes.position.needsUpdate = true;
  dimGeo.attributes.color.needsUpdate = true;
  dimGeo.computeBoundingSphere();
  dims.visible = n > 0;
}

// --- 吸着 ----------------------------------------------------------------
//: 許容は画面のピクセルで測る。引いて全体を見ているときに 5mm しか吸わない
//: のでは、吸う意味がない。回転つまみの判定で既に採った考え方と同じ
const SNAP_PX = 8;

const guideGeo = new THREE.BufferGeometry();
guideGeo.setAttribute('position', new THREE.BufferAttribute(
  new Float32Array(2 * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
const guides = new THREE.LineSegments(guideGeo, new THREE.LineBasicMaterial({
  color: 0x7fb8ff, transparent: true, opacity: 0.9, depthTest: false }));
guides.renderOrder = 5;
guides.visible = false;
scene.add(guides);

const hideGuides = () => { guides.visible = false; };

function drawGuides(s) {
  const arr = guideGeo.attributes.position.array;
  let n = 0;
  const seg = (x1, z1, x2, z2) => {
    arr[n++] = x1; arr[n++] = 0.015; arr[n++] = z1;
    arr[n++] = x2; arr[n++] = 0.015; arr[n++] = z2;
  };
  if (s.x) seg(s.x.at, s.x.span[0], s.x.at, s.x.span[1]);
  if (s.z) seg(s.z.span[0], s.z.at, s.z.span[1], s.z.at);
  guideGeo.setDrawRange(0, n / 3);
  guideGeo.attributes.position.needsUpdate = true;
  guideGeo.computeBoundingSphere();
  guides.visible = n > 0;
}

/** 相手の外接。選択中のものは互いの相手にしない */
function snapBoxes(except) {
  const out = [];
  for (const it of items) {
    if (except.has(it)) continue;
    const r = footRect(it);
    if (!r) continue;
    out.push({ ...G.aabb(r), cx: r.cx, cz: r.cz, aligned: G.axisAligned(r.t) });
  }
  return out;
}

/** 記録の並びから、動かした先での外接を 1 つにまとめる。
 *
 * **吸着は選択全体の外に効かせる。** 5 体のセットを壁へ寄せるとき、
 * 揃えたいのはセットの端であって、たまたま掴んだ 1 体の端ではない。
 */
function unionBox(recs, dx, dz) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  let aligned = true;
  for (const r of recs) {
    const a = sizes[r.asset_id];
    if (!a?.size) continue;
    const t = THREE.MathUtils.degToRad(r.rotation);
    const b = G.aabb(G.rect(r.translation[0] + dx, r.translation[2] + dz,
                            a.size[0], a.size[2], t));
    x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1);
    z0 = Math.min(z0, b.z0); z1 = Math.max(z1, b.z1);
    if (!G.axisAligned(t)) aligned = false;
  }
  if (x0 === Infinity) return null;
  return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, aligned };
}

/**
 * 吸着と刻みを当てて、動かす量を決める。
 *
 * **吸着はその軸のグリッドを上書きする。** 5mm 刻みは目分量の端数を消す
 * ためのもので、相手に合わせた位置はそれ自体が正しい値。丸めると 2mm の
 * 隙間が残る。
 */
function resolveDelta(m, except, ev) {
  const noSnap = ev.altKey;                       // Alt で吸着を切る
  const noGrid = ev.altKey && ev.shiftKey;        // Alt+Shift で刻みも切る
  let dx = noGrid ? 0 : snap(m.cx) - m.cx;
  let dz = noGrid ? 0 : snap(m.cz) - m.cz;
  if (noSnap) { hideGuides(); return { dx, dz }; }
  const tol = SNAP_PX * V.mpp(new THREE.Vector3(m.cx, 0, m.cz));
  const got = snapMove(m, snapBoxes(except), room.walls(), tol, !!room.size);
  if (got.x) dx = got.x.d;
  if (got.z) dz = got.z.d;
  drawGuides(got);
  return { dx, dz };
}

/** 1 体ぶんの外接を作る（ドロップの下見用） */
function oneBox(assetId, rotDeg, x, z) {
  const a = sizes[assetId];
  const t = THREE.MathUtils.degToRad(rotDeg);
  const r = G.rect(x, z, a.size[0], a.size[2], t);
  return { ...G.aabb(r), cx: x, cz: z, aligned: G.axisAligned(t) };
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

const resize = () => { V.resize(); want({ scene: true }); };
addEventListener('resize', resize);
// 視点が動くと札の画面位置がずれる。動いた時だけ組み直す
V.onChange(() => want({ scene: true }));

(function loop() {
  requestAnimationFrame(loop);        // 先に次を予約する。flush が投げても止まらない
  flush();
  V.controls.update();
  renderer.render(scene, V.cam);
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

async function add(id, at = { x: 0, z: 0 }, rot = 0, y = null) {
  const a = sizes[id];
  if (!a) return null;
  // 壁掛けや天井吊りは、床に置いても意味がない。品目から既定の高さを決める。
  // 読み込みは必ず明示して渡すので、ここは新規に置くときだけ効く
  if (y === null) y = defaultY(a.placement, a.category, a.height);
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
  // 落ちる前から吸わせる。ベッドに接した状態でナイトテーブルを置ける
  const d = resolveDelta(oneBox(dropping, 0, p.x, p.z), new Set(), ev);
  ghost.scale.set(a.size[0], 1, a.size[2]);
  ghost.position.set(p.x + d.dx, 0.004, p.z + d.dz);
  ghost.visible = true;
});

const hideGhost = () => { ghost.visible = false; hideGuides(); };
view.addEventListener('dragleave', hideGhost);
addEventListener('dragend', () => { hideGhost(); dropping = null; });

view.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  const id = ev.dataTransfer.getData('text/plain') || dropping;
  hideGhost(); dropping = null;
  if (!id || !sizes[id]) return;
  const p = floorPoint(ev);
  if (!p) return;
  const d = resolveDelta(oneBox(id, 0, p.x, p.z), new Set(), ev);
  const q = { x: p.x + d.dx, z: p.z + d.dz };
  // 指した所に床置きの家具があれば、その上に載せる。机の上のランプ
  await add(id, q, 0, surfaceAt(q.x, q.z, id, null));
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
    -((ev.clientY - r.top) / r.height) * 2 + 1), V.cam);
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
  const h = handleWorld().project(V.cam);
  const hx = r.left + (h.x + 1) / 2 * r.width;
  const hy = r.top + (-h.y + 1) / 2 * r.height;
  return Math.hypot(ev.clientX - hx, ev.clientY - hy) < 22;
}

let spin = null;

// --- 囲んで選ぶ ----------------------------------------------------------
// **2D の左ドラッグと、どの視点でも Shift+ドラッグ。**
// 透視投影で囲むと奥行きの違うものまで入って分かりにくい。真上から見た
// 固定の視点なら、囲んだ範囲と足元の形が素直に対応する
let band = null;

function startBand(ev) {
  band = { x: ev.clientX, y: ev.clientY,
           keep: ev.shiftKey ? [...selection] : [] };
  V.controls.enabled = false;
  renderer.domElement.setPointerCapture(ev.pointerId);
  $('#band').hidden = false;
  moveBand(ev);
}

function moveBand(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  const lo = { x: Math.min(band.x, ev.clientX), y: Math.min(band.y, ev.clientY) };
  const hi = { x: Math.max(band.x, ev.clientX), y: Math.max(band.y, ev.clientY) };
  Object.assign($('#band').style, {
    left: `${lo.x - r.left}px`, top: `${lo.y - r.top}px`,
    width: `${hi.x - lo.x}px`, height: `${hi.y - lo.y}px`,
  });
  // **触れていれば選ぶ**（Figma と同じ）。真上から見た図では足元の形が
  // その家具そのものなので、完全に囲ませる必要がない
  const got = [];
  const v = new THREE.Vector3();
  for (const it of items) {
    const rect = footRect(it);
    if (!rect) continue;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [cx, cz] of G.corners(rect)) {
      v.set(cx, it.translation[1], cz).project(V.cam);
      const px = r.left + (v.x + 1) / 2 * r.width;
      const py = r.top + (-v.y + 1) / 2 * r.height;
      a0 = Math.min(a0, px); a1 = Math.max(a1, px);
      b0 = Math.min(b0, py); b1 = Math.max(b1, py);
    }
    if (a1 >= lo.x && a0 <= hi.x && b1 >= lo.y && b0 <= hi.y) got.push(it);
  }
  setSelection([...band.keep, ...got]);
}

function endBand() {
  band = null;
  $('#band').hidden = true;
  V.controls.enabled = true;
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;

  // つまみを先に見る。家具の真上に重なっていても回転が取れるように
  if (selection.length && onHandle(ev)) {
    const a = angleAt(ev, dial.position.x, dial.position.z);
    if (a !== null) {
      spin = {
        recs: [...selection], from: a,
        start: selection.length === 1 ? primary().holder.rotation.y : groupAngle,
        center: { x: dial.position.x, z: dial.position.z },
        base: selection.map((r) => ({ t: [...r.translation], rot: r.rotation })),
        before: history.begin(),
      };
      guide.visible = true;
      V.controls.enabled = false;
      renderer.domElement.setPointerCapture(ev.pointerId);
      return;
    }
  }

  const rec = pick(ev);

  if (!rec) {
    // 空き地。2D の左ドラッグと、どの視点でも Shift+ドラッグは囲んで選ぶ
    if (V.is2D || ev.shiftKey) return startBand(ev);
    return select(null);
  }
  if (ev.shiftKey) return selectAdd(rec);     // 足し引き
  if (!isSel(rec)) select(rec);               // 選択外を掴んだら選び直す

  plane.constant = -rec.holder.position.y;
  if (ray.ray.intersectPlane(plane, hit)) {
    // 掴んだ時の配置を控える。移動量はここからの差で出す
    drag = {
      recs: [...selection],
      base: selection.map((r) => [...r.translation]),
      grab: { x: hit.x, z: hit.z },
      before: history.begin(),
    };
    V.controls.enabled = false;
    renderer.domElement.setPointerCapture(ev.pointerId);
  }
});

renderer.domElement.addEventListener('pointermove', (ev) => {
  if (band) return moveBand(ev);
  if (spin) {
    const a = angleAt(ev, spin.center.x, spin.center.z);
    if (a === null) return;
    const deg = snapDeg(THREE.MathUtils.radToDeg(spin.start - (a - spin.from)),
                        ev.shiftKey);
    if (spin.recs.length === 1) {
      setAngle(spin.recs[0], deg);
      showAngle(spin.recs[0].rotation);
    } else {
      // **選択の中心で回す。** 1 体ずつ回しても位置関係は付いてこない——
      // 机だけ向きを変えても椅子は向かいに残らない
      const d = THREE.MathUtils.degToRad(deg);
      spin.recs.forEach((r, i) => {
        const b = spin.base[i];
        const p = rotateAround(spin.center.x, spin.center.z, b.t[0], b.t[2], d);
        r.rotation = ((b.rot + deg) % 360 + 360) % 360;
        r.translation = [p.x, b.t[1], p.z];
        apply(r);
      });
      groupAngle = d;
      touch();
      showAngle(deg);
    }
    return;
  }
  if (!drag) return;
  pointerRay(ev);
  if (!ray.ray.intersectPlane(plane, hit)) return;
  // 掴んだ所からの差。選択全体を同じだけ動かす
  const mx = hit.x - drag.grab.x, mz = hit.z - drag.grab.z;
  drag.recs.forEach((r, i) => {
    r.translation[0] = drag.base[i][0] + mx;
    r.translation[2] = drag.base[i][2] + mz;
  });
  const m = unionBox(drag.recs, 0, 0);
  const d = m ? resolveDelta(m, new Set(drag.recs), ev) : { dx: 0, dz: 0 };
  drag.recs.forEach((r, i) => {
    const x = drag.base[i][0] + mx + d.dx;
    const z = drag.base[i][2] + mz + d.dz;
    // **動かすたびに支えを見直す。** 花瓶を机へ引き込んだら天板へ載り、
    // 外へ出したら床へ降りる
    const y = drag.recs.length === 1
      ? surfaceAt(x, z, r.asset_id, r) : null;
    place(r, x, z, y ?? r.translation[1]);
  });
});

const endDrag = () => {
  // **区切りは指を離したとき。** 途中経過を積むと、1 回動かすのに
  // 何十回も取り消すことになる
  if (band) endBand();
  if (drag) { history.commit(drag.before, '移動'); drag = null; hideGuides(); }
  if (spin) {
    history.commit(spin.before, '回転');
    spin = null; guide.visible = false; hideAngle();
  }
  V.controls.enabled = true;
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
function showAngle(deg = 0) {
  if (!spin) return;
  const r = renderer.domElement.getBoundingClientRect();
  const h = handleWorld().project(V.cam);
  tag.style.left = `${(h.x + 1) / 2 * r.width}px`;
  tag.style.top = `${(-h.y + 1) / 2 * r.height}px`;
  tag.textContent = `${Math.round(deg)}°`;
  tag.hidden = false;
}
const hideAngle = () => { tag.hidden = true; };
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

function focusOn(rec) {
  const a = sizes[rec.asset_id];
  V.focus(new THREE.Vector3(rec.holder.position.x,
    rec.holder.position.y + a.size[1] / 2, rec.holder.position.z),
    Math.max(a.size[0], a.size[2]));
}

addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  if (ev.key === 'Escape') return select(null);
  if (ev.key === 'v' || ev.key === 'V') return setView(!V.is2D);

  // **何も選んでいなくても効く必要がある**ので、選択の判定より前に置く。
  // macOS の Cmd+Shift+Z は key が 'Z' で来るため小文字に寄せる
  const meta = ev.metaKey || ev.ctrlKey;
  if (meta && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    if (drag || spin) return;     // 掴んでいる最中に足元を入れ替えない
    return void (ev.shiftKey ? history.redo() : history.undo());
  }
  if (meta && ev.key.toLowerCase() === 'a') {
    ev.preventDefault();
    return setSelection([...items]);
  }
  if (meta && ev.key.toLowerCase() === 'd') {
    ev.preventDefault();
    return void duplicate();
  }
  if (meta && ev.key.toLowerCase() === 'y') {
    ev.preventDefault();
    if (!drag && !spin) history.redo();
    return;
  }

  if (!selection.length) return;
  if (ev.key === 'f' || ev.key === 'F') return focusOn(primary());

  const arrow = ARROWS[ev.key];
  if (arrow) {
    ev.preventDefault();                    // 押さないと右の欄が送られる
    // 50mm 刻み。5mm（しまい込める最小）を既定にすると、1m 動かすのに
    // 200 回押すことになる
    const n = ev.shiftKey ? 0.005 : 0.05;
    const [ax, az] = arrow(V);
    step('移動', () => selection.forEach((r) => place(
      r, r.translation[0] + ax * n, r.translation[2] + az * n)));
    return;
  }
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

// --- 画面の組み立て ---------------------------------------------------

// 場面だけ。**毎フレーム走りうる経路**なので DOM を触らない
function syncScene() {
  const b = groupBounds();
  groupBox.visible = !!b && items.length > 1;
  if (b) groupBox.box.copy(b);
  paintSelection();
  placeDial();
  labelsBegin();                 // 札は場面全体で 1 つのプールを使い回す
  syncPlan();
  syncClash();
  syncGaps();
  labelsEnd();
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
    it.li.classList.toggle('bad', !!it.bad);
    it.li.lastElementChild.textContent = `${Math.round(it.rotation)}°`;
  }
  const w = $('#warn');
  w.hidden = !clashCount;
  // 保存の通知路（#msg）は使わない。上書きし合う
  if (clashCount) w.textContent = `重なり ${clashCount} 体`;

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
  $('#multi').hidden = selection.length < 2;
  if (sel) {
    $('#deg').value = Math.round(sel.rotation * 10) / 10;
    $('#ypos').value = Math.round(sel.translation[1] * 1000) / 1000;
  }
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

$('#showgap').addEventListener('change', () => want({ scene: true }));

$('#ypos').addEventListener('change', () => {
  const sel = primary();
  if (!sel) return;
  const v = parseFloat($('#ypos').value);
  if (!Number.isFinite(v)) return void ($('#ypos').value = sel.translation[1]);
  step('高さ', () => selection.forEach(
    (r) => place(r, r.translation[0], r.translation[2], Math.max(0, v))));
});

// --- 矢印の向き ----------------------------------------------------------
// 2D は見たままで、画面右が +X・画面の奥が −Z（`cam2.up` をそう決めてある）。
// **3D では視点に合わせて入れ替える**——後ろへ回り込んだとき、画面の「左」が
// −X とは限らない。世界軸のまま固定すると「矢印が逆に動く」ことになる
function screenAxes(V) {
  if (V.is2D) return { fwd: [0, -1], right: [1, 0] };
  const f = new THREE.Vector3();
  V.cam.getWorldDirection(f);
  f.y = 0;
  if (f.lengthSq() < 1e-9) return { fwd: [0, -1], right: [1, 0] };
  f.normalize();
  // 最も近い世界軸へ丸める。斜めのまま使うと刻みが軸からずれる
  const fwd = Math.abs(f.x) > Math.abs(f.z)
    ? [Math.sign(f.x), 0] : [0, Math.sign(f.z)];
  return { fwd, right: [-fwd[1], fwd[0]] };
}

const ARROWS = {
  ArrowUp: (V) => screenAxes(V).fwd,
  ArrowDown: (V) => screenAxes(V).fwd.map((v) => -v),
  ArrowRight: (V) => screenAxes(V).right,
  ArrowLeft: (V) => screenAxes(V).right.map((v) => -v),
};

// --- 並べる --------------------------------------------------------------
/** 選択の外接を並び順どおりに作る */
const selBoxes = () => selection.map((r) => {
  const q = footRect(r);
  return { ...G.aabb(q), cx: q.cx, cz: q.cz };
});

function applyDeltas(ds, label) {
  step(label, () => selection.forEach((r, i) => {
    if (!ds[i]) return;
    place(r, r.translation[0] + ds[i].dx, r.translation[2] + ds[i].dz);
  }));
}

for (const b of document.querySelectorAll('#multi [data-align]'))
  b.onclick = () => {
    if (selection.length < 2) return;
    applyDeltas(alignDelta(selBoxes(), b.dataset.align), '整列');
  };

for (const b of document.querySelectorAll('#multi [data-spread]'))
  b.onclick = () => {
    if (selection.length < 3) return;
    const { deltas, fits } = spreadDelta(selBoxes(), b.dataset.spread);
    applyDeltas(deltas, '等間隔');
    if (!fits) note('入りきらないので中心を均しました', true);
  };

/** 隣に接して複製する。連打すると椅子が並ぶ。
 *
 * 自分の幅ぶん +X へずらすので、複製が元と重なることがない。
 */
async function duplicate() {
  if (!selection.length) return;
  const b = unionBox(selection, 0, 0);
  if (!b) return;
  const src = [...selection];
  const dx = (b.x1 - b.x0) + 0.02;
  const made = [];
  await history.batch('複製', async () => {
    for (const r of src) {
      const n = await add(r.asset_id,
        { x: r.translation[0] + dx, z: r.translation[2] },
        r.rotation, r.translation[1]);
      if (n) made.push(n);
    }
  });
  setSelection(made);
  redrawAll();
}

// --- 視点の切り替え -----------------------------------------------------
function setView(to2D) {
  V.setMode(to2D);
  for (const b of document.querySelectorAll('#viewmode button'))
    b.classList.toggle('on', (b.dataset.mode === '2d') === to2D);
  want({ scene: true });
}
for (const b of document.querySelectorAll('#viewmode button'))
  b.onclick = () => setView(b.dataset.mode === '2d');

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
    li.ondblclick = () => add(a.id, { x: snap(V.controls.target.x),
                                      z: snap(V.controls.target.z) });
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
  setupRoom();
  paintAssets();
  await refreshList();
  resize(); redrawAll();
})();
