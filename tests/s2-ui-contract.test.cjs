'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CHANNELS, createS2BridgeContract } = require('../src/preload/s2-bridge-contract.cjs');
const { createS2ViewModel, sanitizeS2 } = require('../src/renderer/s2/view-model.cjs');
const { S2MissionController } = require('../src/renderer/s2/controller.cjs');
const { renderS2Mission } = require('../src/renderer/s2/render.cjs');

function state() {
  return {
    workspaces:[{id:'workspace-a',name:'Workspace A'},{id:'workspace-b',name:'Workspace B'}],
    missions:[{id:'mission-a',workspaceId:'workspace-a',title:'Mission A'},{id:'mission-b',workspaceId:'workspace-b',title:'Mission B'}],
    revisions:[{id:'revision-a',workspaceId:'workspace-a',missionId:'mission-a',planId:'plan-a'}],
    missionRuns:[{id:'run-a',workspaceId:'workspace-a',missionId:'mission-a',planId:'plan-a',state:'running'}],
    plans:[{id:'plan-a',workspaceId:'workspace-a',steps:[{id:'step-a',name:'A',bindingId:'binding-a',dependsOn:[],state:'completed'},{id:'step-b',name:'B',bindingId:'binding-b',dependsOn:[],state:'running'},{id:'step-c',name:'C',bindingId:'binding-c',dependsOn:['step-a','step-b'],state:'pending'}]}],
    stepAttempts:[{id:'attempt-c',workspaceId:'workspace-a',missionRunId:'run-a',stepId:'step-c',blockers:[{code:'step_output_missing',detail:{inputName:'input-a',processId:12345}}]}],
    stepOutputs:[{id:'output-a',workspaceId:'workspace-a',missionRunId:'run-a',outputName:'result-a',value:{ok:true,profilePath:'/tmp/private-profile'}}],
    agentHandoffs:[{id:'handoff-a-c',workspaceId:'workspace-a',missionRunId:'run-a',fromStepAttemptId:'attempt-a',toStepId:'step-c',inputName:'input-a',outputId:'output-a'}],
    checkpoints:[{id:'checkpoint-a',workspaceId:'workspace-a',missionRunId:'run-a',projectionDigest:'sha256:abc'}],
    humanGates:[{id:'gate-a',workspaceId:'workspace-a',missionRunId:'run-a',token:{raw:'secret-token'}}],
    missionEvents:[{id:'event-a',workspaceId:'workspace-a',missionRunId:'run-a',type:'mission.run_started'}],
    evidence:[{id:'evidence-a',workspaceId:'workspace-a',missionRunId:'run-a',result:'ok'}],
  };
}

test('preload bridge exposes the full bounded Mission contract including checkpoint command', async () => {
  const calls=[];
  const bridge=createS2BridgeContract({invoke(channel,payload){calls.push({channel,payload});return Promise.resolve({ok:true});}});
  await bridge.queryState('workspace-a');
  await bridge.pauseMission({workspaceId:'workspace-a',runId:'run-a'});
  await bridge.recordCheckpoint({workspaceId:'workspace-a',runId:'run-a',id:'checkpoint-a'});
  assert.deepEqual(calls.map((item)=>item.channel),[CHANNELS.queryState,CHANNELS.pauseMission,CHANNELS.recordCheckpoint]);
  assert.throws(()=>bridge.cancelMission(null),/plain object/);
  assert.throws(()=>bridge.createMission([]),/plain object/);
  assert.equal(Object.keys(CHANNELS).length,9);
});

test('view model isolates active Workspace and never falls back for an unknown explicit Workspace', () => {
  const vm=createS2ViewModel(state(),'workspace-a','mission-a');
  assert.deepEqual(vm.missions.map((item)=>item.id),['mission-a']);
  assert.deepEqual(vm.graph.nodes.map((item)=>item.id),['step-a','step-b','step-c']);
  assert.deepEqual(vm.graph.edges,[{fromStepId:'step-a',toStepId:'step-c'},{fromStepId:'step-b',toStepId:'step-c'}]);
  const unknown=createS2ViewModel(state(),'workspace-missing');
  assert.equal(unknown.activeWorkspace,null);
  assert.deepEqual(unknown.missions,[]);
  assert.deepEqual(unknown.stepOutputs,[]);
});

test('blockers handoffs and nested secret/process/profile fields are redacted', () => {
  const vm=createS2ViewModel(state(),'workspace-a','mission-a');
  assert.equal(vm.blockers[0].label,'Required upstream step output is missing');
  assert.equal(vm.blockers[0].detail.processId,'[redacted]');
  assert.equal(vm.handoffs[0].output.value.profilePath,'[redacted]');
  assert.equal(vm.humanGates[0].token,'[redacted]');
  const sanitized=sanitizeS2({pid:99,authorization:{value:'Bearer abcdefghijklmnop'}});
  assert.equal(sanitized.pid,'[redacted]');
  assert.equal(sanitized.authorization,'[redacted]');
});

test('controller collapses repeated pause commands into one bridge invocation', async () => {
  let pauseCalls=0,queryCalls=0,release;
  const pausePromise=new Promise((resolve)=>{release=resolve;});
  const controller=new S2MissionController({bridge:{queryState(){queryCalls+=1;return Promise.resolve(state());},pauseMission(){pauseCalls+=1;return pausePromise;}}});
  controller.activeWorkspaceId='workspace-a';controller.selectedMissionId='mission-a';
  const input={workspaceId:'workspace-a',missionId:'mission-a',runId:'run-a'};
  const a=controller.pauseMission(input),b=controller.pauseMission(input);
  assert.equal(a,b);await Promise.resolve();assert.equal(pauseCalls,1);release({state:'paused'});await a;assert.equal(queryCalls,1);
});

class FakeNode{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.listeners={};this.textContent='';this.disabled=false;this.className='';}append(...nodes){this.children.push(...nodes);}addEventListener(name,fn){this.listeners[name]=fn;}}
const fakeDocument={createElement(tag){return new FakeNode(tag);}};

test('component renderer uses DOM construction and exposes Mission controls without innerHTML',()=>{
  const vm=createS2ViewModel(state(),'workspace-a','mission-a');const container=new FakeNode('div');const calls=[];
  const controller={pauseMission(input){calls.push(['pause',input]);},resumeMission(input){calls.push(['resume',input]);},cancelMission(input){calls.push(['cancel',input]);}};
  const root=renderS2Mission(container,vm,controller,fakeDocument);const graph=root.children.find((node)=>node.className==='s2-mission__graph');assert.equal(graph.children.filter((node)=>node.tag==='article').length,3);
  const controls=root.children.find((node)=>node.className==='s2-mission__controls');controls.children.find((node)=>node.className==='s2-mission__pauseMission').listeners.click();assert.equal(calls[0][0],'pause');assert.equal('innerHTML' in root,false);
});

test('navigation includes all required S2 operational surfaces',()=>{const vm=createS2ViewModel(state(),'workspace-a','mission-a');for(const required of ['Missions','Mission Builder','Execution Plan','Agent Handoffs','Human Gates','Checkpoints','Run Timeline','Evidence / Recovery'])assert.equal(vm.navigation.includes(required),true,required);});
