// 화면 구성: 장비 목록, 1. 테스트 환경, 2. 테스트 시뮬레이션, 3. 장치 연결
(function (S) {
  const G = S.geom, T = S.tests, M = S.model, K = S.link;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const nf = n => Math.round(n).toLocaleString('ko-KR');
  const pct = x => Math.round(x * 100) + '%';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AIM_H = 1.0;   // 카메라가 겨누는 높이 (사람 몸 가운데 근사)
  const POSE_NAME = { stand: '서기', walk: '걷기', sit: '앉기', lie: '눕기' };
  const BODY_KEY = { stand: 'standing', walk: 'standing', sit: 'seated', lie: 'lying' };

  const q = new URLSearchParams(location.search);
  const st = {
    room: Object.assign({}, S.ROOM_DEFAULT), layout: S.LAYOUTS.some(l => l.id === q.get('layout')) ? q.get('layout') : 'F',
    charger: 'one', ble: true, fov: false, map: true, mapPose: 'stand', fresnel: 'sel', selRx: 1,
    test: Math.max(0, T.list.findIndex(t => t.id === q.get('test'))), t: 0, speed: 15, scrubbing: false, playing: !reduced, sigRx: 1
  };

  function makeEnv() {
    const lay = G.layout(st.room, st.layout);
    const env = { room: st.room, lay, links: G.makeLinks(lay.ap, lay.rx), camera: G.camera(st.room, AIM_H), ble: st.ble };
    const freqs = M.BINS.map(k => M.F + k * 312500);
    env.pre = M.prepare(G.P3(lay.ap), lay.rx.map(G.P3), [st.room.w, st.room.l, st.room.h], freqs, M.PARAMS.nominal);
    return env;
  }

  // ---- 장비 목록 ----
  function renderEquip() {
    $('equip-list').innerHTML = S.EQUIP.map(g =>
      '<div class="egroup"><div class="egroup-head"><h3>' + esc(g.title) + '</h3><span>' + esc(g.src || '') + '</span></div>' +
      g.items.map(it => '<div class="eitem"><b>' + esc(it.name) +
        (it.tag ? '<span class="pill ' + (it.tag === 'have' ? 'have' : it.tag === 'sug' ? 'sug' : '') + '">' + esc(it.tagText) + '</span>' : '') +
        '</b><span class="qty">' + esc(it.qty) + '</span>' + (it.det ? '<span class="det">' + esc(it.det) + '</span>' : '') + '</div>').join('') + '</div>').join('');
  }

  // ---- 장치 카드 ----
  function showDev(host, info, env) {
    let card = host.querySelector('.devcard');
    if (!info) { if (card) card.remove(); return; }
    const d = S.DEVICES[info.kind];
    if (!d) return;
    let title = { ap: '송신 ESP', router: '공유기 (업로드 통로)', ble: 'BLE 송신기', camera: '정답 카메라', desk: '기록 PC', charger: 'USB 충전기', person: '사람', furniture: '옮기는 물건' }[info.kind] || '';
    let extra = '';
    if (info.kind === 'rx') {
      title = '수신기 RX' + info.id;
      const r = env && env.lay.rx.find(x => x.id === info.id);
      if (r) extra = '<span class="mono small">x ' + r.x.toFixed(2) + ' · y ' + r.y.toFixed(2) + ' · z ' + r.z.toFixed(2) + ' m</span>';
    }
    if (info.kind === 'ap' && env) extra = '<span class="mono small">x ' + env.lay.ap.x.toFixed(2) + ' · y ' + env.lay.ap.y.toFixed(2) + ' · z ' + env.lay.ap.z.toFixed(2) + ' m</span>';
    if (!card) { card = document.createElement('div'); card.className = 'devcard'; host.appendChild(card); }
    card.innerHTML = '<h3>' + esc(title) + '</h3>' + extra + '<span class="role">' + esc(d.role) + '</span><ul>' + d.parts.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul><button type="button">닫기</button>';
    card.querySelector('button').addEventListener('click', () => card.remove());
  }
  function overlay(host, legendHtml, hint) {
    const lg = document.createElement('div'); lg.className = 'legend'; lg.innerHTML = legendHtml; host.appendChild(lg);
    const h = document.createElement('div'); h.className = 'hint'; h.textContent = hint; host.appendChild(h);
  }

  // ---- 1. 테스트 환경 ----
  let envNow = null, mapNow = null;
  const envView = S.createView($('env-view'), {
    onPick: info => {
      if (info && info.kind === 'rx') { st.selRx = info.id; $('sel-rx') && ($('sel-rx').value = info.id); drawOverlay(); }
      showDev($('env-view'), info, envNow);
    }
  });
  overlay($('env-view'),
    '<span><i class="sq" style="background:var(--block)"></i>겹침 0</span><span><i class="sq" style="background:var(--edge)"></i>1개</span><span><i class="sq" style="background:var(--ok)"></i>2개 이상</span><span><i style="background:var(--accent)"></i>프레넬 영역</span><span><i style="background:var(--block)"></i>케이블 3 m 초과</span>',
    '드래그 회전 · 휠 확대 · 수신기 클릭');

  function drawOverlay() {
    const fr = st.fresnel === 'all' ? [0, 1, 2, 3, 4, 5] : st.fresnel === 'sel' ? [st.selRx - 1] : [];
    envView.setOverlay({ map: st.map ? mapNow : null, fresnel: fr });
    renderEnvSide();
  }
  function buildEnv(keep) {
    envNow = makeEnv();
    const cables = G.cables(st.room, envNow.lay.rx, st.charger);
    envNow.cables = cables;
    envView.setEnv(envNow, { cables, chargers: G.chargers(st.room, st.charger), showFov: st.fov, fovH: AIM_H, keepCamera: keep });
    mapNow = G.overlapMap(st.room, envNow.lay, st.mapPose, 0.1);
    drawOverlay();
  }
  function renderEnvSide() {
    const E = envNow, R = st.room, lay = E.lay, cables = E.cables, m = mapNow;
    const ok = cables.filter(c => !c.over).length, maxLen = Math.max.apply(null, cables.map(c => c.len));
    const cam = E.camera, pts = T.gridPoints(R), seen = pts.filter(p => G.camSees(cam, [p[0], p[1], AIM_H])).length;
    const cover = G.polyArea(G.camCoverage(cam, AIM_H, R)) / (R.w * R.l);
    const row = (n, d, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + n + '</td><td>' + d.x.toFixed(2) + '</td><td>' + d.y.toFixed(2) + '</td><td>' + d.z.toFixed(2) + '</td></tr>';
    $('env-side').innerHTML =
      '<div class="blk"><h3>' + esc(lay.layout.name) + '</h3><span class="small">' + esc(lay.layout.note) + '</span>' +
      '<label class="field">프레넬 영역을 볼 수신기<select id="sel-rx">' + lay.rx.map(r => '<option value="' + r.id + '"' + (r.id === st.selRx ? ' selected' : '') + '>RX' + r.id + '</option>').join('') + '</select></label></div>' +
      '<div class="blk"><h3>좌표 (m)</h3><table><thead><tr><th>장치</th><th>x</th><th>y</th><th>z</th></tr></thead><tbody>' +
      row('송신 ESP', lay.ap) + lay.rx.map(r => row('RX' + r.id, r)).join('') + (st.ble ? row('BLE', lay.ble) : '') +
      '</tbody></table><span class="small">설치 후 안테나 중심을 실측해 바꿔 적는다. 공동 앵커를 쓰면 팀원 앵커 좌표와 같다.</span></div>' +
      '<div class="blk"><h3>바닥 겹침 지도 · ' + POSE_NAME[st.mapPose] + '</h3><dl class="kv"><dt>겹침 0개인 자리</dt><dd>' + m.zero.toFixed(1) + '%</dd><dt>2개 이상 겹치는 자리</dt><dd>' + m.multi.toFixed(1) + '%</dd><dt>계산한 자리</dt><dd>' + m.valid + '곳 · ' + (m.step * 100).toFixed(0) + ' cm 간격</dd></dl>' +
      '<span class="small">사람 상자와 링크의 제1 프레넬 영역이 겹치는지만 센 값이다. 감지 성공률이나 실제 사각지대가 아니다. 겹침 0개 자리에서도 반사파로 신호는 바뀐다.</span></div>' +
      '<div class="blk"><h3>USB 케이블 길이</h3><table><thead><tr><th>수신기</th><th>필요 길이</th><th>3 m</th></tr></thead><tbody>' +
      cables.map(c => '<tr><td>RX' + c.id + '</td><td>' + c.len.toFixed(1) + ' m</td><td class="' + (c.over ? 'bad' : 'good') + '">' + (c.over ? '부족' : '닿음') + '</td></tr>').join('') + '</tbody></table>' +
      (ok < cables.length ? '<span class="warnbox">3 m 케이블로 닿는 수신기 ' + ok + ' / ' + cables.length + '대. 가장 먼 수신기는 ' + maxLen.toFixed(1) + ' m가 필요하다. 공동 앵커의 전원 배치를 그대로 쓰면 이 계산은 필요 없다.</span>'
        : '<span class="small">6대 모두 3 m 케이블로 닿는다.</span>') + '</div>' +
      '<div class="blk"><h3>정답 카메라 화각</h3><dl class="kv"><dt>1.0 m 높이 중 보이는 면적</dt><dd>' + pct(cover) + '</dd><dt>정지 15점 중 화각 안</dt><dd>' + seen + ' / 15</dd></dl><span class="small">Camera Module 3 Wide 102° × 67°, 남서 모서리 가정. 공동 카메라의 실제 위치로 바꿔야 한다.</span></div>';
    $('sel-rx').addEventListener('change', e => { st.selRx = +e.target.value; drawOverlay(); });
  }

  function readRoom() {
    const v = k => { const el = $(k), x = parseFloat(el.value), lo = +el.min, hi = +el.max, y = isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo; el.value = y; return y; };
    st.room = { w: v('room-w'), l: v('room-l'), h: v('room-h') };
  }
  ['room-w', 'room-l', 'room-h'].forEach(id => $(id).addEventListener('change', () => { readRoom(); showDev($('env-view'), null); rebuildAll(false); }));
  $('layout').innerHTML = S.LAYOUTS.map(l => '<option value="' + l.id + '">' + esc(l.name) + '</option>').join('');
  $('layout').value = st.layout;
  $('layout').addEventListener('change', e => { st.layout = e.target.value; showDev($('env-view'), null); rebuildAll(true); });
  $('map-pose').addEventListener('change', e => { st.mapPose = e.target.value; mapNow = G.overlapMap(st.room, envNow.lay, st.mapPose, 0.1); drawOverlay(); });
  $('fresnel').addEventListener('change', e => { st.fresnel = e.target.value; drawOverlay(); });
  $('charger').addEventListener('change', e => { st.charger = e.target.value; buildEnv(true); });
  $('show-map').addEventListener('change', e => { st.map = e.target.checked; drawOverlay(); });
  $('show-ble').addEventListener('change', e => { st.ble = e.target.checked; rebuildAll(true); });
  $('show-fov').addEventListener('change', e => { st.fov = e.target.checked; buildEnv(true); });

  // ---- 2. 테스트 시뮬레이션 ----
  let run = null, tenv = null, lastUi = 0, wfRows = [];
  const testHost = $('test-view');
  const testView = S.createView(testHost, { onPick: info => { if (info && info.kind === 'rx') { st.sigRx = info.id; syncSigSel(); } showDev(testHost, info, tenv); }, onFrame });
  const hud = document.createElement('div'); hud.className = 'hud';
  hud.innerHTML = '<span class="rec" id="hud-rec"><i></i><span>기록 안 함</span></span><span class="now" id="hud-now"></span>';
  testHost.appendChild(hud);
  overlay(testHost, '<span><i style="background:var(--ok)"></i>LOS</span><span><i style="background:var(--edge)"></i>경계</span><span><i style="background:var(--block)"></i>가림</span><span><i style="background:var(--radio)"></i>BLE</span>', '드래그 회전 · 휠 확대 · 수신기 클릭');

  function renderTabs() {
    $('test-tabs').innerHTML = T.list.map((t, i) => '<button type="button" class="tab" role="tab" aria-selected="' + (i === st.test) + '" data-i="' + i + '"><span class="no">' + t.no + '</span>' + esc(t.name) + '</button>').join('');
    $('test-tabs').querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => selectTest(+b.dataset.i)));
  }
  function selectTest(i) {
    st.test = i; st.t = 0; wfRows = [];
    $('test-tabs').querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.i === i)));
    showDev(testHost, null);
    buildTest(!!run);
    renderTestSide(); renderTestInfo();
    if (!reduced) st.playing = true;
    playBtn();
  }
  function buildTest(keepCam) {
    const test = T.list[st.test];
    tenv = makeEnv(); tenv.ble = st.ble && test.ble;
    run = T.run(test, tenv);
    testView.setEnv(tenv, { showFov: false, keepCamera: keepCam });
    testView.setTest(run);
    st.t = Math.min(st.t, run.total);
    $('scrub').max = run.total.toFixed(1);
    renderStats();
  }
  function syncSigSel() { const s = $('sig-rx'); if (s) s.value = st.sigRx; wfRows = []; }

  function renderTestSide() {
    const test = T.list[st.test];
    $('test-side').innerHTML =
      '<div class="blk"><h3>' + test.no + '. ' + esc(test.name) + '</h3><span class="small">' + esc(test.who) + ' · <span id="tt-total"></span></span></div>' +
      '<div class="blk"><h3>진행 순서</h3><ol class="steps" id="tt-steps">' + test.steps.map((s, i) => '<li data-i="' + i + '">' + esc(s) + '</li>').join('') + '</ol></div>' +
      '<div class="blk"><h3>지금</h3><dl class="kv"><dt>경과</dt><dd id="lv-t"></dd><dt>기록한 시간</dt><dd id="lv-rec"></dd><dt>사람</dt><dd id="lv-p"></dd><dt>Wi-Fi 합성 표본 (가정 50 Hz)</dt><dd id="lv-wifi"></dd><dt>정답 카메라</dt><dd id="lv-gt"></dd></dl><div class="chips" id="lv-chips"></div></div>' +
      '<div class="blk"><h3>합성 신호 · 빈방 대비 전력 변화</h3><div class="bars" id="lv-sig"></div>' +
      '<label class="field">CSI 시간 그림 수신기<select id="sig-rx">' + [1, 2, 3, 4, 5, 6].map(i => '<option value="' + i + '"' + (i === st.sigRx ? ' selected' : '') + '>RX' + i + '</option>').join('') + '</select></label>' +
      '<canvas class="wf" id="wf" width="52" height="120" aria-label="선택한 수신기의 52개 주파수 빈 진폭 변화, 위가 최근"></canvas>' +
      '<div class="wfscale"><span>빈 −26</span><span>−8 dB <i></i> +8 dB</span><span>+26</span></div>' +
      '<span class="small">합성 값이다. 위쪽이 최근, 화면 갱신마다 한 줄. 실제 ESP CSI·RSSI가 아니다.</span></div>' +
      '<div class="blk"><h3>기록 구간 전체 · 수신기별 링크</h3><div class="bars" id="tt-bars"></div><span class="small" id="tt-gt"></span></div>';
    $('sig-rx').addEventListener('change', e => { st.sigRx = +e.target.value; wfRows = []; });
    renderStats();
  }
  function renderStats() {
    if (!$('tt-bars') || !run) return;
    $('tt-total').textContent = '총 ' + fmt(run.total) + ', 기록 ' + fmt(run.recTotal);
    const s = run.stats;
    $('tt-bars').innerHTML = tenv.lay.rx.map((r, i) => {
      const c = s.cnt[i], n = Math.max(1, c.los + c.edge + c.block + c.off);
      if (c.off === n) return '<div class="bar"><span>RX' + r.id + '</span><span class="track"></span><span class="v">사용 안 함</span></div>';
      return '<div class="bar"><span>RX' + r.id + '</span><span class="track"><i style="width:' + (c.los / n * 100) + '%;background:var(--ok)"></i><i style="width:' + (c.edge / n * 100) + '%;background:var(--edge)"></i><i style="width:' + (c.block / n * 100) + '%;background:var(--block)"></i></span><span class="v">' + (c.block ? '가림 ' + pct(c.block / n) : c.edge ? '경계 ' + pct(c.edge / n) : 'LOS') + '</span></div>';
    }).join('');
    const g = s.gt;
    if (g) {
      const n = Math.max(1, g.ok + g.out + g.hidden);
      $('tt-gt').textContent = '사람이 있는 기록 시간 중 카메라에 보임 ' + pct(g.ok / n) + ' · 화각 밖 ' + pct(g.out / n) + (g.hidden ? ' · 물건에 가림 ' + pct(g.hidden / n) : '');
    } else $('tt-gt').textContent = '이 테스트는 사람이 없어 카메라 정답을 쓰지 않는다.';
  }
  function renderTestInfo() {
    const t = T.list[st.test];
    $('test-info').innerHTML =
      '<div class="card"><h3>목적</h3><p>' + esc(t.purpose) + '</p></div>' +
      '<div class="card"><h3>준비</h3><ul>' + t.prep.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul></div>' +
      '<div class="card"><h3>기록되는 것</h3><p>' + esc(t.records) + '</p></div>' +
      '<div class="card"><h3>주의·확인</h3><ul>' + t.notes.map(p => '<li>' + p + '</li>').join('') + '</ul></div>';
  }

  function onFrame(dt, now) {
    if (!run) return;
    if (st.playing && !st.scrubbing) {
      st.t += dt * st.speed;
      if (st.t >= run.total) { st.t = run.total; st.playing = false; playBtn(); }
    }
    const s = T.stateAt(run.tl, st.t), boxes = T.boxes(s);
    const status = tenv.links.map((L, i) => T.activeRx(s, i + 1) ? G.linkStatus(L, boxes) : 'off');
    testView.applyState(s, status, now);
    if (now - lastUi > 0.1) { lastUi = now; live(s, status, boxes); }
  }
  function signal(s) {
    // 사람 한 명에 대한 합성 신호. 가구는 넣지 않는다. 송수신기에 25 cm보다 가까우면 계산하지 않는다.
    if (!s.person) return { delta: tenv.pre.map(() => 0), amp: tenv.pre.map(() => M.BINS.map(() => 0)) };
    const R = st.room, p = s.person;
    if (p.x < 0 || p.y < 0 || p.x > R.w || p.y > R.l) return { outside: true };
    try {
      const size = M.BODY[BODY_KEY[p.pose]], out = tenv.pre.map(pr => M.sample(pr, [p.x, p.y], size));
      return { delta: out.map(o => o.delta), amp: out.map(o => o.amp) };
    } catch (e) { return { err: e.message }; }
  }
  function live(s, status) {
    const test = T.list[st.test];
    const rec = $('hud-rec');
    rec.classList.toggle('on', s.seg.rec);
    rec.lastChild.textContent = s.seg.rec ? '기록 중' + (s.seg.rx === 'all' ? ' · 수신기 6대' : ' · RX' + s.seg.rx.join(',')) : '기록 안 함';
    $('hud-now').textContent = s.label;
    if (!st.scrubbing) $('scrub').value = st.t.toFixed(1);
    $('time').textContent = fmt(st.t) + ' / ' + fmt(run.total);
    if (!$('lv-t')) return;
    const nAct = status.filter(x => x !== 'off').length;
    $('lv-t').textContent = fmt(st.t);
    $('lv-rec').textContent = fmt(s.recT);
    $('lv-p').textContent = s.person ? POSE_NAME[s.person.pose] + ' · ' + s.person.x.toFixed(1) + ', ' + s.person.y.toFixed(1) : '없음 (방 밖)';
    $('lv-wifi').textContent = nf(s.recT * S.RATES.wifiHz * nAct);
    let gt = '안 씀';
    if (test.gt) gt = !s.person ? '사람 없음' : { ok: '보임', out: '화각 밖', hidden: '가림' }[G.gtStatus(tenv.camera, [s.person.x, s.person.y, 1.0], T.boxes(s).filter(b => b.kind === 'furniture'))];
    $('lv-gt').textContent = gt;
    $('tt-steps').querySelectorAll('li').forEach(li => li.classList.toggle('cur', +li.dataset.i === s.seg.step));
    const word = { los: 'LOS', edge: '경계', block: '가림', off: '끔' };
    $('lv-chips').innerHTML = tenv.lay.rx.map((r, i) => '<span class="chip ' + status[i] + '">RX' + r.id + ' ' + word[status[i]] + '</span>').join('');
    const sig = signal(s), host = $('lv-sig');
    if (sig.err || sig.outside) { host.innerHTML = '<span class="small">' + esc(sig.err || '사람이 방 밖에 있다 (계산하지 않음).') + '</span>'; return; }
    host.innerHTML = tenv.lay.rx.map((r, i) => {
      if (status[i] === 'off') return '<div class="sig"><span>RX' + r.id + '</span><span class="track"></span><span class="v">끔</span></div>';
      const v = sig.delta[i], w = Math.min(50, Math.abs(v) / 6 * 50);
      const bar = v >= 0 ? 'left:50%;width:' + w + '%;background:var(--sig-pos)' : 'left:' + (50 - w) + '%;width:' + w + '%;background:var(--sig-neg)';
      return '<div class="sig"><span>RX' + r.id + '</span><span class="track"><i style="' + bar + '"></i></span><span class="v">' + (v >= 0 ? '+' : '') + v.toFixed(2) + ' dB</span></div>';
    }).join('');
    if (st.playing && status[st.sigRx - 1] !== 'off') { wfRows.unshift(sig.amp[st.sigRx - 1]); if (wfRows.length > 120) wfRows.length = 120; }
    drawWf();
  }
  const cssRgb = n => { const c = new THREE.Color(S.three.tok(n)); return [c.r * 255, c.g * 255, c.b * 255]; };
  function drawWf() {
    const cv = $('wf'); if (!cv) return;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(52, 120);
    const neg = cssRgb('--sig-neg'), pos = cssRgb('--sig-pos'), mid = cssRgb('--scene');
    for (let y = 0; y < 120; y++) for (let k = 0; k < 52; k++) {
      const row = wfRows[y], o = (y * 52 + k) * 4;
      let c = mid;
      if (row) { const u = Math.max(-1, Math.min(1, row[k] / 8)), e = u < 0 ? neg : pos, a = Math.abs(u); c = [mid[0] + (e[0] - mid[0]) * a, mid[1] + (e[1] - mid[1]) * a, mid[2] + (e[2] - mid[2]) * a]; }
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function playBtn() { $('play').textContent = st.playing ? '일시정지' : '재생'; }
  $('play').addEventListener('click', () => { if (!st.playing && run && st.t >= run.total - 0.01) st.t = 0; st.playing = !st.playing; playBtn(); });
  $('restart').addEventListener('click', () => { st.t = 0; wfRows = []; });
  $('speed').addEventListener('change', e => { st.speed = +e.target.value; });
  const scrub = $('scrub');
  scrub.addEventListener('pointerdown', () => { st.scrubbing = true; });
  window.addEventListener('pointerup', () => { st.scrubbing = false; });
  scrub.addEventListener('input', () => { st.t = +scrub.value; });

  // ---- 3. 장치 연결 ----
  const linkHost = $('link-view');
  const linkView = K.createView(linkHost, { onPick: info => showDev(linkHost, info, envNow) });
  const lg = document.createElement('div'); lg.className = 'link-legend';
  lg.innerHTML = K.GROUPS.filter(g => g.edges.length).map(g => '<button type="button" aria-pressed="true" data-g="' + g.id + '"><i style="background:var(' + g.col + ')"></i>' + esc(g.name) + '</button>').join('');
  linkHost.appendChild(lg);
  lg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on));
    linkView.hidden[b.dataset.g] = !on; linkView.highlight(linkView.cur);
  }));
  const lh = document.createElement('div'); lh.className = 'hint'; lh.textContent = '드래그 회전 · 휠 확대 · 표의 줄을 누르면 강조'; linkHost.appendChild(lh);
  function renderLinkSide() {
    $('link-side').innerHTML = '<div class="blk"><h3>연결 목록</h3><table class="ltab"><thead><tr><th>경로</th><th>상태</th></tr></thead><tbody>' +
      K.GROUPS.map(g => '<tr data-g="' + g.id + '"' + (linkView.cur === g.id ? ' class="cur"' : '') + '><td><span class="sw" style="background:var(' + g.col + ')"></span><b>' + esc(g.name) + '</b><br><span class="small">' + esc(g.det) + '</span></td><td class="st ' + g.state + '">' + esc(g.stateText) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="blk"><h3>수신기 1대의 구성</h3><span class="small">공동 앵커 보드 그대로: ESP32-S3 + DWM3000EVB(점퍼 연결 유지, 사용 안 함) + USB 전원. 사용자 실험 때만 ESP 펌웨어를 CSI 수신 프로파일로 바꾸고, 끝나면 팀원 프로파일로 복원한다. 추가 배선은 없다.</span></div>' +
      '<div class="blk"><h3>기록에 꼭 남길 것</h3><span class="small">수신기 ID · 송신원 ID · 측정 종류(CSI / Wi-Fi RSSI / BLE RSSI) · 수신기 로컬 시각 · 순번 · 큐 폐기 수 · PC 도착 시각 · 펌웨어 버전과 설정.</span></div>';
    $('link-side').querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => {
      const g = tr.dataset.g; linkView.highlight(linkView.cur === g ? null : g); renderLinkSide();
    }));
  }

  // ---- 공통 ----
  function rebuildAll(keep) { buildEnv(keep); buildTest(keep); renderTestSide(); }
  function retheme() { buildEnv(true); buildTest(true); linkView.build(); }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  renderEquip();
  buildEnv(false);
  renderTabs();
  selectTest(st.test);
  renderLinkSide();
  window.WSIM_READY = true;
})(window.WSIM);
