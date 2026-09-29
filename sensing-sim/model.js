// 합성 채널 모델. research/room_simulation_2026-09-29/interactive_3d/model.js 를 그대로 옮김 (Python simulate.py와 대조 검증된 계산).
/* Original scalar geometry/channel implementation, matching ../simulate.py.
   Coordinates are [x, y, height], metres. No measured data or radio emulation. */
const SensingModel = (() => {
  'use strict';
  const C=299792458, F=2437000000, BINS=Array.from({length:52},(_,i)=>i<26?i-26:i-25);
  const BODY={standing:[.45,.30,1.70],seated:[.50,.50,1.10],lying:[.50,1.70,.35]};
  const PARAMS={nominal:{wall:-.35,floor:-.25,ceiling:-.15,loss:20,rcs:.05},weak:{wall:-.15,floor:-.10,ceiling:-.08,loss:10,rcs:.01},strong:{wall:-.60,floor:-.40,ceiling:-.30,loss:30,rcs:.15}};
  const sub=(a,b)=>a.map((v,i)=>v-b[i]), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), norm=a=>Math.hypot(...a), dist=(a,b)=>norm(sub(a,b));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function solve(a,b) {
    const n=b.length,m=a.map((r,i)=>[...r,b[i]]);
    for(let k=0;k<n;k++) {
      let best=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[best][k]))best=i;
      [m[k],m[best]]=[m[best],m[k]];const d=m[k][k];
      if(Math.abs(d)<1e-15)throw Error('Singular geometry');
      for(let j=k;j<=n;j++)m[k][j]/=d;
      for(let i=0;i<n;i++)if(i!==k){const q=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=q*m[k][j];}
    }
    return m.map(r=>r[n]);
  }
  function fresnel(tx,rx) {
    const d=sub(rx,tx),L=norm(d);if(L<.05)throw Error('송수신기 사이에 5 cm 이상 간격이 필요합니다.');
    const u=d.map(v=>v/L),a=(L+C/F/2)/2,b2=a*a-L*L/4,mid=tx.map((v,i)=>(v+rx[i])/2);
    const Q=u.map((v,i)=>u.map((w,j)=>(i===j?1/b2:0)+(1/a/a-1/b2)*v*w));
    const states=[];
    for(let s0=-1;s0<=1;s0++)for(let s1=-1;s1<=1;s1++)for(let s2=-1;s2<=1;s2++) {
      const st=[s0,s1,s2],free=[0,1,2].filter(j=>st[j]===0),fixed=[0,1,2].filter(j=>st[j]!==0);
      const coeff=fixed.map(j=>free.length?solve(free.map(i=>free.map(k=>Q[i][k])),free.map(i=>-Q[i][j])):[]);
      states.push({st,free,fixed,coeff});
    }
    return {tx,rx,L,a,b:Math.sqrt(b2),mid,Q,states};
  }
  function minimum(link,lo,hi) {
    const l=sub(lo,link.mid),h=sub(hi,link.mid);let best=Infinity;
    for(const {st,free,fixed,coeff} of link.states){
      const p=[0,0,0];fixed.forEach(j=>p[j]=st[j]<0?l[j]:h[j]);
      free.forEach((j,k)=>p[j]=fixed.reduce((s,f,i)=>s+coeff[i][k]*p[f],0));
      if(p.some((v,j)=>v<l[j]-1e-10||v>h[j]+1e-10))continue;
      const val=p.reduce((s,v,i)=>s+v*dot(link.Q[i],p),0);best=Math.min(best,val);
    }
    return best;
  }
  function box(xy,size){const lo=[xy[0]-size[0]/2,xy[1]-size[1]/2,0];return [lo,lo.map((v,i)=>v+size[i])];}
  function chord(a,b,lo,hi) {
    const v=sub(b,a);let near=0,far=1;
    for(let j=0;j<3;j++){
      if(Math.abs(v[j])<1e-12){if(a[j]<lo[j]||a[j]>hi[j])return 0;}
      else {const p=(lo[j]-a[j])/v[j],q=(hi[j]-a[j])/v[j];near=Math.max(near,Math.min(p,q));far=Math.min(far,Math.max(p,q));}
    }
    return Math.max(far-near,0)*norm(v);
  }
  function route(s) {
    const [w,d]=s.room,sz=BODY[s.pose];
    const safe=p=>[clamp(p[0],sz[0]/2+.06,w-sz[0]/2-.06),clamp(p[1],sz[1]/2+.06,d-sz[1]/2-.06)];
    if(s.scenario==='still')return [[w/2,d/2],[w/2,d/2]];
    if(s.scenario==='across')return [[.65/3.11*w,d/2],[2.46/3.11*w,d/2],[.65/3.11*w,d/2]].map(safe);
    if(s.scenario==='along')return [[w/2,.90/4.69*d],[w/2,3.80/4.69*d],[w/2,.90/4.69*d]].map(safe);
    return [[.65,.90],[.65,3.80],[2.46,3.80],[2.46,.90],[.65,.90]].map(p=>safe([p[0]/3.11*w,p[1]/4.69*d]));
  }
  function position(s,t) {
    const ps=route(s),lengths=ps.slice(1).map((p,i)=>dist(p,ps[i]));
    let left=clamp((t-2)/16,0,1)*lengths.reduce((a,b)=>a+b,0);
    for(let i=0;i<lengths.length;i++){if(left<=lengths[i]||i===lengths.length-1){const a=lengths[i]?left/lengths[i]:0;return ps[i].map((v,j)=>v+(ps[i+1][j]-v)*a);}left-=lengths[i];}
    return ps[0];
  }
  function paths(tx,rx,room,p) {
    const rays=[{length:dist(tx,rx),gamma:1,segments:[[tx,rx]]}];
    for(let axis=0;axis<3;axis++)for(const bound of [0,1]){
      const wall=bound?room[axis]:0,img=[...tx];img[axis]=2*wall-tx[axis];
      const t=(wall-img[axis])/(rx[axis]-img[axis]),hit=img.map((v,j)=>v+t*(rx[j]-v));
      rays.push({length:dist(tx,hit)+dist(hit,rx),gamma:axis<2?p.wall:(bound?p.ceiling:p.floor),segments:[[tx,hit],[hit,rx]]});
    }
    return rays;
  }
  function prepare(tx,rx,room,freqs,p) {
    return rx.map(r=>{
      const rays=paths(tx,r,room,p).map(ray=>({...ray,re:freqs.map(f=>ray.gamma*C/f/(4*Math.PI*ray.length)*Math.cos(-2*Math.PI*f*ray.length/C)),im:freqs.map(f=>ray.gamma*C/f/(4*Math.PI*ray.length)*Math.sin(-2*Math.PI*f*ray.length/C))}));
      const er=freqs.map((_,k)=>rays.reduce((a,r)=>a+r.re[k],0)),ei=freqs.map((_,k)=>rays.reduce((a,r)=>a+r.im[k],0));
      return {tx,rx:r,rays,er,ei,empty:er.map((v,k)=>v*v+ei[k]*ei[k]),freqs,p};
    });
  }
  function sample(pre,xy,size) {
    const [lo,hi]=box(xy,size),body=[...xy,size[2]/2],d1=dist(body,pre.tx),d2=dist(body,pre.rx);
    if(Math.min(d1,d2)<.25)throw Error('대상 중심이 송수신기에 25 cm보다 가깝습니다. 장비 위치를 바꿔 주세요.');
    const gains=pre.rays.map(ray=>10**(-pre.p.loss*ray.segments.reduce((a,[u,v])=>a+chord(u,v,lo,hi),0)/20));
    const re=[],im=[],power=[],amp=[];
    pre.freqs.forEach((f,k)=>{
      const mag=C/f*Math.sqrt(pre.p.rcs)/((4*Math.PI)**1.5*d1*d2),ph=-2*Math.PI*f*(d1+d2)/C;
      re[k]=pre.rays.reduce((v,ray,j)=>v+gains[j]*ray.re[k],0)+mag*Math.cos(ph);
      im[k]=pre.rays.reduce((v,ray,j)=>v+gains[j]*ray.im[k],0)+mag*Math.sin(ph);
      power[k]=re[k]*re[k]+im[k]*im[k];amp[k]=10*Math.log10(Math.max(power[k],1e-30)/Math.max(pre.empty[k],1e-30));
    });
    return {re,im,power,amp,delta:10*Math.log10(Math.max(power.reduce((a,b)=>a+b,0),1e-30)/Math.max(pre.empty.reduce((a,b)=>a+b,0),1e-30))};
  }
  function heatmap(s,step=.08) {
    const links=s.receivers.map(rx=>fresnel(s.ap,rx)),size=BODY[s.pose],cells=[];let valid=0,zero=0,multi=0;
    for(let y=step/2;y<s.room[1];y+=step)for(let x=step/2;x<s.room[0];x+=step){
      const [lo,hi]=box([x,y],size);if(lo.some(v=>v< -1e-9)||hi.some((v,j)=>v>s.room[j]+1e-9))continue;
      const count=links.reduce((n,l)=>n+(minimum(l,lo,hi)<=1+1e-10?1:0),0);cells.push([x,y,count]);valid++;if(!count)zero++;if(count>=2)multi++;
    }
    return {cells,step,valid,zero:zero/valid*100,multi:multi/valid*100};
  }
  function signals(s) {
    const p=PARAMS[s.parameters],size=BODY[s.pose],freqs=BINS.map(k=>F+k*312500),bf=[2402000000,2426000000,2480000000];
    const pre=prepare(s.ap,s.receivers,s.room,freqs,p),bp=prepare(s.ble,s.receivers,s.room,bf,p);
    const wifi=s.receivers.map(()=>new Float64Array(1001)),csi=s.receivers.map(()=>BINS.map(()=>new Float64Array(1001))),ble=s.receivers.map(()=>bf.map(()=>new Float64Array(201)));
    for(let n=0;n<=1000;n++){
      const xy=position(s,n/50);
      pre.forEach((r,j)=>{const v=sample(r,xy,size);wifi[j][n]=v.delta;for(let k=0;k<52;k++)csi[j][k][n]=v.amp[k];});
      if(s.bleEnabled&&n%5===0)bp.forEach((r,j)=>{const v=sample(r,xy,size);for(let k=0;k<3;k++)ble[j][k][n/5]=v.amp[k];});
    }
    return {wifi,csi,ble};
  }
  function snapshot(s,t=5){const f=BINS.map(k=>F+k*312500);return prepare(s.ap,s.receivers,s.room,f,PARAMS[s.parameters]).map(p=>sample(p,position(s,t),BODY[s.pose]));}
  function validate(s) {
    if(!s||s.version!==1)throw Error('이 시뮬레이터의 배치 JSON 파일이 필요합니다.');
    if(!Array.isArray(s.room)||s.room.length!==3||s.room.some(v=>!Number.isFinite(v))||s.room[0]<1.8||s.room[0]>12||s.room[1]<1.8||s.room[1]>12||s.room[2]<2||s.room[2]>5)throw Error('방 크기 범위: 가로·세로 1.8–12 m, 높이 2–5 m입니다.');
    if(!Array.isArray(s.receivers)||s.receivers.length!==6)throw Error('수신기는 6대여야 합니다.');
    for(const p of [s.ap,s.ble,...s.receivers])if(!Array.isArray(p)||p.length!==3||p.some((v,i)=>!Number.isFinite(v)||v<.05||v>s.room[i]-.05))throw Error('장비 좌표는 방 안쪽 5 cm 이상에 있어야 합니다.');
    for(const rx of s.receivers)if(dist(s.ap,rx)<.10||dist(s.ble,rx)<.10)throw Error('송수신기 사이에 10 cm 이상 간격을 두세요.');
    if(!BODY[s.pose]||!PARAMS[s.parameters]||!['walk','still','across','along'].includes(s.scenario)||typeof s.bleEnabled!=='boolean')throw Error('지원하지 않는 대상·실험·모델 설정입니다.');
    return s;
  }
  return {C,F,BINS,BODY,PARAMS,sub,dot,norm,dist,clamp,box,chord,fresnel,minimum,route,position,prepare,sample,heatmap,signals,snapshot,validate};
})();

window.WSIM = window.WSIM || {}; window.WSIM.model = SensingModel;
