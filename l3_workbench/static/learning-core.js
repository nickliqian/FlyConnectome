/* Pixel-only contextual bandit. No target labels enter Policy or encode. */
(function (root) {
  'use strict';
  const SIZE = 32, MAX_ROUNDS = 10000;
  class RNG {
    constructor(seed) { this.state = seed >>> 0; }
    next() {
      this.state = (this.state + 0x6D2B79F5) >>> 0;
      let t = this.state;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }
  function makeImage(rng, label) {
    const imageSeed = rng.state;
    const radius = 7 + rng.next() * 4;
    const cx = 12 + rng.next() * 8, cy = 12 + rng.next() * 8;
    const brightness = .55 + rng.next() * .45;
    const color = Math.floor(rng.next() * 3);
    const pixels = Array.from({length: SIZE * SIZE}, (_, i) => {
      const x = i % SIZE + .5 - cx, y = Math.floor(i / SIZE) + .5 - cy;
      const inside = label === 0 ? x*x+y*y <= radius*radius :
        y >= -radius && y <= radius && Math.abs(x) <= (y+radius)/2;
      return inside ? brightness : 0;
    });
    return {pixels, color, imageSeed};
  }
  function encode(pixels) {
    if (!Array.isArray(pixels) || pixels.length !== SIZE*SIZE ||
        !pixels.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
      throw new Error('图片必须是 32×32 的有效像素');
    }
    let minX=SIZE, minY=SIZE, maxX=-1, maxY=-1;
    pixels.forEach((v,i) => {
      if(v > .1) {
        const x=i%SIZE,y=Math.floor(i/SIZE);
        minX=Math.min(minX,x); maxX=Math.max(maxX,x);
        minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      }
    });
    const cells=Array(64).fill(0), counts=Array(64).fill(0);
    for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {
      const xx=Math.min(7,Math.floor((x-minX)*8/(maxX-minX+1)));
      const yy=Math.min(7,Math.floor((y-minY)*8/(maxY-minY+1)));
      const j=yy*8+xx; counts[j]++; cells[j]+=pixels[y*SIZE+x]>.1?1:0;
    }
    return cells.map((v,i)=>(counts[i]?v/counts[i]:0)-.5).concat(1);
  }
  class Policy {
    constructor() { this.weights=Array(65).fill(0); }
    probability(features) {
      const z=features.reduce((sum,v,i)=>sum+v*this.weights[i],0);
      return 1/(1+Math.exp(-Math.max(-16,Math.min(16,z))));
    }
    update(features,action,reward) {
      const p=this.probability(features);
      const delta=.12*(reward-.5)*(action-p);
      this.weights=this.weights.map((w,i)=>w+delta*features[i]);
    }
  }
  class LearningSession {
    constructor(seed=0) {
      if(!Number.isInteger(seed)||seed<0||seed>2147483647) throw new Error('种子必须是 0–2147483647 的整数');
      this.seed=seed; this.policy=new Policy(); this.history=[];
      this.trainRng=new RNG(seed); this.demoRng=new RNG((seed^0x85EBCA6B)>>>0);
      this.rewards=0;
    }
    step() {
      if(this.history.length>=MAX_ROUNDS) throw new Error('已达到 10000 轮上限，请导出后重置');
      const label=this.history.length%2;
      const image=makeImage(this.trainRng,label), features=encode(image.pixels);
      const p=this.policy.probability(features);
      const action=this.trainRng.next()<p?1:0;
      const slots=this.trainRng.next()<.5?[0,1]:[1,0];
      // Only the selected action's scalar reward crosses the learning boundary.
      const reward=action===label?1:0;
      this.policy.update(features,action,reward); this.rewards+=reward;
      const row={round:this.history.length+1,label,action,reward,probability:p,
        imageSeed:image.imageSeed,slots};
      this.history.push(row);
      return {...row,image};
    }
    evaluate(count=200) {
      if(!Number.isInteger(count)||count<1||count>200) throw new Error('测试样本数必须是 1–200');
      const rng=new RNG((this.seed^0x9E3779B9)>>>0);
      const confusion=[[0,0],[0,0]]; let correct=0;
      for(let i=0;i<count;i++) {
        const label=i%2, image=makeImage(rng,label);
        const action=this.policy.probability(encode(image.pixels))>.5?1:0;
        confusion[label][action]++; correct+=Number(action===label);
      }
      return {count,correct,accuracy:correct/count,confusion};
    }
    preview() {
      const label=this.demoRng.next()<.5?0:1;
      const image=makeImage(this.demoRng,label);
      const probability=this.policy.probability(encode(image.pixels));
      const action=probability>.5?1:0;
      const slots=this.demoRng.next()<.5?[0,1]:[1,0];
      return {label,image,probability,action,slots,target:[18,slots[0]===action?10:-10]};
    }
    snapshot() {
      return {version:1,algorithm:'pixel-contextual-bandit-v1',seed:this.seed,
        weights:[...this.policy.weights],trainState:this.trainRng.state,demoState:this.demoRng.state,
        rewards:this.rewards,history:this.history.map(r=>({...r,slots:[...r.slots]}))};
    }
  }
  function demoMatches(state, record) {
    return state.run_id === record.runId && state.config.mode === 'auto' &&
      JSON.stringify(state.config.targets) === JSON.stringify([record.trial.target]);
  }
  function demoCanApply(current, record, busy) {
    return current === record && !record.finished && !busy;
  }
  const api={RNG,makeImage,encode,Policy,LearningSession,MAX_ROUNDS,demoMatches,demoCanApply};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.FlyLearning=api;
})(typeof globalThis!=='undefined'?globalThis:this);
