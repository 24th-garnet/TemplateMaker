// 参照用の部屋。**テンプレートには保存しない。**
//
// 吸着も通路幅も、壁が無いと意味を持たない。一方でテンプレートは部屋から
// 独立しているべきで、「オフィスセットA」は 6 畳にも 10 畳にも置けなければ
// ならない。そこで部屋は**作業中の目安**として置き、記録には入れない。
// `items` に混ぜないこと自体が、その保証になっている。
import * as THREE from 'three';

import { ROOM_H } from './spec.js';

export function createRoom(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  let size = null, mesh = null, line = null;

  function build(w, d) {
    for (const o of [mesh, line]) {
      if (!o) continue;
      group.remove(o); o.geometry.dispose(); o.material.dispose();
    }
    // **裏面だけ描く箱。** 外から見ると手前の壁が自動で消えて奥だけが残り、
    // 真上から見ると天井が消えて床が残る。2D と 3D で場合分けが要らない
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, ROOM_H, d),
      new THREE.MeshStandardMaterial({ color: 0x242831, side: THREE.BackSide,
                                       roughness: 1 }));
    mesh.position.y = ROOM_H / 2;
    group.add(mesh);

    // 床の輪郭。材質が暗いので、真上からでも外形が読めるように
    const hx = w / 2, hz = d / 2;
    const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    const pos = [];
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      pos.push(a[0], 0.002, a[1], b[0], 0.002, b[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: 0x8d94a3, transparent: true, opacity: 0.7 }));
    group.add(line);
  }

  return {
    get size() { return size; },

    /** `null` で消す。**原点に固定して動かさない**——`recenter` がセットを
     * 原点へ寄せる規約と合い、壁が安定した吸着の相手になる。 */
    set(wd) {
      size = wd && wd[0] > 0 && wd[1] > 0 ? { w: +wd[0], d: +wd[1] } : null;
      if (size) build(size.w, size.d);
      group.visible = !!size;
      return size;
    },

    /** 吸着と間隔のための壁。内側の面の位置と、室内を向く角度。
     *
     * 角度はローカル +Z が正面という約束に合わせてある（回転つまみの印と同じ）。
     */
    walls() {
      if (!size) return [];
      const hx = size.w / 2, hz = size.d / 2;
      return [
        { side: '-x', axis: 'x', at: -hx, face: 90 },
        { side: '+x', axis: 'x', at: hx, face: 270 },
        { side: '-z', axis: 'z', at: -hz, face: 0 },
        { side: '+z', axis: 'z', at: hz, face: 180 },
      ];
    },
  };
}
