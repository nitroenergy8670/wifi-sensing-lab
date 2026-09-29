// 3. 장치 연결: 전원·무선·기록 경로를 3D 구성도로 보여 준다. GPIO 핀 배선도가 아니다.
(function (S) {
  const H = S.three, V = H.V, C = H.C, mat = H.mat, basic = H.basic, box = H.box, rod = H.rod;
  const K = S.link = {};

  // 장치 자리 (구성도용 좌표, m 단위 느낌만)
  K.NODES = [
    { id: 'ap', name: '공유기 2.4 GHz', kind: 'ap', p: [1.6, 2.6, 0.9], col: '--ap', size: [0.34, 0.06, 0.22] },
    { id: 'rx1', name: 'RX1', kind: 'rx', p: [0.2, 1.3, 0.9] }, { id: 'rx2', name: 'RX2', kind: 'rx', p: [0.75, 1.3, 0.9] },
    { id: 'rx3', name: 'RX3', kind: 'rx', p: [1.3, 1.3, 0.9] }, { id: 'rx4', name: 'RX4', kind: 'rx', p: [1.85, 1.3, 0.9] },
    { id: 'rx5', name: 'RX5', kind: 'rx', p: [2.4, 1.3, 0.9] }, { id: 'rx6', name: 'RX6', kind: 'rx', p: [2.95, 1.3, 0.9] },
    { id: 'ble', name: 'BLE 송신기 (선택)', kind: 'ble', p: [3.0, 2.6, 0.9], col: '--radio', size: [0.1, 0.03, 0.06] },
    { id: 'chg', name: 'USB 충전기', kind: 'charger', p: [1.6, 0.2, 0.1], col: '--spacer', size: [0.3, 0.08, 0.16] },
    { id: 'pc', name: '기록 PC', kind: 'desk', p: [0.2, 3.6, 0.9], col: '--board', size: [0.4, 0.03, 0.28] },
    { id: 'pi', name: 'Pi 4 + 카메라', kind: 'camera', p: [3.0, 3.6, 0.9], col: '--ok', size: [0.12, 0.04, 0.09] }
  ];
  const RX = ['rx1', 'rx2', 'rx3', 'rx4', 'rx5', 'rx6'];

  // 연결 묶음. state: ok(공동 장비로 바로 가능) · todo(구현·설정 필요) · opt(선택) · off(쓰지 않음)
  K.GROUPS = [
    { id: 'power', name: 'USB 전원', col: '--w-5v', state: 'ok', stateText: '공동 재료', edges: RX.map(r => ['chg', r]),
      det: '충전기 → 수신기 6대. 데이터는 이 선으로 보내지 않는다.' },
    { id: 'wifi', name: 'Wi-Fi 패킷 (측정 링크)', col: '--ok', state: 'ok', stateText: '측정 대상', edges: RX.map(r => ['ap', r]),
      det: '공유기가 보낸 패킷을 수신기가 받으며 CSI·RSSI를 얻는다. 사람이 이 링크 6개를 바꾼다.' },
    { id: 'ble', name: 'BLE 광고', col: '--radio', state: 'opt', stateText: '선택', edges: RX.map(r => ['ble', r]),
      det: '고정 광고기 → 수신기 BLE 스캔. Wi-Fi와 RF를 시분할하므로 CSI 단독 확인 뒤 추가.' },
    { id: 'upload', name: '측정값 업로드', col: '--up', state: 'todo', stateText: '구현 필요', dashed: true, edges: RX.map(r => [r, 'ap']),
      det: '수신기가 CSI·메타데이터를 큐에 넣고 UDP/TCP로 보낸다. 예제 csi_recv_router는 시리얼 출력이라 새로 구현해야 한다.' },
    { id: 'store', name: 'PC 저장', col: '--up', state: 'todo', stateText: '설정 필요', edges: [['ap', 'pc']],
      det: '공유기 → PC 수신 프로그램. LAN 또는 5 GHz 권장. 수신기 시각·순번·PC 도착 시각을 따로 저장.' },
    { id: 'gt', name: '정답 영상', col: '--tape', state: 'todo', stateText: '시각 대응 확인', edges: [['pi', 'pc']],
      det: '카메라 영상으로 위치·자세·재실 라벨을 만든다. 센싱 입력에는 넣지 않는다.' },
    { id: 'uwb', name: 'DWM3000EVB (연결된 채)', col: '--shield', state: 'off', stateText: '사용 안 함', edges: [],
      det: '공동 앵커 보드에 붙어 있는 UWB 모듈. Wi-Fi 센싱에 쓰지 않고 팀원 배선을 보존한다.' }
  ];

  K.createView = function (host, opts) {
    opts = opts || {};
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    const layer = document.createElement('div'); layer.className = 'labels'; host.appendChild(layer);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.03, 100);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12; controls.maxPolarAngle = Math.PI * 0.49;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556660, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.5); sun.position.set(3, 8, 5); scene.add(sun);
    const root = new THREE.Group(); scene.add(root);
    const view = {}, labels = [], picks = [], lines = {};
    const pos = {};

    function label(text, p, cls) { const el = document.createElement('div'); el.className = 'lbl ' + (cls || ''); el.textContent = text; layer.appendChild(el); labels.push({ el, p }); }
    const pv = new THREE.Vector3();
    function updateLabels() {
      const w = host.clientWidth, h = host.clientHeight;
      labels.forEach(L => {
        pv.copy(L.p).project(camera);
        if (pv.z > 1 || pv.z < -1) { L.el.style.display = 'none'; return; }
        L.el.style.display = '';
        L.el.style.transform = 'translate(' + ((pv.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-pv.y * 0.5 + 0.5) * h).toFixed(1) + 'px) translate(-50%,-130%)';
      });
    }

    view.build = function () {
      root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
      while (root.children.length) root.remove(root.children[0]);
      labels.splice(0).forEach(L => L.el.remove()); picks.length = 0;
      scene.background = C('--scene');
      const table = box(3.6, 0.04, 4.2, H.mat(C('--floor'), { roughness: 1 })); table.position.copy(V(1.6, 1.9, 0.0)); root.add(table);
      K.NODES.forEach(n => {
        const g = new THREE.Group(); g.position.copy(V(n.p[0], n.p[1], n.p[2]));
        if (n.kind === 'rx') {
          g.add(box(0.07, 0.012, 0.16, mat(C('--board'))));
          const sh = box(0.1, 0.012, 0.13, mat(C('--shield'), { transparent: true, opacity: 0.55 })); sh.position.set(0, 0.018, 0.04); g.add(sh);
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), basic(C('--accent'))); dot.position.set(0, 0.02, -0.07); g.add(dot);
        } else {
          g.add(box(n.size[0], n.size[1], n.size[2], mat(C(n.col))));
          if (n.kind === 'ap') [-0.1, 0, 0.1].forEach(k => g.add(rod(new THREE.Vector3(k, 0.03, 0.09), new THREE.Vector3(k, 0.22, 0.09), 0.007, mat(C('--board')))));
          if (n.kind === 'desk') { const s = box(0.4, 0.26, 0.01, mat(C('--board'))); s.position.set(0, 0.14, 0.14); s.rotation.x = 0.25; g.add(s); }
        }
        if (n.p[2] > 0.3) g.add(rod(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, -n.p[2], 0), 0.012, mat(C('--metal'))));
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), basic(C('--accent'), { transparent: true, opacity: 0.0, depthWrite: false }));
        hit.userData.pick = { kind: n.kind, id: n.kind === 'rx' ? +n.id.slice(2) : null }; g.add(hit); picks.push(hit);
        root.add(g);
        pos[n.id] = V(n.p[0], n.p[1], n.p[2] + 0.03);
        label(n.name, V(n.p[0], n.p[1], n.p[2] + 0.12), n.kind === 'rx' ? 'rx' : n.kind === 'ap' ? 'ap' : n.kind === 'ble' ? 'ble' : '');
      });
      K.GROUPS.forEach(gr => {
        lines[gr.id] = gr.edges.map((e, k) => {
          const a = pos[e[0]].clone(), b = pos[e[1]].clone();
          const lift = gr.id === 'upload' ? 0.18 : gr.id === 'ble' ? 0.1 : gr.id === 'power' ? -0.02 : 0.05;
          const mid = a.clone().lerp(b, 0.5); mid.y += 0.25 + lift;
          if (gr.id === 'power') { b.y -= 0.03; mid.copy(a).lerp(b, 0.5); mid.y = a.y; }
          const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
          let obj;
          if (gr.dashed) {
            obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), new THREE.LineDashedMaterial({ color: C(gr.col), dashSize: 0.05, gapSize: 0.035 }));
            obj.computeLineDistances();
          } else obj = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, gr.id === 'ble' ? 0.005 : 0.009, 6, false), basic(C(gr.col), { transparent: true, opacity: 0.85 }));
          root.add(obj); return obj;
        });
      });
      view.highlight(view.cur || null);
    };
    view.cur = null;
    view.hidden = {};
    view.highlight = function (gid) {
      view.cur = gid;
      K.GROUPS.forEach(gr => (lines[gr.id] || []).forEach(o => {
        o.visible = !view.hidden[gr.id];
        o.material.opacity = !gid || gid === gr.id ? 0.9 : 0.12;
        o.material.transparent = true;
      }));
    };
    view.frame = function () {
      const zoom = parseFloat(document.documentElement.dataset.zoom) || 1, t = V(1.6, 1.9, 0.6), d = 5.2 / zoom;
      controls.target.copy(t); camera.position.set(t.x + d * 0.35, t.y + d * 0.8, t.z + d * 0.6); controls.update();
    };

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
      const hits = ray.intersectObjects(picks, false);
      if (opts.onPick) opts.onPick(hits.length ? hits[0].object.userData.pick : null);
    });
    function resize() { const w = Math.max(host.clientWidth, 1), h = Math.max(host.clientHeight, 1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    new ResizeObserver(resize).observe(host); resize();
    let visible = true;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(host);
    (function tick() { requestAnimationFrame(tick); if (!visible) return; controls.update(); renderer.render(scene, camera); updateLabels(); })();
    view.build(); view.frame();
    return view;
  };
})(window.WSIM);
