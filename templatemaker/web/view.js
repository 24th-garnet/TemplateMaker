// 視点。3D の斜めと、2D の真上を切り替える。
//
// **配置作業の本体は真上から。** 透視投影では奥行きが目測できず、床のどこへ
// 着くかが画面上の位置から読めない。このたぐいの道具が例外なく 2 面を持って
// いるのはそのため。3D は「収まり」を見るためのもので、置くためのものではない。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

//: 2D のとき、画面の高さが何メートルぶんか
const PLAN_H = 8;

export function createView(renderer, scene, box) {
  const cam3 = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  cam3.position.set(4, 3.4, 4.6);
  const c3 = new OrbitControls(cam3, renderer.domElement);
  c3.target.set(0, 0.45, 0);
  c3.maxPolarAngle = Math.PI / 2 - 0.02;        // 床より下へ回り込まない

  const cam2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  cam2.position.set(0, 30, 0);
  // **画面の上を −Z にする。** 間取り図と同じ向きで、画面右が +X になる。
  // この 1 行が「左揃え」や矢印キーの軸の意味を決める
  cam2.up.set(0, 0, -1);
  const c2 = new OrbitControls(cam2, renderer.domElement);
  c2.enableRotate = false;                       // 傾けたら 3D と同じものになる
  c2.screenSpacePanning = false;
  c2.minZoom = 0.3; c2.maxZoom = 12;
  // **左ボタンを空ける。** 2D では左ドラッグを矩形選択に使う
  c2.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  c2.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

  let is2D = false;
  c2.enabled = false;
  //: 3D 側の眺め方を覚えておく。切り替えのたびに視点が戻ると鬱陶しい
  let offset3 = new THREE.Vector3().subVectors(cam3.position, c3.target);

  const api = {
    get is2D() { return is2D; },
    get cam() { return is2D ? cam2 : cam3; },
    get controls() { return is2D ? c2 : c3; },

    resize() {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam3.aspect = w / h; cam3.updateProjectionMatrix();
      const half = PLAN_H / 2, hw = half * w / h;
      cam2.top = half; cam2.bottom = -half;
      cam2.left = -hw; cam2.right = hw;
      cam2.updateProjectionMatrix();
    },

    /** 画面 1px が世界で何メートルか。吸着の許容を見た目で決めるのに使う。
     *
     * 引いて全体を見ているときに 5mm しか吸わないのでは、吸う意味がない。
     */
    mpp(at) {
      if (is2D) return (cam2.top - cam2.bottom) / cam2.zoom / (box.clientHeight || 1);
      const d = cam3.position.distanceTo(at ?? c3.target);
      return 2 * Math.tan(THREE.MathUtils.degToRad(cam3.fov / 2)) * d
             / (box.clientHeight || 1);
    },

    setMode(to2D) {
      if (to2D === is2D) return;
      const from = api.controls.target.clone();
      if (!to2D) offset3 = new THREE.Vector3().subVectors(cam3.position, c3.target);
      is2D = to2D;
      if (to2D) {
        c2.target.set(from.x, 0, from.z);
        cam2.position.set(from.x, 30, from.z);
      } else {
        c3.target.set(from.x, 0.45, from.z);
        cam3.position.copy(c3.target).add(offset3);
      }
      c3.enabled = !to2D; c2.enabled = to2D;
      api.resize();
    },

    toggle() { api.setMode(!is2D); },

    /** 視点が動いたら知らせる。**両方に繋ぐ**——切り替えた先で
     * 札が追従しなくなるのを防ぐ */
    onChange(fn) {
      c3.addEventListener('change', fn);
      c2.addEventListener('change', fn);
    },

    /** そこへ寄る。2D では高さを触らない。 */
    focus(at, span = 1) {
      if (is2D) {
        c2.target.set(at.x, 0, at.z);
        cam2.position.set(at.x, 30, at.z);
        cam2.zoom = Math.min(c2.maxZoom, Math.max(c2.minZoom, PLAN_H / (span * 3)));
        cam2.updateProjectionMatrix();
      } else {
        const d = new THREE.Vector3().subVectors(cam3.position, c3.target);
        c3.target.copy(at);
        cam3.position.copy(at).add(d);
      }
    },
  };
  return api;
}
