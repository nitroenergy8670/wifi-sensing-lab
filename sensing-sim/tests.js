// 테스트 정의와 타임라인. 각 테스트는 구간 목록으로 사람(측정 대상)·가구의 위치와 기록 여부를 시간에 따라 정한다.
// 목적: 기존 방법 재현과 오류 진단에 쓸 원자료를 어떤 절차로 모을지 미리 보는 것. 조건별 성능 비교가 목적이 아니다.
(function (S) {
  const G = S.geom, T = S.tests = {};

  function TL() { this.segs = []; this.t = 0; this.recT = 0; this.hd = Math.PI / 2; }
  // o: { rec, label, step, pose: 'stand'|'walk'|'sit'|'lie'|null, path: [[x,y],...], furn: [x,y]|null, ble, rx: 'all'|[ids] }
  TL.prototype.add = function (dur, o) {
    const s = Object.assign({ rec: false, label: '', step: 0, pose: null, path: [[0, 0]], furn: null, ble: true, rx: 'all', carry: false }, o);
    s.t0 = this.t; s.t1 = this.t + dur; s.dur = dur; s.rec0 = this.recT;
    if (s.path.length > 1) {
      s.cum = [0];
      for (let i = 1; i < s.path.length; i++) s.cum.push(s.cum[i - 1] + Math.hypot(s.path[i][0] - s.path[i - 1][0], s.path[i][1] - s.path[i - 1][1]));
      s.plen = s.cum[s.cum.length - 1];
      const a = s.path[s.path.length - 2], b = s.path[s.path.length - 1];
      this.hd = Math.atan2(b[1] - a[1], b[0] - a[0]);
    } else s.hd = this.hd;
    if (s.rec) this.recT += dur;
    this.t += dur; this.segs.push(s);
    return s;
  };
  TL.prototype.walk = function (path, speed, o) {
    let d = 0;
    for (let i = 1; i < path.length; i++) d += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    return this.add(Math.max(d / speed, 0.5), Object.assign({ path, pose: 'walk' }, o));
  };

  T.stateAt = function (tl, t) {
    t = Math.max(0, Math.min(tl.t - 1e-6, t));
    let s = tl.segs[tl.segs.length - 1];
    for (const g of tl.segs) if (t < g.t1) { s = g; break; }
    const a = s.dur > 0 ? (t - s.t0) / s.dur : 1;
    let x, y, hd, d = 0;
    if (s.path.length > 1) {
      d = a * s.plen;
      let i = 1;
      while (i < s.cum.length - 1 && s.cum[i] < d) i++;
      const p0 = s.path[i - 1], p1 = s.path[i], sl = s.cum[i] - s.cum[i - 1], u = sl > 0 ? (d - s.cum[i - 1]) / sl : 0;
      x = p0[0] + (p1[0] - p0[0]) * u; y = p0[1] + (p1[1] - p0[1]) * u; hd = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    } else { x = s.path[0][0]; y = s.path[0][1]; hd = s.hd; }
    let furn = s.furn;
    if (s.furnTo) furn = [s.furn[0] + (s.furnTo[0] - s.furn[0]) * a, s.furn[1] + (s.furnTo[1] - s.furn[1]) * a];
    let label = s.label;
    if (s.lapLen) label += ' · ' + Math.min(s.laps, Math.floor(d / s.lapLen + 1e-9) + 1) + '/' + s.laps + '바퀴';
    const person = s.pose ? { x, y, hd, pose: s.pose, carry: s.carry } : null;
    return { t, seg: s, person, furn, recT: s.rec0 + (s.rec ? t - s.t0 : 0), label };
  };

  // 계산용 상자. 걷기는 서기 상자로 계산한다.
  T.boxes = function (st) {
    const out = [];
    if (st.person) out.push(G.bodyBox(st.person.x, st.person.y, st.person.pose === 'walk' ? 'stand' : st.person.pose));
    if (st.furn) out.push(G.furnBox(st.furn[0], st.furn[1]));
    return out;
  };
  T.activeRx = function (st, id) { return st.seg.rx === 'all' || st.seg.rx.indexOf(id) >= 0; };

  // 기록 구간 전체에서 수신기별 LOS·경계·가림 비율과 카메라 GT 상태 비율
  T.stats = function (run, env, test) {
    const tl = run.tl, dt = Math.max(0.5, tl.t / 2000);
    const cnt = env.lay.rx.map(() => ({ los: 0, edge: 0, block: 0, off: 0 }));
    const gt = { ok: 0, out: 0, hidden: 0, none: 0 };
    for (let t = 0; t < tl.t; t += dt) {
      const st = T.stateAt(tl, t);
      if (!st.seg.rec) continue;
      const boxes = T.boxes(st);
      env.links.forEach((L, i) => { if (!T.activeRx(st, i + 1)) cnt[i].off++; else cnt[i][G.linkStatus(L, boxes)]++; });
      if (test.gt) {
        if (!st.person) gt.none++;
        else gt[G.gtStatus(env.camera, [st.person.x, st.person.y, 1.0], boxes.filter(b => b.kind === 'furniture'))]++;
      }
    }
    return { cnt, gt: test.gt ? gt : null };
  };

  // ---- 경로 도우미 ----
  T.gridPoints = function (room) {
    const mx = Math.min(0.6, room.w * 0.2), my = Math.min(0.6, room.l * 0.2), xs = [mx, room.w / 2, room.w - mx], pts = [];
    for (let j = 0; j < 5; j++) {
      const y = my + (room.l - 2 * my) * j / 4, row = xs.map(x => [x, y]);
      if (j % 2) row.reverse();
      row.forEach(p => pts.push(p));
    }
    return pts;
  };
  function loop(room) {
    const m = Math.min(0.6, room.w * 0.2, room.l * 0.2);
    return [[m, m], [m, room.l - m], [room.w - m, room.l - m], [room.w - m, m], [m, m]];
  }
  function laps(lp, n) { const out = [lp[0]]; for (let k = 0; k < n; k++) lp.slice(1).forEach(p => out.push(p)); return out; }
  function loopLen(lp) { let d = 0; for (let i = 1; i < lp.length; i++) d += Math.hypot(lp[i][0] - lp[i - 1][0], lp[i][1] - lp[i - 1][1]); return d; }
  T.door = room => ({ inside: [S.doorX(room), room.l - 0.45], outside: [S.doorX(room), room.l + 0.6] });
  T.furnSpots = room => ({ a: [0.45, room.l * 0.66], b: [room.w * 0.42, room.l * 0.5] });   // a는 매트와 겹치지 않게 서쪽

  // ---- 테스트 목록 ----
  T.list = [
    {
      id: 'check', no: '0', name: '수집 경로 점검', who: 'ESP 1대 · 사람 없음', gt: false, ble: false,
      purpose: '수신기 1대에서 CSI와 Wi-Fi RSSI가 실제로 어떤 간격으로 기록되는지 먼저 확인한다. 6대로 늘리기 전에 한 대의 경로를 검증한다.',
      prep: ['송신 ESP와 수신기 RX1 한 대만 사용자 프로파일(csi_send / csi_recv 방식)로 전환', '펌웨어 버전·설정·채널·송신 간격을 고정하고 기록'],
      steps: ['송신 ESP 패킷 수신과 CSI 콜백 확인', '빈방 60초 기록', '로그로 실제 수집률·순번 누락·최대 공백 확인'],
      records: '수신기 1대의 CSI·패킷 RSSI 원시 로그. 수신기 로컬 시각, 순번, 큐 폐기 수, PC 도착 시각을 따로 남긴다.',
      notes: ['예제 <code>csi_recv</code>의 출력은 시리얼이다. 무선 업로드는 별도로 구현하고 이 점검을 다시 한다', '송신 간격 설정값을 CSI 수집률로 적지 않는다. 실제 로그에서 잰다', '공유기 패킷이 섞이지 않는지 송신원 MAC으로 확인'],
      build(env) {
        const tl = new TL(), o = { ble: false, rx: [1] };
        tl.add(30, Object.assign({ step: 0, label: '송신 ESP → RX1 수신 확인' }, o));
        tl.add(60, Object.assign({ rec: true, step: 1, label: '빈방 60초 기록 · RX1만' }, o));
        tl.add(30, Object.assign({ step: 2, label: '로그 확인 (수집률·누락)' }, o));
        return { tl };
      }
    },
    {
      id: 'empty', no: '1', name: '빈방 기준', who: '사람 없음 · 수신기 6대', gt: false, ble: true,
      purpose: '사람이 없을 때의 채널을 여러 번 기록해 기준으로 삼는다. 같은 날 앞뒤로 반복하면 시간에 따른 흔들림도 볼 수 있다.',
      prep: ['송신 ESP·수신기 6대 위치와 채널 기록', '문을 닫고 방 안의 물건 위치를 사진으로 남긴다'],
      steps: ['사람은 방 밖으로 나간다', '60초 기록', '20초 쉬고 반복 (3회)'],
      records: '수신기 6대 × 60초 × 3회. 수신기별 시각 오프셋·드리프트 확인에도 쓴다.',
      notes: ['사람이 문 밖 가까이 서 있어도 링크에 걸릴 수 있다. 기록 중 위치를 적어 둔다'],
      build(env) {
        const tl = new TL();
        for (let k = 0; k < 3; k++) {
          tl.add(60, { rec: true, step: 1, label: '빈방 기록 ' + (k + 1) + '/3' });
          if (k < 2) tl.add(20, { step: 2, label: '쉬기' });
        }
        return { tl };
      }
    },
    {
      id: 'static', no: '2', name: '정지 15점', who: '서기 · 수신기 6대', gt: true, ble: true,
      purpose: '사람이 서 있는 위치에 따라 링크 6개가 어떻게 달라지는지 위치 라벨과 함께 기록한다. 위치 인식 재현의 기본 자료.',
      prep: ['바닥에 15점(3 × 5)을 테이프로 표시하고 좌표를 실측', '카메라 화각 안인지 확인'],
      steps: ['표시한 점에 서서 60초 기록', '다음 점으로 걸어서 이동 (20초, 기록 안 함)'],
      records: '점마다 60초. 위치 라벨(점 번호·좌표)과 카메라 영상 시각을 함께 남긴다.',
      notes: ['점마다 몸 방향을 같게 유지하고 기록', '화각 밖인 점은 3D에서 빨간 번호로 표시된다'],
      build(env) {
        const tl = new TL(), pts = T.gridPoints(env.room), dr = T.door(env.room);
        tl.walk([dr.outside, dr.inside, pts[0]], 0.8, { step: 1, label: '1번 점으로' });
        pts.forEach((p, i) => {
          if (i > 0) tl.walk([pts[i - 1], p], 0.5, { step: 1, label: (i + 1) + '번 점으로 이동' });
          tl.add(60, { path: [p], pose: 'stand', rec: true, step: 0, label: (i + 1) + ' / 15번 점 기록' });
        });
        tl.walk([pts[pts.length - 1], dr.inside, dr.outside], 0.8, { step: 1, label: '퇴장' });
        return { tl, points: pts };
      }
    },
    {
      id: 'pose', no: '3', name: '자세 3종', who: '서기 · 앉기 · 눕기(매트)', gt: true, ble: true,
      purpose: '자세만 바꿔 기록해 행동·자세 라벨 자료를 만든다. 서기·앉기는 두 위치에서, 눕기는 정해 둔 매트(눕기 자리)에서만 기록한다.',
      prep: ['의자를 두 위치에 준비', '매트를 동쪽 벽 쪽 정해 둔 자리에 고정하고 좌표 실측', '송신 ESP를 매트 옆 낮은 자리(0.3 m)에 설치', '자세 바꾸는 순간을 카메라와 로그에 함께 표시'],
      steps: ['서기 60초', '앉기 60초', '다음 위치로 이동', '매트에서 눕기 60초 (2회)'],
      records: '위치 2곳 × 서기·앉기 × 60초 + 매트 눕기 60초 × 2회. 자세 전환 구간은 라벨을 따로 둔다.',
      notes: ['수신기가 모두 높아서 방 아무 데서나 누우면 링크와 거의 겹치지 않는다. 그래서 눕기는 자리를 정해 두고 송신 ESP를 그 옆에 낮게 둔다 (실제 생활의 침대·매트와 같은 조건)', '따라서 이 자료로 "방 어디서나 눕기 인식"을 주장하지 않는다', '눕기 상자는 y 방향으로 길다고 가정했다. 실제 방향을 기록한다'],
      build(env) {
        const tl = new TL(), R = env.room, dr = T.door(R), bed = S.bed(R);
        const spots = [[R.w * 0.42, R.l / 2], [R.w * 0.5, R.l * 0.28]], side = [bed.x - 0.6, bed.y];
        tl.walk([dr.outside, dr.inside, spots[0]], 0.8, { step: 2, label: '위치 1로' });
        spots.forEach((p, i) => {
          if (i > 0) tl.walk([spots[i - 1], p], 0.6, { step: 2, label: '위치 2로' });
          tl.add(60, { path: [p], pose: 'stand', rec: true, step: 0, label: '위치 ' + (i + 1) + ' · 서기' });
          tl.add(8, { path: [p], pose: 'sit', step: 1, label: '앉는 중' });
          tl.add(60, { path: [p], pose: 'sit', rec: true, step: 1, label: '위치 ' + (i + 1) + ' · 앉기' });
          tl.add(6, { path: [p], pose: 'stand', step: 2, label: '일어나기' });
        });
        tl.walk([spots[1], side], 0.6, { step: 3, label: '매트로' });
        for (let k = 0; k < 2; k++) {
          tl.add(10, { path: [[bed.x, bed.y]], pose: 'lie', step: 3, label: '눕는 중' });
          tl.add(60, { path: [[bed.x, bed.y]], pose: 'lie', rec: true, step: 3, label: '매트 눕기 ' + (k + 1) + '/2' });
          tl.add(10, { path: [side], pose: 'stand', step: 3, label: '일어나기' });
        }
        tl.walk([side, dr.inside, dr.outside], 0.8, { step: 3, label: '퇴장' });
        return { tl, points: spots, poseSpots: true };
      }
    },
    {
      id: 'walk', no: '4', name: '걷기 경로', who: '걷기 약 0.8 m/s', gt: true, ble: true,
      purpose: '같은 사각 경로를 반복해 걸으며 이동 중의 링크 변화를 기록한다. 위치 추적·행동 인식 재현 자료.',
      prep: ['벽에서 0.6 m 안쪽 사각 경로를 바닥 테이프로 표시'],
      steps: ['출발점 10초 정지', '시계 방향 5바퀴', '돌아서 반시계 방향 5바퀴', '도착 10초 정지'],
      records: '약 3분 연속. 바퀴마다 같은 경로라 반복 간 편차도 볼 수 있다.',
      notes: ['걸음 속도를 일정하게 (메트로놈 등)', '팔 흔들기·걸음은 계산에 없다. 몸은 서기 상자로 옮긴다'],
      build(env) {
        const tl = new TL(), lp = loop(env.room), ll = loopLen(lp), rev = lp.slice().reverse(), dr = T.door(env.room);
        tl.walk([dr.outside, dr.inside, lp[0]], 0.8, { step: 0, label: '출발점으로' });
        tl.add(10, { path: [lp[0]], pose: 'stand', rec: true, step: 0, label: '출발점 정지' });
        tl.walk(laps(lp, 5), 0.8, { rec: true, step: 1, label: '시계 방향', lapLen: ll, laps: 5 });
        tl.add(4, { path: [lp[0]], pose: 'stand', rec: true, step: 2, label: '돌아서기' });
        tl.walk(laps(rev, 5), 0.8, { rec: true, step: 2, label: '반시계 방향', lapLen: ll, laps: 5 });
        tl.add(10, { path: [lp[0]], pose: 'stand', rec: true, step: 3, label: '도착 정지' });
        tl.walk([lp[0], dr.inside, dr.outside], 0.8, { step: 3, label: '퇴장' });
        return { tl, loop: lp };
      }
    },
    {
      id: 'occupancy', no: '5', name: '입·퇴실', who: '빈방 ↔ 재실', gt: true, ble: true,
      purpose: '빈방 → 들어옴 → 머묾 → 나감을 이어서 기록해 재실 라벨 자료를 만든다.',
      prep: ['문 위치를 실측해 기록 (그림: 북쪽 벽 동쪽 끝)', '들어오고 나가는 시각을 카메라와 로그에 표시'],
      steps: ['빈방 30초', '들어와서 자리로 걸어감', '앉아서 60초', '나감', '3회 반복'],
      records: '연속 기록. 재실 여부 라벨을 초 단위로 둔다.',
      notes: ['문 여닫이 자체도 링크를 바꿀 수 있다. 문 상태를 따로 라벨로 남긴다'],
      build(env) {
        const tl = new TL(), R = env.room, dr = T.door(R), seat = [R.w * 0.35, R.l * 0.4];
        for (let k = 0; k < 3; k++) {
          tl.add(30, { rec: true, step: 0, label: '빈방 ' + (k + 1) + '/3' });
          tl.walk([dr.outside, dr.inside, seat], 0.8, { rec: true, step: 1, label: '들어옴' });
          tl.add(60, { path: [seat], pose: 'sit', rec: true, step: 2, label: '앉아 있음' });
          tl.walk([seat, dr.inside, dr.outside], 0.8, { rec: true, step: 3, label: '나감' });
        }
        tl.add(30, { rec: true, step: 0, label: '빈방 마무리' });
        return { tl, points: [seat] };
      }
    },
    {
      id: 'change', no: '6', name: '환경 변화 후 재수집', who: '가구 이동 → 1·2·4번 일부 반복', gt: true, ble: true, furn: true,
      purpose: '방의 물건 배치를 바꾼 뒤 같은 절차로 다시 기록한다. 기존 방법이 환경 변화 뒤 어디서 틀리는지 진단할 자료다.',
      prep: ['옮길 물건과 전후 위치를 정하고 실측·사진 기록', '바꾸기 전 기록(1·2·4번)을 먼저 확보'],
      steps: ['물건을 옮긴다 (기록 안 함)', '빈방 60초', '정지 5점 × 60초', '걷기 2바퀴씩 양방향'],
      records: '변화 전 기록과 같은 절차·라벨. 무엇을 어디로 옮겼는지 함께 남긴다.',
      notes: ['변화 전후 결과를 비교하는 것 자체를 연구 기여로 삼지 않는다. 오류가 생기는 과정을 찾는 진단 자료다', '가구는 링크 판정에만 넣었고 합성 신호 계산에는 넣지 않았다'],
      build(env) {
        const tl = new TL(), R = env.room, f = T.furnSpots(R), dr = T.door(R), pts = T.gridPoints(R), lp = loop(R), ll = loopLen(lp);
        const five = [pts[0], pts[4], pts[7], pts[10], pts[14]], o = { furn: f.b };
        tl.walk([dr.outside, dr.inside, [f.a[0] - 0.55, f.a[1]]], 0.8, { furn: f.a, step: 0, label: '물건 앞으로' });
        tl.add(20, { path: [[f.a[0] - 0.55, f.a[1]]], pose: 'stand', furn: f.a, furnTo: f.b, carry: true, step: 0, label: '물건 옮기기' });
        tl.walk([[f.b[0] - 0.55, f.b[1]], dr.inside, dr.outside], 0.8, Object.assign({ step: 0, label: '퇴장' }, o));
        tl.add(60, Object.assign({ rec: true, step: 1, label: '변화 후 빈방' }, o));
        tl.walk([dr.outside, dr.inside, five[0]], 0.8, Object.assign({ step: 2, label: '1번 점으로' }, o));
        five.forEach((p, i) => {
          if (i > 0) tl.walk([five[i - 1], p], 0.5, Object.assign({ step: 2, label: '다음 점으로' }, o));
          tl.add(60, Object.assign({ path: [p], pose: 'stand', rec: true, step: 2, label: '정지 ' + (i + 1) + ' / 5' }, o));
        });
        tl.walk([five[4], lp[0]], 0.8, Object.assign({ step: 3, label: '출발점으로' }, o));
        tl.walk(laps(lp, 2), 0.8, Object.assign({ rec: true, step: 3, label: '시계 방향', lapLen: ll, laps: 2 }, o));
        tl.walk(laps(lp.slice().reverse(), 2), 0.8, Object.assign({ rec: true, step: 3, label: '반시계 방향', lapLen: ll, laps: 2 }, o));
        tl.walk([lp[0], dr.inside, dr.outside], 0.8, Object.assign({ step: 3, label: '퇴장' }, o));
        return { tl, points: five, loop: lp, furnFrom: f.a };
      }
    }
  ];

  T.run = function (test, env) {
    const r = test.build(env);
    r.total = r.tl.t; r.recTotal = r.tl.recT;
    r.stats = T.stats(r, env, test);
    return r;
  };
})(window.WSIM);
