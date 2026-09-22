'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const names = ['圆形', '三角形'];
  const pct = value => `${(value * 100).toFixed(1)}%`;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let session = new FlyLearning.LearningSession(0), training = false, stopRequested = false;
  let tests = [], demos = [], current = null, demo = null, demoBusy = false;
  let token = '', lastFrame = -1, noticeTimer;

  function notice(message) {
    $('notice').textContent = message; $('notice').hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 7000);
  }
  function demoActive() { return demo && !demo.finished; }
  function controls() {
    const locked = training || demoActive() || demoBusy;
    ['one', 'hundred', 'sixHundred', 'resetLearning', 'seed', 'evaluate'].forEach(id => $(id).disabled = !!locked);
    if(session.history.length >= FlyLearning.MAX_ROUNDS) {
      ['one', 'hundred', 'sixHundred'].forEach(id => $(id).disabled = true);
    }
    $('stop').disabled = !training;
    $('demo').disabled = training || demoBusy || !!(demoActive() && demo.status !== 'paused');
    $('pauseDemo').disabled = demoBusy || !demoActive() || demo.status !== 'running';
    $('resumeDemo').disabled = demoBusy || !demoActive() || demo.status !== 'paused';
    $('endDemo').disabled = demoBusy || !demoActive();
  }
  function showTrial(trial, mode) {
    current = trial;
    const ctx = $('stimulus').getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 320, 320);
    const colors = [[50,109,168],[39,128,108],[120,87,158]];
    const color = colors[trial.image.color];
    trial.image.pixels.forEach((v,i) => {
      if(v) { ctx.fillStyle = `rgba(${color.join(',')},${v})`; ctx.fillRect(i%32*10, Math.floor(i/32)*10, 10, 10); }
    });
    $('trialLabel').textContent = mode === 'train' ? `训练第 ${trial.round} 轮` : mode === 'demo' ? 'L3 演示 · 冻结策略' : '训练前预览';
    trial.slots.forEach((label,i) => {
      const probability = label === 1 ? trial.probability : 1-trial.probability;
      $(`choice${i}`).classList.toggle('selected', label === trial.action);
      $(`symbol${i}`).className = `shape ${label===0?'circle':'triangle'}`;
      $(`name${i}`).textContent = names[label];
      $(`chosen${i}`).textContent = label === trial.action ? '已选择' : '';
      $(`prob${i}`).value = probability;
      $(`probText${i}`).textContent = `选择概率 ${pct(probability)} · ${i===0?'左侧':'右侧'}区域`;
    });
    $('reward').className = 'reward';
    if(mode === 'train') {
      $('reward').classList.add(trial.reward ? 'correct' : 'wrong');
      $('reward').textContent = trial.reward ? `+1 奖励 · 选对了${names[trial.label]}，已更新选择策略。` : `0 奖励 · 图片是${names[trial.label]}，本次选错，已更新选择策略。`;
    } else if(mode === 'demo') {
      $('reward').textContent = `策略选择${names[trial.action]} · 识别${trial.action===trial.label?'正确':'错误'}。本轮不更新学习参数，到达状态见下方。`;
    } else $('reward').textContent = '尚未给奖励。点击「训练 1 轮」，查看一次完整反馈。';
  }
  function renderStats() {
    const rows=session.history, recent=rows.slice(-50);
    $('rounds').textContent=`${rows.length} 轮`; $('totalReward').textContent=session.rewards;
    $('recent').textContent=recent.length?pct(recent.reduce((s,r)=>s+r.reward,0)/recent.length):'—';
    $('trainingStatus').textContent=training?'正在训练':rows.length?'已停止 · 可继续':'尚未训练';
    $('records').replaceChildren();
    if(!rows.length) {
      const tr=document.createElement('tr'), td=document.createElement('td');
      td.colSpan=5; td.textContent='还没有训练记录。'; tr.append(td); $('records').append(tr);
    }
    for(const row of rows.slice(-12).reverse()) {
      const tr=document.createElement('tr');
      [row.round,names[row.label],names[row.action],pct(row.action===1?row.probability:1-row.probability),row.reward?'+1 · 正确':'0 · 错误'].forEach((v,i)=>{
        const td=document.createElement('td'); td.textContent=v;
        if(i===4) td.className=row.reward?'good':'bad'; tr.append(td);
      }); $('records').append(tr);
    }
    drawCurve(); controls();
  }
  function drawCurve() {
    const ctx=$('learningCurve').getContext('2d'), w=1100,h=250;
    const left=55, right=1070, top=15, bottom=215, max=Math.max(100,session.history.length);
    const x=n=>left+n/max*(right-left), y=v=>bottom-v*(bottom-top);
    ctx.clearRect(0,0,w,h); ctx.font='12px sans-serif';
    for(const value of [0,.25,.5,.75,1]) {
      ctx.strokeStyle='#e5ebf1'; ctx.beginPath(); ctx.moveTo(left,y(value));ctx.lineTo(right,y(value));ctx.stroke();
      ctx.fillStyle='#617386';ctx.fillText(`${value*100}%`,10,y(value)+4);
    }
    ctx.fillText('0',left,bottom+23);ctx.textAlign='right';ctx.fillText(`${max} 轮`,right,bottom+23);ctx.textAlign='left';
    let sum=0; ctx.beginPath();ctx.strokeStyle='#326da8';ctx.lineWidth=2;
    session.history.forEach((row,i)=>{
      sum+=row.reward;if(i>=50) sum-=session.history[i-50].reward;
      const yy=y(sum/Math.min(i+1,50)); if(i===0)ctx.moveTo(x(i+1),yy);else ctx.lineTo(x(i+1),yy);
    });ctx.stroke();
    tests.forEach(result=>{ctx.fillStyle='#27806c';ctx.beginPath();ctx.arc(x(result.round),y(result.accuracy),5,0,Math.PI*2);ctx.fill();});
    const last=tests.at(-1);
    $('curveSummary').textContent=`训练前测试 ${pct(tests[0].accuracy)}（${tests[0].correct}/200）；最近测试 ${pct(last.accuracy)}，在第 ${last.round} 轮完成。`;
  }
  function evaluate() {
    const result={...session.evaluate(200),round:session.history.length};tests.push(result);
    $('testScore').textContent=pct(result.accuracy);
    $('testDetail').textContent=`${result.correct}/200 正确 · 第 ${result.round} 轮；圆形 ${result.confusion[0][0]}/100，三角形 ${result.confusion[1][1]}/100`;
    drawCurve();return result;
  }
  async function train(count) {
    if(training||demoActive())return;
    training=true;stopRequested=false;controls();
    try {
      for(let i=0;i<count && !stopRequested && session.history.length<FlyLearning.MAX_ROUNDS;i++) {
        showTrial(session.step(),'train');
        if(i%5===0 || i===count-1){renderStats();await delay(count===1?0:16);}
      }
    } catch(error){notice(error.message);}
    finally {training=false;renderStats();}
  }
  async function saveRecord(content, format) {
    $('exportJSON').disabled=true;$('exportCSV').disabled=true;
    $('exportResult').hidden=false;$('exportLink').hidden=true;
    $('exportMessage').textContent='正在保存到本地项目…';
    try {
      await getState();
      const response=await fetch('/api/learning/export',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':token},body:JSON.stringify({format,content}),signal:AbortSignal.timeout(15000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'保存失败');
      $('exportMessage').textContent=`已保存：${result.path}`;
      $('exportLink').href=result.url;$('exportLink').download='';$('exportLink').hidden=false;
      $('exportLink').textContent=`下载 ${format.toUpperCase()} 记录`;
    } catch(error){$('exportMessage').textContent=`导出失败：${error.message}`;notice(error.message);}
    finally {$('exportJSON').disabled=false;$('exportCSV').disabled=false;}
  }
  async function getState() {
    const response=await fetch('/api/state?after=999999',{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error(`本地服务返回 ${response.status}，请确认工作台已启动`);
    const state=await response.json();token=state.token;return state;
  }
  async function command(data) {
    const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':token},body:JSON.stringify(data),signal:AbortSignal.timeout(8000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败');return result.command_id;
  }
  async function acknowledged(id, target, expectedRunId=null) {
    const deadline=Date.now()+180000;
    while(Date.now()<deadline) {
      const state=await getState();
      if(state.status==='error')throw new Error(state.message);
      if(expectedRunId && state.run_id!==expectedRunId) throw new Error('L3 实验已改变，请新建演示');
      if(state.ack_id>=id && !state.pending) {
        if(!expectedRunId && state.ack_id!==id) throw new Error('L3 操作已被其他页面覆盖，请新建演示');
        if(state.config.mode!=='auto'||JSON.stringify(state.config.targets)!==JSON.stringify([target])) throw new Error('L3 场景被其他页面修改，请重新创建演示');
        return state;
      }
      await delay(400);
    }
    throw new Error('等待物理初始化超时，请到 L3 工作台检查状态');
  }
  function matches(state, record) {
    return FlyLearning.demoMatches(state,record);
  }
  function drawArena(state=null) {
    const ctx=$('arena').getContext('2d');ctx.clearRect(0,0,400,230);
    ctx.font='12px sans-serif';ctx.fillStyle='#617386';ctx.textAlign='center';
    if(!demo) {ctx.fillText('这里显示选项区域与果蝇轨迹',200,110);ctx.textAlign='left';return;}
    const xy=(x,y)=>[200-y*9,190-x*6];
    demo.trial.slots.forEach((label,i)=>{
      const [x,y]=xy(18,i===0?10:-10);ctx.fillStyle=label===demo.trial.action?'#e1eefb':'#edf1f5';
      ctx.strokeStyle=label===demo.trial.action?'#326da8':'#c7d3df';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(x,y,35,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#20354e';ctx.fillText(names[label],x,y+4);ctx.fillStyle='#617386';ctx.fillText(i===0?'左侧选项':'右侧选项',x,y-46);
    });
    ctx.strokeStyle='#326da8';ctx.lineWidth=2;ctx.beginPath();demo.path.forEach((p,i)=>{const q=xy(p.x,p.y);if(i===0)ctx.moveTo(...q);else ctx.lineTo(...q);});ctx.stroke();
    const pos=state?.sample||demo.path.at(-1)||{x:0,y:0};const [x,y]=xy(pos.x,pos.y);
    ctx.fillStyle='#20354e';ctx.beginPath();ctx.ellipse(x,y,4,8,0,0,Math.PI*2);ctx.fill();ctx.fillText('果蝇',x,y+22);ctx.textAlign='left';
  }
  function physicalFeedback(state,record) {
    if(state.frame_version!==lastFrame && state.sample) {
      $('physicsFrame').src=`/api/frame?v=${state.frame_version}`;lastFrame=state.frame_version;
      $('physicsFrame').hidden=false;$('physicsEmpty').hidden=true;
    }
    if(state.sample) {
      if(!record.path.length||state.sample.t>record.path.at(-1).t) record.path.push({t:state.sample.t,x:state.sample.x,y:state.sample.y});
      $('physicsTime').textContent=`仿真 ${state.sample.t.toFixed(2)} s · 距离 ${state.sample.distance_mm.toFixed(1)} mm`;
    }
    drawArena(state);
  }
  async function monitor(record) {
    try {
      while(demo===record && !record.finished) {
        await delay(500);
        if(demo!==record||record.finished)break;
        if(demoBusy)continue;
        const state=await getState();
        if(!FlyLearning.demoCanApply(demo,record,demoBusy))continue;
        if(!matches(state,record))throw new Error('共享 L3 场景已改变，本次演示已结束；可新建演示');
        if(state.status==='error')throw new Error(state.message);
        physicalFeedback(state,record);
        if(state.arrived) {
          if(state.status==='running') {
            demoBusy=true;controls();
            try { await command({op:'pause',expected_run_id:record.runId}); }
            finally { demoBusy=false; }
          }
          if(!FlyLearning.demoCanApply(demo,record,demoBusy))continue;
          record.finished=true;record.status='arrived';record.arrived=true;
          $('demoStatus').textContent=`已到达${names[record.trial.action]}区域。识别${record.trial.action===record.trial.label?'正确':'错误'}；距离 ${state.sample.distance_mm.toFixed(1)} mm。学习参数保持不变。`;
        } else if(state.status==='completed') {
          record.finished=true;record.status='timeout';record.arrived=false;
          $('demoStatus').textContent='已到达 10 秒仿真时限，身体尚未到达选项区域。识别结果单独保留，可在 L3 工作台查看。';
        } else {
          record.status=state.status;
          $('demoStatus').textContent=state.status==='paused'?'已暂停，可以继续行走或结束演示。':`已选择${names[record.trial.action]}，身体正在前往对应区域。识别${record.trial.action===record.trial.label?'正确':'错误'}，等待到达反馈。`;
        }
        controls();
      }
    } catch(error) {if(demo===record && !record.finished){record.finished=true;record.status='error';record.error=error.message;$('demoStatus').textContent=error.message;notice(error.message);controls();}}
  }
  async function startDemo() {
    if(training||demoBusy)return;
    if(demoActive()){demo.finished=true;demo.status='replaced';}
    demoBusy=true;controls();
    const trial=session.preview();showTrial(trial,'demo');
    const record={trial,trainedRounds:session.history.length,runId:null,status:'initializing',finished:false,arrived:null,path:[]};
    demos.push(record);demo=record;drawArena();lastFrame=-1;
    $('physicsFrame').hidden=true;$('physicsEmpty').hidden=false;$('physicsTime').textContent='正在初始化';
    $('physicsEmpty').textContent='正在构建身体并标定转向，首次运行需要几十秒。';
    $('demoStatus').textContent='正在新建 L3 场景，完成初始化后自动开始行走。';
    try {
      await getState();
      const id=await command({op:'reset',config:{targets:[trial.target],spawn:[0,0,0],mode:'auto',noise:.1,seed:session.seed,duration:10}});
      const state=await acknowledged(id,trial.target);record.runId=state.run_id;
      physicalFeedback(state,record);
      const startId=await command({op:'start',expected_run_id:record.runId});await acknowledged(startId,trial.target,record.runId);
      record.status='running';monitor(record);
    } catch(error) {record.finished=true;record.status='error';record.error=error.message;$('demoStatus').textContent=error.message;notice(error.message);}
    finally {demoBusy=false;controls();}
  }
  async function controlDemo(op,end=false) {
    if(!demoActive()||demoBusy)return;
    const record=demo;demoBusy=true;controls();
    try {
      const state=await getState();if(!matches(state,record))throw new Error('L3 场景已改变，请新建演示');
      const id=await command({op,expected_run_id:record.runId});await acknowledged(id,record.trial.target,record.runId);
      if(end){record.finished=true;record.status='stopped';$('demoStatus').textContent='演示已结束，物理仿真已暂停。可以继续训练。';}
      else record.status=op==='pause'?'paused':'running';
    } catch(error) {record.finished=true;record.status='error';record.error=error.message;notice(error.message);$('demoStatus').textContent=error.message;}
    finally {demoBusy=false;controls();}
  }
  $('one').onclick=()=>train(1);$('hundred').onclick=()=>train(100);$('sixHundred').onclick=()=>train(600);
  $('stop').onclick=()=>{stopRequested=true;};$('evaluate').onclick=evaluate;
  $('resetLearning').onclick=()=>{
    try {
      if(!$('seed').value.trim())throw new Error('请输入随机种子');
      const next=new FlyLearning.LearningSession(Number($('seed').value));
      session=next;tests=[];demos=[];demo=null;
      evaluate();showTrial(session.preview(),'preview');renderStats();drawArena();
      $('demoStatus').textContent='新学习实验已开始，L3 不会自动运行。';$('physicsFrame').hidden=true;$('physicsEmpty').hidden=false;
      $('physicsEmpty').textContent='点击「新建 L3 演示」连接物理仿真。';$('physicsTime').textContent='尚未运行';
    } catch(error){notice(error.message);}
  };
  $('exportJSON').onclick=()=>saveRecord(JSON.stringify({...session.snapshot(),tests,demos,note:'简化像素奖励学习。训练结果不代表生物果蝇识字。'},null,2),'json');
  $('exportCSV').onclick=()=>{
    const rows=['round,label,action,reward,probability_triangle,image_seed,left_option,right_option'];
    session.history.forEach(r=>rows.push([r.round,r.label,r.action,r.reward,r.probability,r.imageSeed,...r.slots].join(',')));
    saveRecord(rows.join('\n'),'csv');
  };
  $('demo').onclick=startDemo;$('pauseDemo').onclick=()=>controlDemo('pause');$('resumeDemo').onclick=()=>controlDemo('start');$('endDemo').onclick=()=>controlDemo('pause',true);
  $('physicsFrame').onerror=()=>{$('physicsFrame').hidden=true;$('physicsEmpty').hidden=false;$('physicsEmpty').textContent='当前帧暂不可用，正在等待下一帧。';};
  evaluate();showTrial(session.preview(),'preview');renderStats();drawArena();
})();
