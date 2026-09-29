// 순수 계산: 배치 좌표, USB 케이블, 링크 판정(직접경로·제1 프레넬 영역), 카메라 화각
(function (S) {
  const M = S.model, G = S.geom = {};
  const DEG = Math.PI / 180;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => mul(a, 1 / (len(a) || 1));
  G.dist3 = (a, b) => len(sub(a, b));
  G.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- 배치 ----
  // 방 크기에 맞춰 후보 배치를 만든다. 수신기 벽 방향(nx, ny)은 가장 가까운 벽의 안쪽 법선.
  function wallNormal(room, x, y) {
    const d = [x, room.w - x, y, room.l - y], k = d.indexOf(Math.min.apply(null, d));
    return [[1, 0], [-1, 0], [0, 1], [0, -1]][k];
  }
  G.layout = function (room, id) {
    const L = S.LAYOUTS.find(l => l.id === id) || S.LAYOUTS[0];
    const kx = room.w / S.ROOM_REF.w, ky = room.l / S.ROOM_REF.l;
    let xy;
    if (L.shared) {
      const i = 0.10;
      xy = [[i, i], [i, room.l / 2], [i, room.l - i], [room.w - i, i], [room.w - i, room.l / 2], [room.w - i, room.l - i]];
    } else {
      xy = S.RX_XY.map(p => [p[0] === 0.10 ? 0.10 : room.w - 0.10, p[1] * ky]);
    }
    const zmax = room.h - 0.05;
    const rx = xy.map((p, i) => {
      const n = wallNormal(room, p[0], p[1]);
      return { id: i + 1, x: p[0], y: p[1], z: Math.min(L.z[i], zmax), nx: n[0], ny: n[1] };
    });
    // 송신 ESP: 모든 배치 후보에서 매트 옆 낮은 자리 (data.js S.tx)
    const t = S.tx(room), an = wallNormal(room, t.x, t.y);
    const ap = { x: t.x, y: t.y, z: Math.min(t.z, zmax), nx: an[0], ny: an[1] };
    const bx = room.w - (S.ROOM_REF.w - S.BLE_TX[0]), by = S.BLE_TX[1];
    const bn = wallNormal(room, bx, by);
    const ble = { x: bx, y: by, z: Math.min(S.BLE_TX[2], zmax), nx: bn[0], ny: bn[1] };
    return { id: L.id, layout: L, rx, ap, ble };
  };
  const P3 = d => [d.x, d.y, d.z];
  G.P3 = P3;

  // ---- 사람·가구 상자 → [lo, hi] ----
  G.bodyBox = function (x, y, pose) {
    const s = S.BODY[pose] || S.BODY.stand;
    return { kind: 'person', lo: [x - s[0] / 2, y - s[1] / 2, 0], hi: [x + s[0] / 2, y + s[1] / 2, s[2]], size: s };
  };
  G.furnBox = function (x, y) {
    const F = S.FURNITURE;
    return { kind: 'furniture', lo: [x - F.hx, y - F.hy, 0], hi: [x + F.hx, y + F.hy, F.h] };
  };

  // ---- 링크: 송신 → 수신 ----
  // block: 직접경로 선분이 상자를 지난다. edge: 상자가 제1 프레넬 타원체(2.437 GHz)와 겹친다. los: 나머지.
  G.makeLinks = function (tx, rxs) {
    return rxs.map(r => M.fresnel(P3(tx), P3(r)));
  };
  G.linkStatus = function (link, boxes) {
    for (const b of boxes) if (M.chord(link.tx, link.rx, b.lo, b.hi) > 1e-9) return 'block';
    for (const b of boxes) if (M.minimum(link, b.lo, b.hi) <= 1 + 1e-10) return 'edge';
    return 'los';
  };

  // ---- 수신기 USB 케이블: 벽을 따라 바닥까지 내린 뒤 벽 아래를 따라 충전기까지 + 여유 0.3 m ----
  function perimS(room, x, y) {
    const W = room.w, L = room.l, d = [y, W - x, L - y, x], e = d.indexOf(Math.min.apply(null, d));
    return [x, W + y, W + L + (W - x), 2 * W + L + (L - y)][e];
  }
  function perimPt(room, s) {
    const W = room.w, L = room.l, P = 2 * (W + L);
    s = ((s % P) + P) % P;
    if (s <= W) return [s, 0];
    if ((s -= W) <= L) return [W, s];
    if ((s -= L) <= W) return [W - s, L];
    return [0, L - (s - W)];
  }
  function perimRoute(room, s1, s2) {
    const W = room.w, L = room.l, P = 2 * (W + L);
    let d = ((s2 - s1) % P + P) % P, dir = 1;
    if (d > P / 2) { d = P - d; dir = -1; }
    const corners = [0, W, W + L, 2 * W + L].map(c => [dir > 0 ? ((c - s1) % P + P) % P : ((s1 - c) % P + P) % P, c])
      .filter(q => q[0] > 1e-6 && q[0] < d - 1e-6).sort((a, b) => a[0] - b[0]);
    return { len: d, pts: [perimPt(room, s1)].concat(corners.map(q => perimPt(room, q[1])), [perimPt(room, s2)]) };
  }
  G.chargers = function (room, mode) {
    if (mode === 'one') return [[0, room.l / 2]];
    if (mode === 'two') return [[0, room.l / 2], [room.w, room.l / 2]];
    return null;
  };
  G.cables = function (room, rxs, mode) {
    const FLOOR = 0.08, SLACK = 0.3, OUTLET = 0.3, IN = 0.03;
    const ch = G.chargers(room, mode);
    const inset = p => [G.clamp(p[0], IN, room.w - IN), G.clamp(p[1], IN, room.l - IN)];
    return rxs.map(r => {
      const wx = r.x - r.nx * 0.1, wy = r.y - r.ny * 0.1, base = inset([wx, wy]);
      if (!ch) return { id: r.id, len: r.z - OUTLET + SLACK, over: false, pts: [[r.x, r.y, r.z], [base[0], base[1], r.z - 0.05], [base[0], base[1], OUTLET]] };
      const s1 = perimS(room, wx, wy);
      let best = null;
      ch.forEach((c, i) => { const q = perimRoute(room, s1, perimS(room, c[0], c[1])); if (!best || q.len < best.q.len) best = { q, i }; });
      const total = (r.z - FLOOR) + best.q.len + SLACK;
      const pts = [[r.x, r.y, r.z], [base[0], base[1], r.z - 0.05], [base[0], base[1], FLOOR]];
      best.q.pts.slice(1).forEach(p => { const v = inset(p); pts.push([v[0], v[1], FLOOR]); });
      return { id: r.id, len: total, over: total > S.CABLE_LEN, pts };
    });
  };

  // ---- 정답 카메라: 남서 모서리 천장 아래, 방 가운데를 겨눔 ----
  G.camera = function (room, aimH) {
    return { pos: [0.08, 0.08, Math.max(2.4, Math.min(room.h - 0.15, 2.85))], tgt: [room.w / 2, room.l / 2, aimH], hfov: S.CAMERA.hfov * DEG, vfov: S.CAMERA.vfov * DEG };
  };
  function basis(c) { const f = unit(sub(c.tgt, c.pos)), r = unit(cross(f, [0, 0, 1])); return { f, r, u: cross(r, f) }; }
  G.camSees = function (c, p) {
    const B = basis(c), v = sub(p, c.pos), z = dot(v, B.f);
    return z > 0 && Math.abs(Math.atan2(dot(v, B.r), z)) <= c.hfov / 2 && Math.abs(Math.atan2(dot(v, B.u), z)) <= c.vfov / 2;
  };
  // 카메라에서 사람 몸 가운데가 보이는지: ok · out(화각 밖) · hidden(가구에 가림)
  G.gtStatus = function (c, p, furn) {
    if (!G.camSees(c, p)) return 'out';
    for (const b of furn) if (M.chord(c.pos, p, b.lo, b.hi) > 1e-9) return 'hidden';
    return 'ok';
  };
  function ray(c, B, tx, ty) { return add(B.f, add(mul(B.r, tx * Math.tan(c.hfov / 2)), mul(B.u, ty * Math.tan(c.vfov / 2)))); }
  function hitPlane(c, d, h) {
    if (d[2] < -1e-6) { const t = (h - c.pos[2]) / d[2]; if (t > 0) return [c.pos[0] + d[0] * t, c.pos[1] + d[1] * t]; }
    const k = Math.hypot(d[0], d[1]) || 1;
    return [c.pos[0] + d[0] / k * 60, c.pos[1] + d[1] / k * 60];
  }
  G.camCorners = function (c, h) {
    const B = basis(c);
    return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(q => {
      const d = ray(c, B, q[0], q[1]);
      if (d[2] < -1e-6) return add(c.pos, mul(d, (h - c.pos[2]) / d[2]));
      return add(c.pos, mul(unit(d), 3));
    });
  };
  G.camCoverage = function (c, h, room) {
    const B = basis(c), N = 16, poly = [];
    for (let i = 0; i < N; i++) poly.push(hitPlane(c, ray(c, B, -1 + 2 * i / N, 1), h));
    for (let i = 0; i < N; i++) poly.push(hitPlane(c, ray(c, B, 1, 1 - 2 * i / N), h));
    for (let i = 0; i < N; i++) poly.push(hitPlane(c, ray(c, B, 1 - 2 * i / N, -1), h));
    for (let i = 0; i < N; i++) poly.push(hitPlane(c, ray(c, B, -1, -1 + 2 * i / N), h));
    return clip(poly, room.w, room.l);
  };
  function clip(poly, W, L) {
    const inside = [p => p[0] >= 0, p => p[0] <= W, p => p[1] >= 0, p => p[1] <= L];
    const at = [(a, b) => lerp(a, b, (0 - a[0]) / (b[0] - a[0])), (a, b) => lerp(a, b, (W - a[0]) / (b[0] - a[0])),
      (a, b) => lerp(a, b, (0 - a[1]) / (b[1] - a[1])), (a, b) => lerp(a, b, (L - a[1]) / (b[1] - a[1]))];
    let out = poly;
    for (let e = 0; e < 4 && out.length; e++) {
      const inp = out; out = [];
      inp.forEach((a, i) => {
        const b = inp[(i + 1) % inp.length], ia = inside[e](a), ib = inside[e](b);
        if (ia && ib) out.push(b);
        else if (ia) out.push(at[e](a, b));
        else if (ib) { out.push(at[e](a, b)); out.push(b); }
      });
    }
    return out;
  }
  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  G.polyArea = function (p) { let s = 0; p.forEach((a, i) => { const b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }); return Math.abs(s) / 2; };

  // ---- 바닥 겹침 지도: 사람 상자가 몇 개의 링크 프레넬 영역과 겹치는지 ----
  G.overlapMap = function (room, lay, pose, step) {
    const s = { room: [room.w, room.l, room.h], ap: P3(lay.ap), receivers: lay.rx.map(P3), pose: { stand: 'standing', sit: 'seated', lie: 'lying' }[pose] };
    return M.heatmap(s, step || 0.1);
  };
})(window.WSIM);
