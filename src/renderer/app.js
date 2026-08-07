const api = window.aiExecutionOS;
const statusElement = document.getElementById('status');
let state = { workers: [], tasks: [], events: [] };
let s1State = null;
let s2State = null;
let activeWorkspaceId = 'workspace-a';
let selectedMissionId = 'mission-ui-001';

const BLOCKER_LABELS = Object.freeze({
  workspace_inactive: 'Workspace is inactive',
  agent_inactive: 'Agent is inactive',
  installation_missing_or_disabled: 'Capability is not installed or is disabled',
  grant_missing_or_revoked: 'Agent capability grant is missing or revoked',
  action_or_target_not_granted: 'Action or target is outside the Agent grant',
  provider_contract_unknown: 'Provider contract is not accepted',
  provider_contract_changed_or_expired: 'Provider contract changed or expired',
  dependency_unsatisfied: 'Task dependency is not satisfied',
  resource_conflict: 'An exclusive resource is already reserved',
  worker_unavailable: 'Bound Worker is unavailable',
  human_gate_required: 'Human approval is required',
  recovery_requires_review: 'Recovered execution requires human review',
  step_output_missing: 'Required upstream step output is missing',
  mission_paused: 'Mission is paused',
  mission_cancelled: 'Mission is cancelled',
  terminal_evidence_unsatisfied: 'Terminal evidence is unsatisfied',
});

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.display = 'block';
  statusElement.style.borderColor = isError ? '#ff858b' : '#65d8ff';
  setTimeout(() => { statusElement.style.display = 'none'; }, 4200);
}

async function call(action, message = null) {
  try {
    const result = await action();
    await refresh();
    if (message) showStatus(message);
    return result;
  } catch (error) {
    showStatus(error.message || String(error), true);
    return null;
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function actionButton(label, className, handler) {
  const button = element('button', label, className);
  button.addEventListener('click', handler);
  return button;
}

function workerCard(worker) {
  const card = element('div');
  card.append(
    element('strong', worker.id),
    element('p', `${worker.role} · ${worker.browserChannel} · ${worker.status}`),
    element('small', worker.lastKnownUrl || 'not started'),
  );
  const actions = element('div', undefined, 'card-actions');
  actions.append(
    actionButton('Start', '', () => call(() => api.startWorker(worker.id))),
    actionButton('Focus', 'secondary', () => call(() => api.focusWorker(worker.id))),
    actionButton('Pause', 'secondary', () => call(() => api.pauseWorker(worker.id))),
    actionButton('Resume', 'secondary', () => call(() => api.resumeWorker(worker.id))),
    actionButton('Stop', 'danger', () => call(() => api.stopWorker(worker.id))),
  );
  card.append(actions);
  return card;
}

function taskCard(task) {
  const card = element('div');
  card.append(
    element('strong', task.title),
    element('p', `${task.id} · ${task.state} · revision ${task.revision}`),
    element('small', JSON.stringify(task.payload)),
  );
  const label = element('label', 'Worker');
  const select = element('select');
  select.className = 'task-worker';
  for (const worker of state.workers) {
    const option = element('option', worker.id);
    option.value = worker.id;
    select.append(option);
  }
  label.append(select);
  card.append(label);
  card.append(actionButton('Review payload and submit to local test page', '', () => {
    const workerId = select.value;
    if (!workerId) return showStatus('Create a worker first', true);
    const payload = typeof task.payload === 'string' ? task.payload : JSON.stringify(task.payload);
    const accepted = window.confirm(`Authorized local test submission\n\nWorker: ${workerId}\nTask: ${task.id}\nPayload:\n${payload}`);
    if (!accepted) return;
    call(() => api.confirmLocalTask({ workerId, taskId: task.id, payload }));
  }));
  return card;
}

function renderWorkspaceSelector() {
  const select = document.getElementById('s1-workspace');
  const ids = [...select.options].map((option) => option.value);
  const nextIds = s1State.workspaces.map((workspace) => workspace.id);
  if (JSON.stringify(ids) !== JSON.stringify(nextIds)) {
    select.replaceChildren(...s1State.workspaces.map((workspace) => {
      const option = element('option', workspace.name);
      option.value = workspace.id;
      return option;
    }));
  }
  select.value = activeWorkspaceId;
  const active = s1State.workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  document.getElementById('s1-workspace-summary').textContent = active
    ? `${active.name} · ${s1State.agents.length} agent · ${s1State.installations.length} installation · ${s1State.tasks.length} task`
    : 'Unknown Workspace';
}

function renderS1Workers() {
  const select = document.getElementById('s1-worker');
  select.replaceChildren(...s1State.workers.map((worker) => {
    const option = element('option', `${worker.id} · ${worker.browserChannel} · ${worker.status}`);
    option.value = worker.id;
    return option;
  }));
}

function renderS1Tasks() {
  document.getElementById('s1-tasks').replaceChildren(...s1State.tasks.map((task) => {
    const card = element('div');
    card.append(
      element('strong', task.id),
      element('p', `${task.state} · ${task.capabilityAction}`),
      element('small', `Graph ${task.graphId} · Run ${task.executionRunId || 'not requested'}`),
    );
    return card;
  }));
  const blockers = s1State.tasks.flatMap((task) => (task.blockers || []).map((entry) => ({ task, entry })));
  document.getElementById('s1-blockers').replaceChildren(...blockers.map(({ task, entry }) => {
    const card = element('div');
    card.append(element('strong', BLOCKER_LABELS[entry.code] || entry.code), element('small', `Task ${task.id}`));
    return card;
  }));
  if (!blockers.length) document.getElementById('s1-blockers').append(element('p', 'No blockers'));
}

function renderS1Gates() {
  const cards = s1State.humanGates.map((gate) => {
    const card = element('div');
    card.append(
      element('strong', `${gate.capabilityAction} → ${gate.target}`),
      element('p', `${gate.state} · Worker ${gate.workerId}`),
      element('small', JSON.stringify(gate.payloadPreview || {})),
    );
    if (gate.state === 'requested') {
      const actions = element('div', undefined, 'card-actions');
      actions.append(
        actionButton('Reject', 'danger', () => call(() => api.s1.rejectHumanGate({ workspaceId: activeWorkspaceId, gateId: gate.id }), 'Gate rejected; no submission occurred')),
        actionButton('Approve once', '', () => call(() => api.s1.approveHumanGate({ workspaceId: activeWorkspaceId, gateId: gate.id }), 'Approved execution result observed')),
      );
      card.append(actions);
    }
    return card;
  });
  document.getElementById('s1-gates').replaceChildren(...cards);
  if (!cards.length) document.getElementById('s1-gates').append(element('p', 'No Human Gates'));
}

function renderS1Evidence() {
  const cards = s1State.evidence.map((evidence) => {
    const card = element('div');
    card.append(
      element('strong', evidence.type),
      element('p', `${evidence.taskId || evidence.stepId || 'evidence'} / ${evidence.executionRunId || evidence.missionRunId || 'local'}`),
      element('small', JSON.stringify(evidence.result)),
    );
    return card;
  });
  document.getElementById('s1-evidence').replaceChildren(...cards);
  if (!cards.length) document.getElementById('s1-evidence').append(element('p', 'No evidence yet'));
  document.getElementById('s1-events').textContent = s1State.events.map((event) => JSON.stringify(event)).join('\n');
}

function renderS1() {
  renderWorkspaceSelector();
  renderS1Workers();
  renderS1Tasks();
  renderS1Gates();
  renderS1Evidence();
  document.getElementById('s1-marketplace').textContent = s1State.marketplace
    .map((version) => `${version.packageId}@${version.version} · ${version.status}`)
    .join('\n') || 'No capabilities';
  document.getElementById('s1-agent-summary').textContent = s1State.agents
    .map((agent) => `${agent.name} · ${agent.status}`)
    .join('\n') || 'No Agent';
}

function currentMission() {
  return s2State?.missions.find((mission) => mission.id === selectedMissionId) || s2State?.missions[0] || null;
}

function currentRun() {
  const mission = currentMission();
  return s2State?.missionRuns.find((run) => run.missionId === mission?.id) || null;
}

function currentPlan() {
  const run = currentRun();
  const mission = currentMission();
  const revision = s2State?.revisions.filter((item) => item.missionId === mission?.id && Number(item.revision) > 0).sort((a, b) => Number(b.revision) - Number(a.revision))[0];
  return s2State?.plans.find((plan) => plan.id === (run?.planId || revision?.planId)) || null;
}

function renderS2() {
  const mission = currentMission();
  const run = currentRun();
  const plan = currentPlan();
  document.getElementById('s2-run-summary').textContent = run
    ? `${run.id} · ${run.state} · revision ${s2State.revisions.find((item) => item.id === run.missionRevisionId)?.revision || '?'}`
    : 'No Mission run';

  const missionCards = s2State.missions.map((item) => {
    const card = element('div');
    card.append(element('strong', item.title), element('p', `${item.id} · ${item.status}`), element('small', item.objective || ''));
    card.addEventListener('click', () => { selectedMissionId = item.id; renderS2(); });
    return card;
  });
  document.getElementById('s2-missions').replaceChildren(...missionCards);
  if (!missionCards.length) document.getElementById('s2-missions').append(element('p', 'No Missions in this Workspace'));

  const planCards = (plan?.steps || []).map((step) => {
    const card = element('div', undefined, `mission-step mission-step--${step.state || 'pending'}`);
    const blockers = (step.blockers || []).map((entry) => BLOCKER_LABELS[entry.code] || entry.code).join(' · ');
    card.append(
      element('strong', `${step.id} · ${step.name}`),
      element('p', `${step.state || 'pending'} · ${step.executionMode || 'declared'} · Agent binding ${step.bindingId}`),
      element('small', `${(step.dependsOn || []).length ? `Depends on ${step.dependsOn.join(', ')}` : 'Root step'}${blockers ? ` · ${blockers}` : ''}`),
    );
    return card;
  });
  document.getElementById('s2-plan').replaceChildren(...planCards);
  if (!planCards.length) document.getElementById('s2-plan').append(element('p', 'Create a Mission revision to see its Execution Plan'));

  const attempts = run ? s2State.stepAttempts.filter((item) => item.missionRunId === run.id) : [];
  document.getElementById('s2-steps').replaceChildren(...attempts.map((attempt) => {
    const card = element('div');
    card.append(
      element('strong', `${attempt.stepId} · attempt ${attempt.attemptNumber}`),
      element('p', `${attempt.state}${attempt.executionRunId ? ` · S1 run ${attempt.executionRunId}` : ''}`),
      element('small', attempt.recoveryReason || (attempt.blockers || []).map((entry) => BLOCKER_LABELS[entry.code] || entry.code).join(' · ')),
    );
    if (attempt.state === 'recovery_required' || (attempt.state === 'waiting_human' && attempt.recoveryReason)) {
      card.append(actionButton('Review recovery & create new attempt', 'secondary', () => {
        const accepted = window.confirm(`Retry creates a NEW StepAttempt. The old uncertain attempt will never be replayed.\n\nStep: ${attempt.stepId}\nPrevious attempt: ${attempt.id}\nReason: ${attempt.recoveryReason || 'review required'}`);
        if (!accepted) return;
        call(() => api.s2.mission.retryStepAfterReview({
          workspaceId: activeWorkspaceId,
          runId: run.id,
          previousAttemptId: attempt.id,
          reviewed: true,
        }), 'Reviewed retry created a new StepAttempt');
      }));
    }
    return card;
  }));
  if (!attempts.length) document.getElementById('s2-steps').append(element('p', 'No StepAttempts yet'));

  const handoffs = run ? s2State.agentHandoffs.filter((item) => item.missionRunId === run.id) : [];
  document.getElementById('s2-handoffs').replaceChildren(...handoffs.map((handoff) => {
    const output = s2State.stepOutputs.find((item) => item.id === handoff.outputId);
    const card = element('div');
    card.append(
      element('strong', `${handoff.fromStepAttemptId} → ${handoff.toStepId}.${handoff.inputName}`),
      element('p', output ? `${output.outputName} · ${output.schemaDigest}` : handoff.outputId),
      element('small', output ? JSON.stringify(output.value) : 'Output unavailable'),
    );
    return card;
  }));
  if (!handoffs.length) document.getElementById('s2-handoffs').append(element('p', 'No Agent handoffs yet'));

  const checkpoints = run ? s2State.checkpoints.filter((item) => item.missionRunId === run.id) : [];
  document.getElementById('s2-checkpoints').replaceChildren(...checkpoints.map((checkpoint) => {
    const card = element('div');
    card.append(
      element('strong', checkpoint.id),
      element('p', `event sequence ${checkpoint.canonicalEventSequence}`),
      element('small', checkpoint.projectionDigest),
    );
    return card;
  }));
  if (!checkpoints.length) document.getElementById('s2-checkpoints').append(element('p', 'No checkpoints yet'));

  const events = run ? s2State.missionEvents.filter((event) => event.aggregateId === run.id || event.payload?.missionRunId === run.id || event.payload?.missionId === mission?.id) : [];
  document.getElementById('s2-timeline').textContent = events.map((event) => `${event.sequence} · ${event.eventType} · ${event.occurredAt}`).join('\n');

  document.getElementById('s2-start').disabled = !mission || !!run;
  document.getElementById('s2-pause').disabled = run?.state !== 'running';
  document.getElementById('s2-resume').disabled = run?.state !== 'paused';
  document.getElementById('s2-checkpoint').disabled = !run;
  document.getElementById('s2-cancel').disabled = !run || ['completed', 'cancelled', 'failed'].includes(run.state);
}

async function refresh() {
  [state, s1State, s2State] = await Promise.all([
    api.getState(),
    api.s1.queryState(activeWorkspaceId),
    api.s2.mission.queryState(activeWorkspaceId),
  ]);
  document.getElementById('workers').replaceChildren(...state.workers.map(workerCard));
  document.getElementById('tasks').replaceChildren(...state.tasks.map(taskCard));
  document.getElementById('events').textContent = state.events.map((event) => JSON.stringify(event)).join('\n');
  renderS1();
  renderS2();
}

async function prepareS2Prerequisites() {
  const localTarget = s1State.localTarget;
  const formInstall = await api.s1.installCapability({ workspaceId: activeWorkspaceId, packageId: 'local.form-submit', version: '1.0.0' });
  const transformInstall = await api.s1.installCapability({ workspaceId: activeWorkspaceId, packageId: 'local.mission-transform', version: '1.0.0' });
  const next = await api.s1.queryState(activeWorkspaceId);
  const agentA = next.agents.find((agent) => agent.id === 'agent-a');
  const agentA2 = next.agents.find((agent) => agent.id === 'agent-a2');
  if (!agentA || !agentA2) throw new Error('S2 requires agent-a and agent-a2 in Workspace A');
  await api.s1.grantCapability({ workspaceId: activeWorkspaceId, agentId: agentA.id, installationId: formInstall.id, allowedActions: ['submit_payload'], allowedTargets: [localTarget] });
  await api.s1.grantCapability({ workspaceId: activeWorkspaceId, agentId: agentA2.id, installationId: transformInstall.id, allowedActions: ['transform_payload', 'join_payload'], allowedTargets: ['local://mission-transform', 'local://mission-join'] });
}

async function createS2MissionRevision() {
  const missionId = document.getElementById('s2-mission-id').value.trim();
  const objective = document.getElementById('s2-objective').value.trim();
  if (!missionId || !objective) throw new Error('Mission ID and objective are required');
  selectedMissionId = missionId;
  await api.s2.mission.createMission({ id: missionId, workspaceId: activeWorkspaceId, title: `Mission ${missionId}`, objective, idempotencyKey: missionId });
  const next = await api.s1.queryState(activeWorkspaceId);
  const formInstall = next.installations.find((item) => item.packageId === 'local.form-submit' && item.status === 'installed');
  const transformInstall = next.installations.find((item) => item.packageId === 'local.mission-transform' && item.status === 'installed');
  if (!formInstall || !transformInstall) throw new Error('Prepare S2 prerequisites first');
  await api.s2.mission.createRevision({
    workspaceId: activeWorkspaceId,
    missionId,
    id: `${missionId}-rev-1`,
    revision: 1,
    objective,
    terminalStepIds: ['step-c'],
    steps: [
      {
        id: 'step-a', name: 'Bounded browser evidence', agentId: 'agent-a', installationId: formInstall.id,
        capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: next.localTarget,
        workerId: 's1-worker-chromium', dependsOn: [], declaredInputs: [], declaredOutputs: ['result_a'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', payload: `S2 Mission ${missionId} browser evidence`,
      },
      {
        id: 'step-b', name: 'Deterministic transform', agentId: 'agent-a2', installationId: transformInstall.id,
        capabilityVersionId: 'local.mission-transform@1.0.0', action: 'transform_payload', target: 'local://mission-transform',
        dependsOn: [], declaredInputs: [], declaredOutputs: ['result_b'], evidenceRequirements: ['local-transform-evidence'], humanGatePolicy: 'never', payload: `S2 Mission ${missionId} local branch`,
      },
      {
        id: 'step-c', name: 'Join declared outputs', agentId: 'agent-a2', installationId: transformInstall.id,
        capabilityVersionId: 'local.mission-transform@1.0.0', action: 'join_payload', target: 'local://mission-join',
        dependsOn: ['step-a', 'step-b'],
        declaredInputs: [
          { name: 'input_a', fromStepId: 'step-a', outputName: 'result_a' },
          { name: 'input_b', fromStepId: 'step-b', outputName: 'result_b' },
        ],
        declaredOutputs: ['final_result'], evidenceRequirements: ['final-evidence'], humanGatePolicy: 'never',
      },
    ],
  });
}

function selectedRevision() {
  const mission = currentMission();
  return s2State.revisions
    .filter((item) => item.missionId === mission?.id && Number(item.revision) > 0)
    .sort((a, b) => Number(b.revision) - Number(a.revision))[0] || null;
}

document.getElementById('refresh').addEventListener('click', () => call(refresh));
document.getElementById('s1-workspace').addEventListener('change', (event) => {
  activeWorkspaceId = event.target.value;
  selectedMissionId = '';
  call(refresh);
});
document.getElementById('s1-install').addEventListener('click', () => call(
  () => api.s1.installCapability({ workspaceId: activeWorkspaceId, packageId: 'local.form-submit', version: '1.0.0' }),
  'Capability installed in selected Workspace',
));
document.getElementById('s1-grant').addEventListener('click', () => {
  const installation = s1State.installations.find((item) => item.packageId === 'local.form-submit' && item.status === 'installed');
  const agent = s1State.agents[0];
  if (!installation || !agent) return showStatus('Install the capability and select an Agent first', true);
  call(() => api.s1.grantCapability({
    workspaceId: activeWorkspaceId,
    agentId: agent.id,
    installationId: installation.id,
    allowedActions: ['submit_payload'],
    allowedTargets: [s1State.localTarget],
  }), 'Capability granted to Agent');
});
document.getElementById('s1-provision').addEventListener('click', async () => {
  const worker = s1State.workers.find((item) => item.id === document.getElementById('s1-worker').value);
  if (!worker) return showStatus('No Worker binding in this Workspace', true);
  await call(async () => {
    const existing = state.workers.find((item) => item.id === worker.id);
    if (!existing) await api.createWorker({ id: worker.id, projectId: 's1-local-project', role: 'implementation', browserChannel: worker.browserChannel });
    const current = (await api.getState()).workers.find((item) => item.id === worker.id);
    if (!current || ['created', 'stopped', 'failed'].includes(current.status)) await api.startWorker(worker.id);
  }, 'Worker provisioned and started');
});
document.getElementById('s1-create-task').addEventListener('click', () => {
  const agent = s1State.agents[0];
  const installation = s1State.installations.find((item) => item.packageId === 'local.form-submit' && item.status === 'installed');
  const workerId = document.getElementById('s1-worker').value || 's1-worker-chromium';
  call(() => api.s1.createTask({
    id: document.getElementById('s1-task-id').value.trim(), workspaceId: activeWorkspaceId,
    agentId: agent?.id || (activeWorkspaceId === 'workspace-a' ? 'agent-a' : 'agent-b'),
    installationId: installation?.id || 'install-missing', capabilityAction: 'submit_payload',
    target: s1State.localTarget, workerId, payload: document.getElementById('s1-task-payload').value,
  }), 'Task created and evaluated');
});

document.getElementById('s2-prepare').addEventListener('click', () => call(prepareS2Prerequisites, 'S2 capabilities installed and granted to two Agents'));
document.getElementById('s2-create').addEventListener('click', () => call(createS2MissionRevision, 'Three-step Mission revision created'));
document.getElementById('s2-start').addEventListener('click', () => {
  const mission = currentMission();
  const revision = selectedRevision();
  if (!mission || !revision) return showStatus('Create a Mission revision first', true);
  call(() => api.s2.mission.startMission({ workspaceId: activeWorkspaceId, missionId: mission.id, revisionId: revision.id, runId: `${mission.id}-run-1` }), 'Mission started; ready steps evaluated');
});
document.getElementById('s2-pause').addEventListener('click', () => {
  const run = currentRun(); if (!run) return;
  call(() => api.s2.mission.pauseMission({ workspaceId: activeWorkspaceId, missionId: run.missionId, runId: run.id, reason: 'operator pause' }), 'Mission paused; no new step may start');
});
document.getElementById('s2-resume').addEventListener('click', () => {
  const run = currentRun(); if (!run) return;
  call(() => api.s2.mission.resumeMission({ workspaceId: activeWorkspaceId, missionId: run.missionId, runId: run.id, reason: 'operator resume' }), 'Mission resumed; ready set reevaluated');
});
document.getElementById('s2-cancel').addEventListener('click', () => {
  const run = currentRun(); if (!run) return;
  const accepted = window.confirm(`Cancel Mission ${run.missionId}? Completed evidence remains immutable; no new step will start.`);
  if (!accepted) return;
  call(() => api.s2.mission.cancelMission({ workspaceId: activeWorkspaceId, missionId: run.missionId, runId: run.id, reason: 'operator cancel' }), 'Mission cancelled; history preserved');
});
document.getElementById('s2-checkpoint').addEventListener('click', () => {
  const run = currentRun(); if (!run) return;
  call(() => api.s2.mission.recordCheckpoint({ workspaceId: activeWorkspaceId, missionId: run.missionId, runId: run.id }), 'Mission checkpoint recorded');
});

document.getElementById('create-worker').addEventListener('click', () => call(() => api.createWorker({
  id: document.getElementById('worker-id').value.trim(), projectId: 's0-local-project',
  role: document.getElementById('worker-role').value, browserChannel: document.getElementById('browser-channel').value,
})));
document.getElementById('create-task').addEventListener('click', () => call(() => api.createTask({
  id: document.getElementById('task-id').value.trim(), projectId: 's0-local-project',
  title: document.getElementById('task-title').value.trim(), payload: document.getElementById('task-payload').value,
})));
document.getElementById('observe-pr').addEventListener('click', async () => {
  const repository = document.getElementById('github-repository').value.trim();
  const [owner, repo, extra] = repository.split('/');
  if (!owner || !repo || extra) return showStatus('Use owner/repository format', true);
  const number = Number(document.getElementById('github-pr-number').value);
  const result = await call(() => api.observePullRequest({ owner, repo, number }));
  if (result) showStatus(result.changed ? 'New GitHub state recorded' : 'GitHub state unchanged; no duplicate event created');
});

refresh().catch((error) => showStatus(error.message, true));
