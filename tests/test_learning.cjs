const test = require('node:test');
const assert = require('node:assert/strict');
const {Policy, LearningSession, encode, makeImage, RNG} = require('../l3_workbench/static/learning-core.js');

test('selected action reward increases probability; no reward decreases it', () => {
  const p = new Policy(); const x = Array(65).fill(.2);
  const before = p.probability(x);
  p.update(x, 1, 1);
  assert.ok(p.probability(x) > before);
  const after = p.probability(x);
  p.update(x, 1, 0);
  assert.ok(p.probability(x) < after);
});

test('same seed reproduces images, choices and rewards', () => {
  const a = new LearningSession(7), b = new LearningSession(7);
  for(let i=0;i<150;i++) assert.deepEqual(a.step(),b.step());
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('evaluation freezes model, counters and random streams', () => {
  const a = new LearningSession(3);
  for(let i=0;i<30;i++) a.step();
  const before = a.snapshot(); const result = a.evaluate(200);
  assert.deepEqual(a.snapshot(), before);
  assert.equal(result.count, 200);
  assert.equal(result.correct, result.confusion[0][0]+result.confusion[1][1]);
  assert.deepEqual(a.evaluate(200),result);
});

test('reward training improves held-out accuracy across five seeds', () => {
  for(const seed of [0,1,7,42,2026]) {
    const s=new LearningSession(seed); const baseline=s.evaluate(200).accuracy;
    for(let i=0;i<600;i++) s.step();
    const result=s.evaluate(200);
    assert.ok(result.accuracy >= .85, `seed ${seed}: ${result.accuracy}`);
    assert.ok(result.accuracy > baseline+.25);
    assert.ok(s.history.some(r=>r.reward===0));
    assert.ok(s.history.some(r=>r.reward===1));
  }
});

test('encoder consumes pixels only and image labels do not enter policy', () => {
  const rng=new RNG(8), image=makeImage(rng,0);
  assert.equal(image.pixels.length,1024);
  assert.equal(encode(image.pixels).length,65);
  assert.deepEqual(encode(image.pixels),encode([...image.pixels]));
  const black=encode(Array(1024).fill(0));
  assert.ok(black.every(Number.isFinite));
  assert.throws(()=>encode([0,1]));
});

test('seed and evaluation bounds are enforced', () => {
  for(const seed of [-1,NaN,1.5,Infinity]) assert.throws(()=>new LearningSession(seed));
  const s = new LearningSession(0);
  for(const n of [0,201,-1,NaN,1.5]) assert.throws(()=>s.evaluate(n));
});

test('preview does not train and contains a frozen choice and randomized slots', () => {
  const s=new LearningSession(0), before=s.snapshot();
  const r=s.preview();
  assert.equal(s.history.length,0);
  assert.deepEqual(s.policy.weights,before.weights);
  assert.deepEqual([...r.slots].sort(),[0,1]);
  assert.deepEqual(r.target,[18,r.slots[0]===r.action?10:-10]);
});

test('demo feedback rejects superseded requests and replaced runs', () => {
  const {demoMatches, demoCanApply} = require('../l3_workbench/static/learning-core.js');
  const record={runId:'run-a',finished:false,trial:{target:[18,10]}};
  const state={run_id:'run-a',config:{mode:'auto',targets:[[18,10]]}};
  assert.equal(typeof demoMatches,'function');
  assert.equal(demoMatches(state,record),true);
  assert.equal(demoMatches({...state,run_id:'run-b'},record),false);
  assert.equal(demoCanApply(record,record,false),true);
  assert.equal(demoCanApply({...record},record,false),false);
  assert.equal(demoCanApply(record,record,true),false);
  record.finished=true;
  assert.equal(demoCanApply(record,record,false),false);
});
