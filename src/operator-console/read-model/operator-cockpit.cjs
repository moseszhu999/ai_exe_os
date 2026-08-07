'use strict';

const SENSITIVE_KEY = /^(password|passwd|authorization|cookie|cookies|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid)$/i;
const SENSITIVE_STRING = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token)=)/i;

function sanitize(value, key = '', seen = new Set()) {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return SENSITIVE_STRING.test(value) ? '[redacted]' : value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  let out;
  if (Array.isArray(value)) out = value.map((item) => sanitize(item, '', seen));
  else out = Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, sanitize(nested, nestedKey, seen)]));
  seen.delete(value);
  return out;
}

function scoped(items, workspaceId) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.workspaceId === workspaceId);
}

function stableSort(items) {
  return [...items].sort((a, b) => String(a?.id || a?.workerId || '').localeCompare(String(b?.id || b?.workerId || '')));
}

function workerWorkspace(worker, workerBindings) {
  const binding = (workerBindings || []).find((item) => item?.id === worker?.id || item?.workerId === worker?.id);
  return binding?.workspaceId || worker?.workspaceId || null;
}

function workerSummary(worker, workspaceId, workerBindings) {
  if (workerWorkspace(worker, workerBindings) !== workspaceId) return null;
  return Object.freeze(sanitize({
    workerId: worker.id,
    projectId: worker.projectId || null,
    workspaceId,
    role: worker.role || null,
    browserChannel: worker.browserChannel || null,
    status: worker.status || 'unknown',
    activeTaskId: worker.activeTaskId || null,
    lastKnownUrl: worker.lastKnownUrl || null,
    controls: {
      canFocus: !['created', 'stopped', 'failed'].includes(worker.status),
      canStop: !['stopped', 'failed'].includes(worker.status),
      canPause: ['idle', 'active', 'waiting_human'].includes(worker.status),
      canResume: worker.status === 'paused',
    },
  }));
}

function summarizeMission(run, state) {
  const mission = state.missions.find((item) => item.id === run.missionId) || null;
  const plan = state.plans.find((item) => item.id === run.planId) || null;
  const attempts = state.stepAttempts.filter((item) => item.missionRunId === run.id);
  return Object.freeze(sanitize({
    runId: run.id,
    missionId: run.missionId,
    title: mission?.title || run.missionId,
    state: run.state,
    revisionId: run.missionRevisionId || null,
    planId: run.planId,
    steps: (plan?.steps || []).map((step) => ({
      id: step.id,
      name: step.name || step.id,
      state: step.state || 'pending',
      blockers: step.blockers || [],
      latestAttemptId: attempts.filter((attempt) => attempt.stepId === step.id)
        .sort((a, b) => Number(b.attemptNumber || 0) - Number(a.attemptNumber || 0))[0]?.id || null,
    })),
  }));
}

function sanitizeList(items) {
  return items.map((item) => sanitize(item));
}

function createOperatorCockpitSnapshot({ workspaceId, missionState, githubState = null, workers = [] } = {}) {
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new TypeError('workspaceId is required');
  if (!missionState || typeof missionState !== 'object') throw new TypeError('missionState is required');
  const workspaces = Array.isArray(missionState.workspaces) ? missionState.workspaces : [];
  const workspace = workspaces.find((item) => item.id === workspaceId) || null;
  if (!workspace) {
    return Object.freeze({
      workspaceId,
      workspace: null,
      found: false,
      missions: Object.freeze([]), workers: Object.freeze([]), humanGates: Object.freeze([]),
      agents: Object.freeze([]), installations: Object.freeze([]), providerSnapshots: Object.freeze([]),
      github: Object.freeze({ repositories: [], pullRequests: [], deliveryGates: [], deliveryEvidence: [] }),
      evidence: Object.freeze([]), events: Object.freeze([]),
    });
  }

  const s1 = missionState.s1 || {};
  const workerBindings = scoped(s1.workerBindings || [], workspaceId);
  const workerSummaries = stableSort(workers.map((worker) => workerSummary(worker, workspaceId, workerBindings)).filter(Boolean));
  const runs = stableSort(scoped(missionState.missionRuns || [], workspaceId));
  const github = githubState && typeof githubState === 'object' ? githubState : {};

  return Object.freeze({
    workspaceId,
    workspace: Object.freeze(sanitize(workspace)),
    found: true,
    projects: Object.freeze(stableSort(sanitizeList(scoped(s1.projects || [], workspaceId)))),
    missions: Object.freeze(runs.map((run) => summarizeMission(run, {
      missions: scoped(missionState.missions || [], workspaceId),
      plans: scoped(missionState.plans || [], workspaceId),
      stepAttempts: scoped(missionState.stepAttempts || [], workspaceId),
    }))),
    workers: Object.freeze(workerSummaries),
    humanGates: Object.freeze(stableSort(sanitizeList(scoped(missionState.humanGates || [], workspaceId)))),
    agents: Object.freeze(stableSort(sanitizeList(scoped(s1.agents || [], workspaceId)))),
    installations: Object.freeze(stableSort(sanitizeList(scoped(s1.installations || [], workspaceId)))),
    providerSnapshots: Object.freeze(stableSort(sanitizeList(scoped(s1.providerSnapshots || [], workspaceId)))),
    github: Object.freeze({
      repositories: Object.freeze(stableSort(sanitizeList(scoped(github.repositories || [], workspaceId)))),
      pullRequests: Object.freeze(stableSort(sanitizeList(scoped(github.pullRequestBindings || [], workspaceId)))),
      deliveryGates: Object.freeze(stableSort(sanitizeList(scoped(github.deliveryGates || [], workspaceId)))),
      deliveryEvidence: Object.freeze(stableSort(sanitizeList(scoped(github.deliveryEvidence || [], workspaceId)))),
    }),
    evidence: Object.freeze(stableSort(sanitizeList(scoped(missionState.evidence || [], workspaceId)))),
    events: Object.freeze(sanitizeList((missionState.missionEvents || []).filter((event) => event.workspaceId === workspaceId).slice(-100))),
  });
}

module.exports = { createOperatorCockpitSnapshot, sanitize };
