// Three.js 3D 화면. 시뮬레이션 좌표 (x 동, y 북, z 위) → three.js (x, z, -y)
(function (S) {
  const G = S.geom;
  const V = (x, y, z) => new THREE.Vector3(x, z, -y);
  const VP = p => V(p[0], p[1], p[2]);
  const UP = new THREE.Vector3(0, 1, 0);
  const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888888';
  const C = n => new THREE.Color(tok(n));
  const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8, metalness: 0.05 }, o || {}));
  const basic = (c, o) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o || {}));
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  S.three = { V, VP, C, tok, mat, basic, box };

  function rod(a, b, r, m) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 8), m);
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    return mesh;
  }
  S.three.rod = rod;
  const tv = new THREE.Vector3();
  function setBeam(m, a, b, r) {
    const d = tv.subVectors(b, a), L = d.length() || 1e-6;
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.divideScalar(L));
    m.scale.set(r, L, r);
  }
  function clearGroup(g) {
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
    while (g.children.length) g.remove(g.children[0]);
  }
  function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }

  // ---- 모델 ----
  // 사람: 서기·걷기 (앞 = 지역 +x)
  function makeStand(m) {
    const g = new THREE.Group();
    const legs = [-0.09, 0.09].map(z => { const p = new THREE.Group(); p.position.set(0, 0.8, z); const l = box(0.13, 0.8, 0.13, m); l.position.y = -0.4; p.add(l); g.add(p); return p; });
    const torso = box(0.24, 0.62, 0.42, m); torso.position.y = 1.12; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), m); head.position.y = 1.58; g.add(head);
    const arms = [-0.27, 0.27].map(z => { const p = new THREE.Group(); p.position.set(0, 1.38, z); const a = box(0.09, 0.56, 0.09, m); a.position.y = -0.28; p.add(a); g.add(p); return p; });
    g.userData = { legs, arms };
    return g;
  }
  function makeSit(m) {
    const g = new THREE.Group();
    [-0.09, 0.09].forEach(z => {
      const th = box(0.44, 0.13, 0.13, m); th.position.set(0.12, 0.5, z); g.add(th);
      const sh = box(0.12, 0.46, 0.12, m); sh.position.set(0.32, 0.23, z); g.add(sh);
    });
    const torso = box(0.24, 0.6, 0.42, m); torso.position.set(-0.08, 0.86, 0); g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), m); head.position.set(-0.08, 1.3, 0); g.add(head);
    [-0.27, 0.27].forEach(z => { const a = box(0.09, 0.5, 0.09, m); a.position.set(0.0, 0.85, z); a.rotation.z = 0.5; g.add(a); });
    return g;
  }
  function makeChair(m) {
    const g = new THREE.Group();
    const seat = box(0.44, 0.04, 0.44, m); seat.position.y = 0.44; g.add(seat);
    const back = box(0.04, 0.45, 0.44, m); back.position.set(-0.22, 0.68, 0); g.add(back);
    [[0.2, 0.2], [0.2, -0.2], [-0.2, 0.2], [-0.2, -0.2]].forEach(q => { const l = box(0.03, 0.44, 0.03, m); l.position.set(q[0], 0.22, q[1]); g.add(l); });
    return g;
  }
  S.three.makeStand = makeStand;

  S.createView = function (host, opts) {
    opts = opts || {};
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    const layer = document.createElement('div'); layer.className = 'labels'; host.appendChild(layer);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.03, 200);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 0.3; controls.maxDistance = 60;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556660, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(4, 9, 6); scene.add(sun);
    const envG = new THREE.Group(), ovG = new THREE.Group(), dynG = new THREE.Group();
    scene.add(envG); scene.add(ovG); scene.add(dynG);
    const view = { host, env: null };
    let labels = [], picks = [], rxPos = [], apPos = null, blePos = null, rings = [], dyn = null;

    // ---- 이름표 ----
    function label(text, pos, cls, group) {
      const el = document.createElement('div');
      el.className = 'lbl ' + (cls || ''); el.textContent = text; layer.appendChild(el);
      const L = { el, pos, group, mid: /plain|pt/.test(cls || '') };
      labels.push(L); return L;
    }
    function clearLabels(group) { labels = labels.filter(L => { if (L.group === group) { L.el.remove(); return false; } return true; }); }
    const pv = new THREE.Vector3();
    function updateLabels() {
      const w = host.clientWidth, h = host.clientHeight;
      labels.forEach(L => {
        if (L.hidden) { L.el.style.display = 'none'; return; }
        pv.copy(typeof L.pos === 'function' ? L.pos() : L.pos).project(camera);
        if (pv.z > 1 || pv.z < -1) { L.el.style.display = 'none'; return; }
        L.el.style.display = '';
        L.el.style.transform = 'translate(' + ((pv.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-pv.y * 0.5 + 0.5) * h).toFixed(1) + 'px) translate(-50%,' + (L.mid ? '-50%' : '-130%') + ')';
      });
    }
    function pickable(o, info, group) { o.userData.pick = info; o.userData.group = group; picks.push(o); }

    // 벽에 붙는 보드 (앞 = 벽 안쪽 법선)
    function wallBoard(d, kind) {
      const g = new THREE.Group();
      g.position.copy(V(d.x, d.y, d.z)); g.rotation.y = Math.atan2(d.nx, -d.ny);
      const sp = box(0.05, 0.08, 0.07, mat(C('--spacer'))); sp.position.z = -0.047; g.add(sp);
      if (kind === 'rx') {
        const esp = box(0.026, 0.063, 0.004, mat(C('--board'))); esp.position.set(-0.03, -0.01, -0.008); g.add(esp);
        const sh = box(0.054, 0.069, 0.004, mat(C('--shield'), { transparent: true, opacity: 0.55 })); sh.position.set(0.015, 0, -0.004); g.add(sh);
        const ant = box(0.012, 0.018, 0.003, mat(C('--metal'), { metalness: 0.6 })); ant.position.set(-0.03, 0.028, -0.004); g.add(ant);
      }
      const col = kind === 'rx' ? '--accent' : kind === 'ble' ? '--radio' : '--ap';
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), basic(C(col))); dot.position.set(kind === 'rx' ? -0.03 : 0, 0.028, 0.006); g.add(dot);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), basic(C(col), { transparent: true, opacity: 0.22, depthWrite: false }));
      halo.position.copy(dot.position); g.add(halo);
      g.userData.halo = halo;
      return g;
    }
    function router(d) {
      const g = new THREE.Group();
      g.position.copy(V(d.x, d.y, d.z)); g.rotation.y = Math.atan2(d.nx, -d.ny);
      const b = box(0.22, 0.04, 0.14, mat(C('--board'))); g.add(b);
      [-0.08, 0, 0.08].forEach(k => g.add(rod(new THREE.Vector3(k, 0.02, -0.06), new THREE.Vector3(k, 0.18, -0.06), 0.006, mat(C('--board')))));
      const shelf = box(0.28, 0.02, 0.2, mat(C('--spacer'))); shelf.position.y = -0.03; g.add(shelf);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), basic(C('--ap'), { transparent: true, opacity: 0.18, depthWrite: false })); g.add(halo);
      g.userData.halo = halo;
      return g;
    }

    // ---- 환경 ----
    view.setEnv = function (env, o) {
      o = o || {};
      clearGroup(envG); clearLabels('env'); clearGroup(ovG); clearLabels('ov');
      picks = picks.filter(p => p.userData.group !== 'env' && p.userData.group !== 'ov');
      view.env = env; rxPos = []; rings = [];
      const R = env.room, lay = env.lay;
      scene.background = C('--scene');

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(R.w, R.l), mat(C('--floor'), { roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.copy(V(R.w / 2, R.l / 2, 0)); envG.add(floor);
      const gp = [];
      for (let x = 0; x <= R.w + 1e-6; x += 0.5) gp.push(V(x, 0, 0.002), V(x, R.l, 0.002));
      for (let y = 0; y <= R.l + 1e-6; y += 0.5) gp.push(V(0, y, 0.002), V(R.w, y, 0.002));
      envG.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gp), new THREE.LineBasicMaterial({ color: C('--grid') })));
      const wallM = basic(C('--wall'), { transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
      [[R.w / 2, 0, R.w, 0], [R.w / 2, R.l, R.w, 0], [0, R.l / 2, R.l, Math.PI / 2], [R.w, R.l / 2, R.l, Math.PI / 2]].forEach(q => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(q[2], R.h), wallM); m.position.copy(V(q[0], q[1], R.h / 2)); m.rotation.y = q[3]; envG.add(m);
      });
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(R.w, R.h, R.l)), new THREE.LineBasicMaterial({ color: C('--wall') }));
      edges.position.copy(V(R.w / 2, R.l / 2, R.h / 2)); envG.add(edges);
      label(R.w.toFixed(2) + ' m', V(R.w / 2, -0.12, 0), 'plain', 'env');
      label(R.l.toFixed(2) + ' m', V(R.w + 0.18, R.l / 2, 0), 'plain', 'env');
      label('천장 ' + R.h.toFixed(2) + ' m', V(R.w, 0, R.h), 'plain', 'env');

      // 문 (북쪽 벽 동쪽 끝)
      const D = S.DOOR, dc = S.doorX(R), x0 = dc - D.width / 2, x1 = dc + D.width / 2;
      const door = new THREE.Mesh(new THREE.PlaneGeometry(D.width, D.height), basic(C('--wall'), { transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      door.position.copy(V(dc, R.l + 0.002, D.height / 2)); envG.add(door);
      envG.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([V(x0, R.l, 0), V(x0, R.l, D.height), V(x1, R.l, D.height), V(x1, R.l, 0)]), new THREE.LineBasicMaterial({ color: C('--wall') })));
      label('문', V(dc, R.l, D.height + 0.08), 'plain', 'env');

      // 기록 PC (방 밖, 문 바로 옆 북동쪽 모서리. 책상 긴 쪽이 동쪽 벽과 나란함)
      const dx = R.w + S.DESK.off, dy = R.l - S.DESK.back;
      const top = box(0.55, 0.04, 1.0, mat(C('--cable'))); top.position.copy(V(dx, dy, 0.72)); envG.add(top);
      [[-0.24, -0.46], [0.24, -0.46], [-0.24, 0.46], [0.24, 0.46]].forEach(q => envG.add(rod(V(dx + q[0], dy + q[1], 0), V(dx + q[0], dy + q[1], 0.7), 0.015, mat(C('--metal')))));
      const lap = box(0.22, 0.02, 0.32, mat(C('--board'))); lap.position.copy(V(dx, dy, 0.75)); envG.add(lap);
      const scr = box(0.01, 0.21, 0.32, mat(C('--board'))); scr.position.copy(V(dx + 0.11, dy, 0.86)); scr.rotation.z = 0.25; envG.add(scr);
      pickable(top, { kind: 'desk' }, 'env');
      label('기록 PC (방 밖)', V(dx, dy, 1.0), '', 'env');

      // 공유기
      const apG = router(lay.ap); envG.add(apG); pickable(apG.userData.halo, { kind: 'ap' }, 'env');
      apPos = V(lay.ap.x, lay.ap.y, lay.ap.z);
      label('공유기 · ' + lay.ap.z.toFixed(2) + ' m', V(lay.ap.x, lay.ap.y, lay.ap.z + 0.2), 'ap', 'env');

      // 수신기
      const ringM = basic(C('--radio'), { transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
      lay.rx.forEach(r => {
        const g = wallBoard(r, 'rx'); envG.add(g); pickable(g.userData.halo, { kind: 'rx', id: r.id }, 'env');
        rxPos.push(V(r.x, r.y, r.z));
        label('RX' + r.id + ' · ' + r.z.toFixed(2) + ' m', V(r.x, r.y, r.z + 0.1), 'rx', 'env');
      });

      // BLE 송신기
      blePos = null;
      if (env.ble) {
        const g = wallBoard(lay.ble, 'ble'); envG.add(g); pickable(g.userData.halo, { kind: 'ble' }, 'env');
        blePos = V(lay.ble.x, lay.ble.y, lay.ble.z);
        label('BLE', V(lay.ble.x, lay.ble.y, lay.ble.z + 0.1), 'ble', 'env');
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 36), ringM.clone());
        ring.rotation.x = -Math.PI / 2; ring.position.copy(blePos); envG.add(ring); rings.push(ring);
      }

      // 정답 카메라
      if (env.camera) {
        const c = env.camera, g = new THREE.Group();
        g.position.copy(VP(c.pos)); g.lookAt(VP(c.tgt));
        const pi = box(0.085, 0.056, 0.02, mat(C('--ok'))); pi.position.z = -0.02; g.add(pi);
        g.add(box(0.03, 0.03, 0.012, mat(C('--board'))));
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), basic(C('--ok'), { transparent: true, opacity: 0.12, depthWrite: false })); g.add(hit);
        pickable(hit, { kind: 'camera' }, 'env');
        envG.add(g);
        label('정답 카메라 (Pi)', V(c.pos[0], c.pos[1], c.pos[2] + 0.1), '', 'env');
        if (o.showFov) {
          const h = o.fovH, poly = G.camCoverage(c, h, R);
          if (poly.length > 2) {
            const fm = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])))), basic(C('--ok'), { transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
            fm.rotation.x = -Math.PI / 2; fm.position.y = h; envG.add(fm);
            envG.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(poly.map(p => V(p[0], p[1], h))), new THREE.LineBasicMaterial({ color: C('--ok') })));
          }
          const cp = VP(c.pos), fl = [];
          G.camCorners(c, h).forEach(q => fl.push(cp, VP(q)));
          envG.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fl), new THREE.LineBasicMaterial({ color: C('--ok'), transparent: true, opacity: 0.3 })));
        }
      }

      // USB 케이블과 충전기
      if (o.cables) {
        o.cables.forEach(cb => {
          const path = new THREE.CurvePath();
          for (let i = 1; i < cb.pts.length; i++) path.add(new THREE.LineCurve3(VP(cb.pts[i - 1]), VP(cb.pts[i])));
          envG.add(new THREE.Mesh(new THREE.TubeGeometry(path, cb.pts.length * 12, 0.008, 6, false), mat(C(cb.over ? '--block' : '--cable'))));
          const p1 = cb.pts[1], p2 = cb.pts[2];
          label(cb.len.toFixed(1) + ' m', V(p1[0], p1[1], (p1[2] + p2[2]) / 2), cb.over ? 'over' : '', 'env');
        });
        (o.chargers || []).forEach(c => {
          const x = G.clamp(c[0], 0.06, R.w - 0.06), y = G.clamp(c[1], 0.06, R.l - 0.06);
          const b = box(0.09, 0.035, 0.07, mat(C('--spacer'))); b.position.copy(V(x, y, 0.02)); envG.add(b);
          pickable(b, { kind: 'charger' }, 'env');
          label('USB 충전기', V(x, y, 0.1), '', 'env');
        });
      }
      if (!o.keepCamera) view.frame();
    };

    // ---- 겹침 지도·프레넬 타원체 (1번 환경 전용 덧그림) ----
    view.setOverlay = function (o) {
      clearGroup(ovG); clearLabels('ov');
      const env = view.env;
      if (o.map) {
        const m = o.map, h = m.step / 2 * 0.94, pos = [], col = [];
        const cz = C('--block'), c1 = C('--edge'), c2 = C('--ok');
        m.cells.forEach(([x, y, n]) => {
          const c = n === 0 ? cz : n === 1 ? c1 : c2, a = n >= 2 ? Math.min(1, 0.45 + 0.1 * n) : 0.9;
          const q = [V(x - h, y - h, 0.006), V(x + h, y - h, 0.006), V(x + h, y + h, 0.006), V(x - h, y + h, 0.006)];
          [0, 1, 2, 0, 2, 3].forEach(k => { pos.push(q[k].x, q[k].y, q[k].z); col.push(c.r * a, c.g * a, c.b * a); });
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        ovG.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })));
      }
      (o.fresnel || []).forEach(i => {
        const L = env.links[i]; if (!L) return;
        const e = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), basic(C('--accent'), { transparent: true, opacity: o.fresnel.length > 1 ? 0.07 : 0.14, depthWrite: false }));
        e.position.copy(VP(L.mid)); e.scale.set(L.b, L.a, L.b);
        e.quaternion.setFromUnitVectors(UP, new THREE.Vector3().subVectors(VP(L.rx), VP(L.tx)).normalize());
        ovG.add(e);
        const w = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 14, 6)), new THREE.LineBasicMaterial({ color: C('--accent'), transparent: true, opacity: 0.25 }));
        w.position.copy(e.position); w.scale.copy(e.scale); w.quaternion.copy(e.quaternion); ovG.add(w);
        ovG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([VP(L.tx), VP(L.rx)]), new THREE.LineBasicMaterial({ color: C('--accent') })));
      });
      if (o.body) {
        const b = o.body, s = b.size;
        const m = box(s[0], s[2], s[1], basic(C('--person'), { transparent: true, opacity: 0.35, depthWrite: false }));
        m.position.copy(V((b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, s[2] / 2)); ovG.add(m);
        const w = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: C('--ink') }));
        w.position.copy(m.position); ovG.add(w);
        pickable(m, { kind: 'person' }, 'ov');
      }
    };

    view.frame = function () {
      const zoom = parseFloat(document.documentElement.dataset.zoom) || 1;
      const R = view.env.room, t = V(R.w / 2, R.l / 2, Math.min(1.0, R.h * 0.35)), d = (Math.max(R.w, R.l) * 1.2 + 2.4) / zoom;
      controls.target.copy(t);
      camera.position.set(t.x + d * 0.55, t.y + d * 0.72, t.z + d * 0.62);
      controls.update();
    };

    // ---- 2번 테스트 물체 (사람, 의자·매트, 가구, 경로, 링크 선) ----
    view.setTest = function (run) {
      clearGroup(dynG); clearLabels('dyn');
      picks = picks.filter(p => p.userData.group !== 'dyn');
      const env = view.env, d = {}, pm = mat(C('--person'), { roughness: 0.9 });
      d.stand = makeStand(pm); d.sit = makeSit(pm); d.lie = makeStand(pm);
      [d.stand, d.sit, d.lie].forEach(g => { dynG.add(g); g.traverse(o => { if (o.isMesh) pickable(o, { kind: 'person' }, 'dyn'); }); });
      d.lieWrap = new THREE.Group(); dynG.remove(d.lie); d.lie.rotation.z = Math.PI / 2; d.lie.position.set(0.85, 0.16, 0); d.lieWrap.add(d.lie); d.lieWrap.rotation.y = Math.PI / 2; dynG.add(d.lieWrap);
      d.chair = makeChair(mat(C('--cable'))); dynG.add(d.chair);
      d.mat = box(0.7, 0.04, 1.9, mat(C('--tape'), { roughness: 0.9 })); dynG.add(d.mat);
      d.furn = box(S.FURNITURE.hx * 2, S.FURNITURE.h, S.FURNITURE.hy * 2, mat(C('--furn'))); dynG.add(d.furn);
      pickable(d.furn, { kind: 'furniture' }, 'dyn');
      const tapeM = mat(C('--tape'), { roughness: 0.6 });
      if (run.loop) {
        for (let i = 1; i < run.loop.length; i++) {
          const a = run.loop[i - 1], b = run.loop[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const t = box(L + 0.05, 0.002, 0.05, tapeM);
          t.position.copy(V((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.003)); t.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]); dynG.add(t);
        }
        label('출발', V(run.loop[0][0], run.loop[0][1], 0.02), 'pt', 'dyn');
      }
      (run.points || []).forEach((p, i) => {
        [Math.PI / 4, -Math.PI / 4].forEach(r => { const t = box(0.16, 0.002, 0.025, tapeM); t.position.copy(V(p[0], p[1], 0.003)); t.rotation.y = r; dynG.add(t); });
        if (run.points.length > 1) {
          const L = label(String(i + 1), V(p[0] + 0.12, p[1] - 0.12, 0.02), 'pt', 'dyn');
          if (env.camera && !G.camSees(env.camera, [p[0], p[1], 1.0])) L.el.style.color = tok('--block');
        }
      });
      if (run.furnFrom) {
        const f = run.furnFrom, q = box(S.FURNITURE.hx * 2, 0.002, S.FURNITURE.hy * 2, basic(C('--furn'), { transparent: true, opacity: 0.35 }));
        q.position.copy(V(f[0], f[1], 0.004)); dynG.add(q);
        label('원래 자리', V(f[0], f[1], 0.03), 'pt', 'dyn');
      }
      const beam = new THREE.CylinderGeometry(1, 1, 1, 6);
      d.colors = { los: C('--ok'), edge: C('--edge'), block: C('--block') };
      d.links = env.lay.rx.map(() => { const m = new THREE.Mesh(beam, basic(C('--ok'), { transparent: true, opacity: 0.8, depthWrite: false })); dynG.add(m); return m; });
      d.ble = env.lay.rx.map(() => { const m = new THREE.Mesh(beam, basic(C('--radio'), { transparent: true, opacity: 0.35, depthWrite: false })); dynG.add(m); return m; });
      d.labelP = label('사람', () => tl.copy(d.anchor).setY(d.anchor.y + 0.1), 'person', 'dyn');
      d.anchor = new THREE.Vector3();
      dyn = d;
    };
    const tl = new THREE.Vector3();

    view.applyState = function (st, status, now) {
      if (!dyn) return;
      const d = dyn, p = st.person;
      d.stand.visible = d.sit.visible = d.lieWrap.visible = false;
      d.chair.visible = d.mat.visible = false;
      if (p) {
        if (p.pose === 'sit') {
          d.sit.visible = true; d.sit.position.copy(V(p.x, p.y, 0)); d.sit.rotation.y = p.hd;
          d.chair.visible = true; d.chair.position.copy(V(p.x, p.y, 0)); d.chair.rotation.y = p.hd;
          d.anchor.copy(V(p.x, p.y, 1.42));
        } else if (p.pose === 'lie') {
          d.lieWrap.visible = true; d.lieWrap.position.copy(V(p.x, p.y, 0));
          d.mat.visible = true; d.mat.position.copy(V(p.x, p.y, 0.02));
          d.anchor.copy(V(p.x, p.y, 0.5));
        } else {
          d.stand.visible = true; d.stand.position.copy(V(p.x, p.y, 0)); d.stand.rotation.y = p.hd;
          const sw = p.pose === 'walk' ? Math.sin(now * 7) * 0.4 : 0, u = d.stand.userData;
          u.arms[0].rotation.z = p.carry ? 1.2 : 0.05 + sw; u.arms[1].rotation.z = p.carry ? 1.2 : 0.05 - sw;
          u.legs[0].rotation.z = -sw * 0.8; u.legs[1].rotation.z = sw * 0.8;
          d.anchor.copy(V(p.x, p.y, 1.75));
        }
      }
      d.labelP.hidden = !p;
      d.furn.visible = !!st.furn;
      if (st.furn) d.furn.position.copy(V(st.furn[0], st.furn[1], S.FURNITURE.h / 2));
      d.links.forEach((m, i) => {
        const s = status[i];
        m.visible = s !== 'off';
        if (!m.visible) return;
        setBeam(m, apPos, rxPos[i], s === 'block' ? 0.008 : 0.005);
        m.material.color.copy(d.colors[s]); m.material.opacity = s === 'los' ? 0.55 : 0.95;
      });
      const bleOn = !!(blePos && st.seg.ble);
      d.ble.forEach((m, i) => { m.visible = bleOn && status[i] !== 'off'; if (m.visible) setBeam(m, blePos, rxPos[i], 0.0025); });
      rings.forEach(r => {
        r.visible = bleOn;
        if (r.visible) { const f = (now * 0.7) % 1; r.scale.setScalar(1 + f * 3.5); r.material.opacity = 0.45 * (1 - f); }
      });
    };

    // ---- 클릭 ----
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
      if (moved > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(picks.filter(shown), false);
      if (opts.onPick) opts.onPick(hits.length ? hits[0].object.userData.pick : null);
    });

    // ---- 크기·렌더 ----
    function resize() {
      const w = Math.max(host.clientWidth, 1), h = Math.max(host.clientHeight, 1);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(host); resize();
    let visible = true, last = performance.now();
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(host);
    function tick(now) {
      requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!visible) return;
      if (opts.onFrame) opts.onFrame(dt, now / 1000);
      controls.update(); renderer.render(scene, camera); updateLabels();
    }
    requestAnimationFrame(tick);
    view.renderer = renderer;
    return view;
  };
})(window.WSIM);
