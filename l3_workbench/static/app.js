'use strict';
const $ = id => document.getElementById(id);
const defaults = {targets:[[25,0],[25,22]],spawn:[0,0,0],friction:1,adhesion:40,seed:0,duration:10,mode:'auto',manual:[0,0],base:1,gain:2.2,noise:0.1,occluded:false};
let draft = structuredClone(defaults), state = null, history = [], runId = null, token = '', initialized = false;
let frameVersion = -1, seenError = 0, connected = false, busy = false, sceneDirty = false, dragIndex = -1;
let toastTimer, liveTimer, livePatch = {}, lastDownload = '', frameLoading = false;
let requestChain = Promise.resolve();
let pendingLive = {}, liveRevision = 0, stagedPreset = false;
const statusNames = {idle:'尚未初始化',initializing:'初始化中',paused:'已暂停',running:'运行中',completed:'实验完成',exporting:'导出中',error:'需要处理'};
const colors = {ink:'#24354b',muted:'#7e8da0',line:'#e5ebf1',blue:'#247ea3',orange:'#db8550',truth:'#8c99a8'};

function toast(message, error=false) {
  clearTimeout(toastTimer); $('toast').textContent=message; $('toast').className=error?'error':'';
  $('toast').hidden=false; toastTimer=setTimeout(()=>{$('toast').hidden=true;},error?7000:3500);
}
function api(command) {
  const task=async()=>{
    const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':token},body:JSON.stringify(command)});
    const result=await response.json(); if(!response.ok)throw new Error(result.error || '操作未成功'); return result;
  };
  const result=requestChain.then(task); requestChain=result.catch(()=>{}); return result;
}
async function action(command) {
  try {await flushLive(); await api(command);}
  catch(error){toast(error.message,true);}
}
function queueLive(patch) {
  Object.assign(draft,structuredClone(patch));
  if(stagedPreset)return;
  Object.assign(livePatch,patch);
  for(const [key,value] of Object.entries(patch))pendingLive[key]={value,commandId:null,revision:++liveRevision};
  clearTimeout(liveTimer);
  if(state && ['paused','running','completed'].includes(state.status)) {
    liveTimer=setTimeout(()=>flushLive().catch(e=>toast(e.message,true)),180);
  }
}
async function flushLive() {
  clearTimeout(liveTimer);
  if(!Object.keys(livePatch).length)return;
  if(!state || !['paused','running','completed'].includes(state.status))return;
  const patch=livePatch; livePatch={};
  const revisions=Object.fromEntries(Object.keys(patch).map(key=>[key,pendingLive[key]?.revision]));
  try {
    const result=await api({op:'update',config:patch});
    for(const key of Object.keys(patch))if(pendingLive[key]?.revision===revisions[key])pendingLive[key].commandId=result.command_id;
  } catch(error){
    for(const key of Object.keys(patch))if(pendingLive[key]?.revision===revisions[key])delete pendingLive[key];
    throw error;
  }
}
function setSceneDirty() {sceneDirty=true;$('sceneDirty').hidden=false;}
function updateOutputs() {
  for(const id of ['spawnAngle','friction','adhesion','base','gain','noise','left','right']){
    $(id+'Out').textContent=Number($(id).value).toFixed(['spawnAngle','adhesion'].includes(id)?0:2);
  }
}
function setModeUI() {
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===draft.mode);b.setAttribute('aria-pressed',String(b.dataset.mode===draft.mode));});
  $('autoControls').hidden=draft.mode==='manual';$('manualControls').hidden=draft.mode!=='manual';
  $('modeHint').textContent=draft.mode==='auto'?'根据内部航向估计，依次前往目标点。':'分别控制左右三条腿的步幅与前后方向。';
}
function fillConfig() {
  const values={spawnX:draft.spawn[0],spawnY:draft.spawn[1],spawnAngle:draft.spawn[2],left:draft.manual[0],right:draft.manual[1]};
  for(const key of ['friction','adhesion','seed','duration','base','gain','noise'])values[key]=draft[key];
  for(const [id,value] of Object.entries(values))$(id).value=value;
  $('occluded').checked=draft.occluded;updateOutputs();setModeUI();renderTargets();drawAll();
}
function readScene() {
  for(const id of ['spawnX','spawnY','duration','seed'])if(!$(id).reportValidity())throw new Error('请检查场景参数的范围');
  draft.spawn=[Number($('spawnX').value),Number($('spawnY').value),Number($('spawnAngle').value)];
  for(const key of ['friction','adhesion','duration','seed'])draft[key]=Number($(key).value);
  return structuredClone(draft);
}
function renderTargets() {
  const existing=[...$('targets').querySelectorAll('input')];
  const desired=draft.targets.flat();
  if(existing.length===desired.length&&existing.every((input,i)=>Number(input.value)===desired[i]))return;
  $('targets').replaceChildren();
  draft.targets.forEach((point,index)=>{
    const row=document.createElement('div');row.className='target-row';
    const label=document.createElement('span');label.textContent='T'+(index+1);row.append(label);
    point.forEach((value,axis)=>{
      const input=document.createElement('input');input.type='number';input.min=-70;input.max=70;input.step=1;input.value=value;
      input.setAttribute('aria-label',`目标 ${index+1} ${axis===0?'x':'y'} 坐标`);
      input.addEventListener('input',()=>{
        if(!input.validity.valid||input.value==='')return;
        draft.targets[index][axis]=Number(input.value);queueLive({targets:structuredClone(draft.targets)});drawMap();
      });
      input.addEventListener('change',()=>{if(!input.reportValidity()||input.value==='')input.value=draft.targets[index][axis];});
      row.append(input);
    });
    const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label',`删除目标 ${index+1}`);remove.disabled=draft.targets.length===1;
    remove.addEventListener('click',()=>{draft.targets.splice(index,1);queueLive({targets:structuredClone(draft.targets)});renderTargets();drawMap();});row.append(remove);$('targets').append(row);
  });
  $('addTarget').disabled=draft.targets.length>=8;
}
function addTarget(point) {
  if(draft.targets.length>=8){toast('最多支持 8 个目标点');return;}
  draft.targets.push(point);queueLive({targets:structuredClone(draft.targets)});renderTargets();drawMap();
}
function canvasContext(id) {
  const canvas=$(id),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  const w=Math.round(rect.width),h=Math.round(rect.height);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.font='10px -apple-system, sans-serif';
  return {ctx,w,h};
}
let mapBounds={minX:-20,maxX:50,minY:-20,maxY:50};
function mapTransform(w,h) {
  // Freeze the viewport during dragging to keep pointer-to-world coordinates stable.
  if(dragIndex<0){
    const points=[...draft.targets,draft.spawn.slice(0,2),...history.filter((_,i)=>i%10===0).map(s=>[s.x,s.y])];
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const span=Math.max(60,Math.max(...xs)-Math.min(...xs)+22,Math.max(...ys)-Math.min(...ys)+22);
    const cx=(Math.max(...xs)+Math.min(...xs))/2,cy=(Math.max(...ys)+Math.min(...ys))/2;
    mapBounds={minX:cx-span/2,maxX:cx+span/2,minY:cy-span/2,maxY:cy+span/2};
  }
  const pad=22,scale=Math.min((w-2*pad)/(mapBounds.maxX-mapBounds.minX),(h-2*pad)/(mapBounds.maxY-mapBounds.minY));
  const x0=(w-scale*(mapBounds.maxX-mapBounds.minX))/2,y0=(h-scale*(mapBounds.maxY-mapBounds.minY))/2;
  return {to:(x,y)=>[x0+(x-mapBounds.minX)*scale,y0+(mapBounds.maxY-y)*scale],from:(x,y)=>[mapBounds.minX+(x-x0)/scale,mapBounds.maxY-(y-y0)/scale]};
}
function drawMap() {
  const {ctx,w,h}=canvasContext('map'),m=mapTransform(w,h);ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=colors.line;ctx.lineWidth=1;ctx.fillStyle=colors.muted;ctx.font='8px -apple-system, sans-serif';
  for(let v=Math.ceil(Math.min(mapBounds.minX,mapBounds.minY)/10)*10;v<=Math.max(mapBounds.maxX,mapBounds.maxY);v+=10){
    if(v>=mapBounds.minX&&v<=mapBounds.maxX){const [x]=m.to(v,0);ctx.beginPath();ctx.moveTo(x,12);ctx.lineTo(x,h-18);ctx.stroke();ctx.fillText(v,x-5,h-5);}
    if(v>=mapBounds.minY&&v<=mapBounds.maxY){const [,y]=m.to(0,v);ctx.beginPath();ctx.moveTo(18,y);ctx.lineTo(w-12,y);ctx.stroke();ctx.fillText(v,2,y+3);}
  }
  if(history.length){ctx.strokeStyle=colors.blue;ctx.lineWidth=1.6;ctx.beginPath();history.forEach((s,i)=>{const [x,y]=m.to(s.x,s.y);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  const [sx,sy]=m.to(draft.spawn[0],draft.spawn[1]);ctx.strokeStyle='#98a7b6';ctx.strokeRect(sx-3,sy-3,6,6);
  draft.targets.forEach((point,i)=>{const [x,y]=m.to(...point);ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fillStyle=i===state?.sample?.goal_index?'#f8e4d6':'#fff';ctx.fill();ctx.strokeStyle=colors.orange;ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle='#bb693b';ctx.font='9px -apple-system, sans-serif';ctx.textAlign='center';ctx.fillText(i+1,x,y+3);ctx.textAlign='left';});
  if(state?.sample){const s=state.sample,[x,y]=m.to(s.x,s.y);ctx.save();ctx.translate(x,y);ctx.rotate(-s.yaw_deg*Math.PI/180);ctx.fillStyle=colors.navy||colors.ink;ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-5,-4);ctx.lineTo(-2,0);ctx.lineTo(-5,4);ctx.closePath();ctx.fill();ctx.restore();}
}
function plot(id,series,min,max) {
  const {ctx,w,h}=canvasContext(id),left=33,right=9,top=10,bottom=20,pw=w-left-right,ph=h-top-bottom;
  const end=Math.max(2,state?.sample?.t||0),start=Math.max(0,end-12);
  const px=t=>left+(t-start)/(end-start)*pw,py=v=>top+(max-v)/(max-min)*ph;
  const rows=history.filter(s=>s.t>=start);
  ctx.fillStyle='#fcf0ef';rows.forEach((s,i)=>{if(s.occluded){const next=rows[i+1]?.t??s.t+.01;ctx.fillRect(px(s.t),top,Math.max(1,px(next)-px(s.t)),ph);}});
  ctx.lineWidth=1;ctx.strokeStyle=colors.line;ctx.fillStyle=colors.muted;ctx.font='9px -apple-system, sans-serif';
  for(let i=0;i<5;i++){let v=min+(max-min)*i/4,y=py(v);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillText(Number.isInteger(v)?v:v.toFixed(1),0,y+3);}
  for(let i=0;i<5;i++){let t=start+(end-start)*i/4;ctx.fillText(t.toFixed(1)+'s',px(t)-9,h-3);}
  ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();
  series.forEach(({key,color})=>{ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.beginPath();let prev=null;rows.forEach(s=>{const x=px(s.t),y=py(s[key]);if(prev===null || (max===180&&Math.abs(s[key]-prev)>180))ctx.moveTo(x,y);else ctx.lineTo(x,y);prev=s[key];});ctx.stroke();});ctx.restore();
  if(!rows.length){ctx.fillStyle=colors.muted;ctx.textAlign='center';ctx.fillText('运行后显示真实反馈',w/2,h/2);ctx.textAlign='left';}
}
function drawRing() {
  const {ctx,w,h}=canvasContext('ring'),r=Math.min(w,h)*.34,cx=w/2,cy=h/2,values=state?.sample?.cx||Array(16).fill(0),max=Math.max(1,...values);
  ctx.strokeStyle='#e5ebf1';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);ctx.stroke();
  values.forEach((v,i)=>{const a=-i*2*Math.PI/16,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;ctx.beginPath();ctx.arc(x,y,4+3*v/max,0,2*Math.PI);ctx.fillStyle=`rgba(36,126,163,${.12+.88*v/max})`;ctx.fill();});
  const psi=(state?.sample?.psi_deg||0)*Math.PI/180;ctx.strokeStyle=colors.blue;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(psi)*r*.63,cy-Math.sin(psi)*r*.63);ctx.stroke();ctx.fillStyle=colors.muted;ctx.font='9px -apple-system, sans-serif';ctx.fillText('0°',cx+r+13,cy+3);ctx.fillText('90°',cx-8,cy-r-12);
}
function drawAll(){drawMap();drawRing();plot('headingChart',[{key:'yaw_deg',color:colors.truth},{key:'psi_deg',color:colors.blue},{key:'goal_deg',color:colors.orange}],-180,180);plot('signalChart',[{key:'left',color:colors.blue},{key:'right',color:colors.orange}],-1.5,1.5);}
const legNames=['左前','左中','左后','右前','右中','右后'];
for(const i of [0,3,1,4,2,5]){const div=document.createElement('div');div.className='leg';const label=document.createElement('span');label.textContent=legNames[i];const dot=document.createElement('i');dot.id='leg'+i;const meter=document.createElement('meter');meter.id='phase'+i;meter.min=0;meter.max=2*Math.PI;meter.value=0;meter.setAttribute('aria-label',legNames[i]+'腿步态相位');div.append(label,dot,meter);$('legs').append(div);}
function metric(id,value,unit){$(id).replaceChildren(document.createTextNode(value));const small=document.createElement('small');small.textContent=unit;$(id).append(small);}
function displayState() {
  const status=state.status,blocked=!connected||state.pending||['initializing','exporting'].includes(status)||busy;
  $('status').textContent=connected?(statusNames[status]||status):'连接断开';$('statusDot').dataset.state=connected?status:'error';$('statusMessage').textContent=connected?state.message:'请检查本地服务是否仍在运行';
  $('reset').disabled=blocked;$('start').disabled=blocked||status!=='paused';$('pause').disabled=blocked||status!=='running';$('step').disabled=blocked||status!=='paused';$('export').disabled=blocked||!['paused','completed'].includes(status);
  document.querySelectorAll('[data-view]').forEach(b=>{b.disabled=blocked||!state.sample;b.classList.toggle('selected',b.dataset.view===state.view);b.setAttribute('aria-pressed',String(b.dataset.view===state.view));});
  for(const el of document.querySelectorAll('.control-panel input,.control-panel button'))el.disabled=blocked||!state.sample;
  const s=state.sample;
  if(s){metric('timeValue',s.t.toFixed(2),'s');metric('speedValue',s.speed_mm_s.toFixed(1),'mm/s');metric('distanceValue',s.distance_mm.toFixed(1),'mm');metric('errorValue',s.error_deg.toFixed(1),'°');$('frameTime').textContent=`t = ${s.t.toFixed(2)} s`;
    $('psiValue').textContent=s.psi_deg.toFixed(1)+'°';$('rmse').textContent=`RMSE ${state.rmse_deg.toFixed(1)}°`;
    $('performance').textContent=`累计计算 ${state.active_wall.toFixed(1)} s · 仿真速度 ${state.speed_ratio.toFixed(2)}× · 路程 ${state.path_length.toFixed(1)} mm`;
    $('compassHint').textContent=s.occluded?'仅靠自运动积分':'视觉线索可用';
    $('feedback').textContent=state.arrived&&state.config.mode==='auto'?'已进入最终目标半径，运动信号已归零。':`正在前往 T${s.goal_index+1}。胸部高度 ${s.z.toFixed(2)} mm；当前 ${s.contacts.filter(Boolean).length} 条腿触地。`;
    if(state.config.mode==='manual')$('feedback').textContent=`手动控制中。胸部高度 ${s.z.toFixed(2)} mm；当前 ${s.contacts.filter(Boolean).length} 条腿触地。`;
    for(let i=0;i<6;i++){$('leg'+i).className=[s.contacts[i]?'contact':'',s.adhesion[i]?'adhesion':''].join(' ');$('phase'+i).value=s.phases[i];}
  }else{for(const [id,unit] of [['timeValue','s'],['speedValue','mm/s'],['distanceValue','mm'],['errorValue','°']])metric(id,'—',unit);}
  $('cameraLabel').textContent={follow:'跟随视角',top:'俯视',side:'侧视'}[state.view]||'跟随视角';$('runLabel').textContent=state.run_id?`实验 ${state.run_id}`:'正在准备实验';
  $('download').hidden=!state.export_url;if(state.export_url){$('download').href=state.export_url;$('download').download='';if(lastDownload!==state.export_url){lastDownload=state.export_url;toast('导出完成，点击「下载结果包」保存');}}
}
async function refreshFrame(version) {
  if(frameLoading)return;frameLoading=true;
  try{const response=await fetch('/api/frame?v='+version);if(!response.ok)return;const blob=await response.blob(),url=URL.createObjectURL(blob);const old=$('frame').src;$('frame').src=url;$('frame').hidden=false;$('emptyFrame').hidden=true;if(old.startsWith('blob:'))URL.revokeObjectURL(old);frameVersion=version;}
  catch(e){/* The status poll reports connection errors. */}finally{frameLoading=false;}
}
async function poll() {
  try{
    const after=history.length?history[history.length-1].t:-1;
    const response=await fetch('/api/state?after='+after);if(!response.ok)throw new Error('无法连接服务');
    const next=await response.json();token=next.token;connected=true;
    if(next.run_id!==runId){runId=next.run_id;history=[];frameVersion=-1;$('frame').hidden=true;$('emptyFrame').hidden=false;
      if(runId&&after>=0){const full=await (await fetch('/api/state')).json();next.history=full.history;}
    }
    if(!initialized&&next.config){draft=structuredClone(next.config);fillConfig();initialized=true;}
    else if(next.config){
      const synced=FlyConfigSync.reconcileConfig(draft,next.config,{pending:pendingLive,ackId:next.ack_id,sceneDirty,stagedPreset});
      pendingLive=synced.pending;
      if(JSON.stringify(draft)!==JSON.stringify(synced.draft)){draft=synced.draft;fillConfig();}
    }
    for(const row of next.history||[])if(!history.length||row.t>history[history.length-1].t)history.push(row);
    if(history.length>6001)history.splice(0,history.length-6001);
    state=next;displayState();drawAll();
    if(next.frame_version!==frameVersion&&next.sample)refreshFrame(next.frame_version);
    if(next.error_id>seenError){seenError=next.error_id;if(next.error)toast(next.error,true);}
  }catch(error){connected=false;if(state)displayState();else{$('status').textContent='连接断开';$('statusMessage').textContent='请先启动本地服务';}}
  setTimeout(poll,250);
}

$('start').addEventListener('click',()=>action({op:'start'}));$('pause').addEventListener('click',()=>action({op:'pause'}));$('step').addEventListener('click',()=>action({op:'step'}));$('export').addEventListener('click',()=>action({op:'export'}));
$('reset').addEventListener('click',async()=>{try{const config=readScene();busy=true;displayState();clearTimeout(liveTimer);livePatch={};await api({op:'reset',config});pendingLive={};stagedPreset=false;sceneDirty=false;$('sceneDirty').hidden=true;toast('正在重建场景，完成后可开始运行');}catch(e){toast(e.message,true);}finally{busy=false;}});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>action({op:'view',view:b.dataset.view})));
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{draft.mode=b.dataset.mode;setModeUI();queueLive({mode:draft.mode});}));
for(const id of ['base','gain','noise'])$(id).addEventListener('input',()=>{updateOutputs();queueLive({[id]:Number($(id).value)});});
for(const id of ['left','right'])$(id).addEventListener('input',()=>{updateOutputs();queueLive({manual:[Number($('left').value),Number($('right').value)]});});
$('occluded').addEventListener('change',()=>queueLive({occluded:$('occluded').checked}));
document.querySelectorAll('[data-drive]').forEach(b=>b.addEventListener('click',()=>{const sign=Math.sign(state?.turn_rate||1);const commands={forward:[1,1],left:[sign,-sign],right:[-sign,sign],stop:[0,0]};const manual=commands[b.dataset.drive];$('left').value=manual[0];$('right').value=manual[1];updateOutputs();queueLive({manual});}));
for(const id of ['spawnX','spawnY','spawnAngle','friction','adhesion','duration','seed'])$(id).addEventListener('input',()=>{updateOutputs();setSceneDirty();if($(id).validity.valid&&$(id).value!==''){if(id.startsWith('spawn')){const axis={spawnX:0,spawnY:1,spawnAngle:2}[id];draft.spawn[axis]=Number($(id).value);drawMap();}else draft[id]=Number($(id).value);}});
$('preset').addEventListener('change',()=>{draft=structuredClone(defaults);const preset=$('preset').value;if(preset==='straight')draft.targets=[[50,0]];if(preset==='noisy')draft.noise=.4;if(preset==='manual'){draft.mode='manual';draft.duration=20;}clearTimeout(liveTimer);livePatch={};pendingLive={};stagedPreset=true;fillConfig();setSceneDirty();toast('预设已载入，点击重置场景应用');});
$('addTarget').addEventListener('click',()=>{const last=draft.targets.at(-1);addTarget([Math.min(70,last[0]+10),Math.min(70,last[1]+10)]);});
function mapPointer(event){const rect=$('map').getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top,w:rect.width,h:rect.height};}
let pointerStart=null;
$('map').addEventListener('pointerdown',event=>{if(!connected||state?.pending||['initializing','exporting'].includes(state?.status))return;const p=mapPointer(event),m=mapTransform(p.w,p.h);dragIndex=draft.targets.findIndex(t=>{const [x,y]=m.to(...t);return Math.hypot(p.x-x,p.y-y)<15;});if(dragIndex>=0)pendingLive.targets={value:structuredClone(draft.targets),commandId:null,revision:++liveRevision};pointerStart=p;$('map').setPointerCapture(event.pointerId);});
$('map').addEventListener('pointermove',event=>{if(dragIndex<0)return;const p=mapPointer(event),point=mapTransform(p.w,p.h).from(p.x,p.y).map(v=>Math.round(Math.max(-70,Math.min(70,v))));draft.targets[dragIndex]=point;drawMap();});
$('map').addEventListener('pointerup',event=>{if(!pointerStart)return;const p=mapPointer(event);if(dragIndex>=0){dragIndex=-1;queueLive({targets:structuredClone(draft.targets)});renderTargets();drawMap();}else if(Math.hypot(p.x-pointerStart.x,p.y-pointerStart.y)<5){const point=mapTransform(p.w,p.h).from(p.x,p.y).map(v=>Math.round(Math.max(-70,Math.min(70,v))));addTarget(point);}pointerStart=null;});
$('map').addEventListener('pointercancel',()=>{dragIndex=-1;pointerStart=null;if(pendingLive.targets?.commandId===null)delete pendingLive.targets;renderTargets();drawMap();});
function downloadJSON(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('saveConfig').addEventListener('click',()=>{try{downloadJSON(readScene(),'l3-config.json');}catch(e){toast(e.message,true);}});
$('loadConfig').addEventListener('click',()=>$('configFile').click());
$('configFile').addEventListener('change',async()=>{try{const file=$('configFile').files[0];if(!file)return;if(file.size>16384)throw new Error('配置文件过大');const parsed=JSON.parse(await file.text()),config=parsed.initial_config||parsed;
  if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('配置格式无效');
  if(Object.keys(config).some(k=>!(k in defaults)))throw new Error('配置包含未知参数');
  const next={...structuredClone(defaults),...config};
  if(!Array.isArray(next.targets)||!next.targets.length||next.targets.length>8||!next.targets.every(t=>Array.isArray(t)&&t.length===2&&t.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=70)))throw new Error('目标坐标无效');
  if(!Array.isArray(next.spawn)||next.spawn.length!==3||!next.spawn.every(Number.isFinite)||!Array.isArray(next.manual)||next.manual.length!==2||!next.manual.every(Number.isFinite))throw new Error('出生位置或手动信号无效');
  if(!['auto','manual'].includes(next.mode)||typeof next.occluded!=='boolean')throw new Error('控制模式或遮挡参数无效');
  for(const key of ['friction','adhesion','seed','duration','base','gain','noise'])if(typeof next[key]!=='number'||!Number.isFinite(next[key]))throw new Error('参数必须是有限数值');
  const ranges={friction:[.1,3],adhesion:[0,80],seed:[0,2147483647],duration:[.1,60],base:[0,1.5],gain:[0,5],noise:[0,1]};
  for(const [key,[lo,hi]] of Object.entries(ranges))if(next[key]<lo||next[key]>hi)throw new Error(`${key} 必须在 ${lo} 到 ${hi} 之间`);
  if(!Number.isInteger(next.seed)||Math.abs(next.spawn[0])>60||Math.abs(next.spawn[1])>60||Math.abs(next.spawn[2])>180||next.manual.some(n=>Math.abs(n)>1.5))throw new Error('出生位置、随机种子或手动信号超出范围');
  draft=next;clearTimeout(liveTimer);livePatch={};pendingLive={};stagedPreset=true;fillConfig();setSceneDirty();toast('配置已载入，点击重置场景应用');
}catch(e){toast('导入失败：'+e.message,true);}finally{$('configFile').value='';}});
$('help').addEventListener('click',()=>$('helpDialog').showModal());$('closeHelp').addEventListener('click',()=>$('helpDialog').close());
new ResizeObserver(()=>drawAll()).observe(document.querySelector('.workbench'));
fillConfig();poll();
