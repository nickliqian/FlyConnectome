const assert = require('node:assert/strict');
const {test} = require('node:test');
const {reconcileConfig} = require('../l3_workbench/static/sync.js');
const old = {targets:[[25,0]],mode:'auto',noise:.1,occluded:false,friction:1};

test('another page updates target, mode and sensor controls',()=>{
  const {draft}=reconcileConfig(old,{...old,targets:[[12,8]],mode:'manual',occluded:true},{});
  assert.deepEqual(draft.targets,[[12,8]]);
  assert.equal(draft.mode,'manual');
  assert.equal(draft.occluded,true);
});
test('preserves unsubmitted scene settings while receiving live state',()=>{
  const {draft}=reconcileConfig({...old,friction:2},{...old,noise:.4},{sceneDirty:true});
  assert.equal(draft.friction,2);
  assert.equal(draft.noise,.4);
});
test('pending local edits are protected until their exact command is acknowledged',()=>{
  const pending={noise:{value:.5,commandId:7}};
  const local={...old,noise:.5};
  const before=reconcileConfig(local,old,{pending,ackId:6});
  assert.equal(before.draft.noise,.5);
  assert.equal(before.pending.noise.commandId,7);
  const after=reconcileConfig(local,{...old,noise:.5},{pending,ackId:7});
  assert.equal(after.draft.noise,.5);
  assert.deepEqual(after.pending,{});
  const external=reconcileConfig(after.draft,{...old,noise:.3},{pending:after.pending,ackId:8});
  assert.equal(external.draft.noise,.3);
});
test('imported preset stays staged until reset',()=>{
  const staged={...old,noise:.8,mode:'manual'};
  const {draft}=reconcileConfig(staged,old,{stagedPreset:true});
  assert.deepEqual(draft,staged);
});
