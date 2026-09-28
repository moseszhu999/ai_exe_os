'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { publishCapabilityVersion } = require('../src/domain/capability-model.cjs');
const { S1ApplicationService } = require('../src/application/s1-application-service.cjs');
const { A2_S8_DESTINATION_ACTION_READINESS_SCHEMA } = require('../src/management/policy/a2-s8-destination-action-readiness.cjs');
const { observeA2DestinationEffectEntryPreflight } = require('../src/management/policy/a2-s8-destination-effect-entry-preflight.cjs');

const DIGEST = `sha256:${'c'.repeat(64)}`;

class FakeWorkerManager {
  constructor() {
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', status: 'idle', browserChannel: 'chromium' },
    ];
    this.submissions = [];
  }
  list() { return this.workers.map((row) => ({ ...row })); }
  async submitAuthorizedLocalTask(input) { this.submissions.push({ ...input }); return { result: { text: 'unexpected' } }; }
  async start() { throw new Error('M2.26 must not start Worker'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

function version({ bindings = [] } = {}) {
  return {
    id: 'local.form-submit@1.0.0',
    ...publishCapabilityVersion({
      packageId: 'local.form-submit', version: '1.0.0', integrityDigest: DIGEST,
      inputSchema: { type: 'object', required: ['payload'] }, outputSchema: { type: 'object' },
      evidenceRequirements: ['local result text'], resourceRequirements: ['browser profile'],
      providerContractIds: ['provider-local-form'], delegatedActionBindings: bindings, humanGatePolicy: 'action',
    }),
  };
}

function bindingContract(overrides = {}) {
  return {
    sourceAction: 'run_approved_test_profile', sourceTarget: 'project:trainingos',
    runtimeAction: 'submit_payload', runtimeTarget: 'http://127.0.0.1:43119/task-form.html',
    payloadBinding: 'delegation_payload_json_v1', ...overrides,
  };
}

function readiness(overrides = {}) {
  return Object.freeze({
    schema: A2_S8_DESTINATION_ACTION_READINESS_SCHEMA,
    actionId: 'aiexe:management-action:run-tests:26', actionType: 'run_approved_test_profile', projectId: 'trainingos',
    delegationRequestRef: 'request-26', destinationWorkspaceId: 'workspace-a', destinationExecutionBindingRef: 'binding-26',
    destinationLocalMissionRef: 'mission-26', destinationLocalExecutionRunRef: 'run-26', destinationActionTaskRef: 'task-26',
    destinationActionReadinessObservationAccepted: true, destinationActionReadinessState: 'waiting_human',
    destinationActionHumanGateRequested: true, destinationActionHumanGateState: 'requested',
    destinationActionHumanGateDecisionCreatedByManagementLayer: false, destinationExecutionPerformedByManagementLayer: false,
    managementEffectInvocationPerformed: false, executionAuthorized: false, binding: false, ...overrides,
  });
}

function serviceFor({ capabilityVersion = version(), taskOverrides = {}, installationOverrides = {} } = {}) {
  const translated = capabilityVersion.delegatedActionBindings?.[0] || null;
  const task = {
    id: 'task-26', workspaceId: 'workspace-a', installationId: 'install-26',
    capabilityAction: translated?.runtimeAction || 'run_approved_test_profile',
    target: translated?.runtimeTarget || 'project:trainingos', state: 'waiting_human', ...taskOverrides,
  };
  const installation = {
    id: 'install-26', workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0',
    integrityDigest: DIGEST, status: 'installed', ...installationOverrides,
  };
  let queries = 0;
  return {
    queryCount: () => queries,
    queryMissionState(workspaceId) {
      queries += 1;
      return { activeWorkspaceId: workspaceId, s1: { tasks: [task], installations: [installation], marketplace: [capabilityVersion] } };
    },
  };
}

test('M2.26 current canonical local capability version exposes an explicit empty delegated-action binding set', () => {
  const modelVersion = version();
  assert.deepEqual(modelVersion.delegatedActionBindings, []);
  assert.equal(Object.isFrozen(modelVersion.delegatedActionBindings), true);
  const service = new S1ApplicationService({ workerManager: new FakeWorkerManager() });
  try {
    const local = service.queryState('workspace-a').marketplace.find((item) => `${item.packageId}@${item.version}` === 'local.form-submit@1.0.0');
    assert.ok(local);
    assert.deepEqual(local.delegatedActionBindings, modelVersion.delegatedActionBindings);
  } finally { if (typeof service.close === 'function') service.close(); }
});

test('M2.26 real current-version contract absence fails closed instead of silently aliasing management action to runtime action', () => {
  const result = observeA2DestinationEffectEntryPreflight({ actionReadiness: readiness(), destinationWorkspaceId: 'workspace-a', s8Service: serviceFor() });
  assert.equal(result.destinationEffectEntryPreflightAccepted, true);
  assert.equal(result.destinationCapabilityVersionRef, 'local.form-submit@1.0.0');
  assert.equal(result.destinationDelegatedActionBindingObserved, false);
  assert.equal(result.destinationDelegatedActionBindingCompatible, false);
  assert.equal(result.destinationEffectEntryPreflightReason, 'destination_capability_action_binding_missing');
  assert.equal(result.destinationRuntimeAction, null);
  assert.equal(result.destinationRuntimeTarget, null);
  assert.equal(result.effectEntryEligible, false);
  assert.equal(result.managementRuntimeActionChosen, false);
  assert.equal(result.managementEffectInvocationPerformed, false);
});

test('M2.26 exact destination-owned capability binding matches the runtime-bound Task while pending action HumanGate cannot enter effect', () => {
  const capabilityVersion = version({ bindings: [bindingContract()] });
  const result = observeA2DestinationEffectEntryPreflight({ actionReadiness: readiness(), destinationWorkspaceId: 'workspace-a', s8Service: serviceFor({ capabilityVersion }) });
  assert.equal(result.destinationEffectEntryPreflightAccepted, true);
  assert.equal(result.destinationDelegatedActionBindingObserved, true);
  assert.equal(result.destinationDelegatedActionBindingCompatible, true);
  assert.equal(result.destinationRuntimeAction, 'submit_payload');
  assert.equal(result.destinationRuntimeTarget, 'http://127.0.0.1:43119/task-form.html');
  assert.equal(result.destinationPayloadBinding, 'delegation_payload_json_v1');
  assert.equal(result.effectEntryEligible, false);
  assert.equal(result.effectEntryReason, 'destination_runtime_binding_exact_action_human_gate_pending');
  assert.equal(result.destinationActionHumanGateDecisionCreatedByManagementLayer, false);
  assert.equal(result.managementEffectInvocationPerformed, false);
});

test('M2.26 capability-version model rejects duplicate source action/target bindings and unknown binding fields', () => {
  assert.throws(() => version({ bindings: [bindingContract(), bindingContract({ runtimeAction: 'other_runtime_action' })] }), /must not contain duplicate source action\/target bindings/);
  assert.throws(() => version({ bindings: [{ ...bindingContract(), authorityGrant: 'forged' }] }), /unsupported field: authorityGrant/);
});

test('M2.26 binding must match the exact source management action and semantic target', () => {
  const capabilityVersion = version({ bindings: [bindingContract({ sourceTarget: 'project:other' })] });
  const result = observeA2DestinationEffectEntryPreflight({ actionReadiness: readiness(), destinationWorkspaceId: 'workspace-a', s8Service: serviceFor({ capabilityVersion }) });
  assert.equal(result.destinationDelegatedActionBindingCompatible, false);
  assert.equal(result.destinationEffectEntryPreflightReason, 'destination_capability_action_binding_missing');
  assert.equal(result.effectEntryEligible, false);
});

test('M2.26 runtime Task drift or installed-version drift fails closed before runtime binding can be trusted', () => {
  const capabilityVersion = version({ bindings: [bindingContract()] });
  const actionDrift = serviceFor({ capabilityVersion, taskOverrides: { capabilityAction: 'run_approved_test_profile', target: 'project:trainingos' } });
  const actionResult = observeA2DestinationEffectEntryPreflight({ actionReadiness: readiness(), destinationWorkspaceId: 'workspace-a', s8Service: actionDrift });
  assert.equal(actionResult.destinationEffectEntryPreflightAccepted, false);
  assert.equal(actionResult.destinationEffectEntryPreflightReason, 'destination_action_task_runtime_binding_drift');
  const versionDrift = serviceFor({ capabilityVersion, installationOverrides: { integrityDigest: `sha256:${'d'.repeat(64)}` } });
  const versionResult = observeA2DestinationEffectEntryPreflight({ actionReadiness: readiness(), destinationWorkspaceId: 'workspace-a', s8Service: versionDrift });
  assert.equal(versionResult.destinationEffectEntryPreflightAccepted, false);
  assert.equal(versionResult.destinationEffectEntryPreflightReason, 'destination_capability_version_not_exact_installed_version');
});

test('M2.26 blocked action may audit exact runtime compatibility but never becomes effect-entry eligible', () => {
  const capabilityVersion = version({ bindings: [bindingContract()] });
  const result = observeA2DestinationEffectEntryPreflight({
    actionReadiness: readiness({ destinationActionReadinessState: 'blocked', destinationActionHumanGateRequested: false, destinationActionHumanGateState: null }),
    destinationWorkspaceId: 'workspace-a', s8Service: serviceFor({ capabilityVersion }),
  });
  assert.equal(result.destinationDelegatedActionBindingCompatible, true);
  assert.equal(result.effectEntryEligible, false);
  assert.equal(result.effectEntryReason, 'destination_runtime_binding_exact_action_not_ready');
});

test('M2.26 rejects caller runtime/effect answers before read and contains no decision or execution method', () => {
  const service = serviceFor({ capabilityVersion: version({ bindings: [bindingContract()] }) });
  for (const [key, value] of [['runtimeAction', 'submit_payload'], ['runtimeTarget', 'http://127.0.0.1:43119/task-form.html'], ['payload', 'forged'], ['effectApproved', true], ['actionHumanGateDecision', 'approved']]) {
    assert.throws(() => observeA2DestinationEffectEntryPreflight({ actionReadiness: readiness(), destinationWorkspaceId: 'workspace-a', s8Service: service, [key]: value }), /unsupported field/);
  }
  assert.equal(service.queryCount(), 0);
  const source = fs.readFileSync(path.join(__dirname, '../src/management/policy/a2-s8-destination-effect-entry-preflight.cjs'), 'utf8');
  assert.match(source, /queryMissionState/);
  assert.doesNotMatch(source, /\.approveHumanGate\s*\(/);
  assert.doesNotMatch(source, /\.rejectHumanGate\s*\(/);
  assert.doesNotMatch(source, /submitAuthorizedLocalTask|\.execute\s*\(|workerManager|child_process|wallet|payment|fetch\s*\(/);
});
