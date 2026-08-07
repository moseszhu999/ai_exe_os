const { contextBridge, ipcRenderer } = require('electron');

function s2Input(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('S2 command payload must be a plain object');
  }
  return input;
}

function s3Input(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('S3 GitHub delivery command payload must be a plain object');
  }
  return input;
}

function s4Input(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('S4 console command payload must be a plain object');
  }
  return input;
}

const s2Mission = Object.freeze({
  queryState: (workspaceId) => ipcRenderer.invoke('s2:mission:query-state', workspaceId || null),
  createMission: (input) => ipcRenderer.invoke('s2:mission:create', s2Input(input)),
  createRevision: (input) => ipcRenderer.invoke('s2:mission:create-revision', s2Input(input)),
  startMission: (input) => ipcRenderer.invoke('s2:mission:start', s2Input(input)),
  pauseMission: (input) => ipcRenderer.invoke('s2:mission:pause', s2Input(input)),
  resumeMission: (input) => ipcRenderer.invoke('s2:mission:resume', s2Input(input)),
  cancelMission: (input) => ipcRenderer.invoke('s2:mission:cancel', s2Input(input)),
  retryStepAfterReview: (input) => ipcRenderer.invoke('s2:mission:retry-step-after-review', s2Input(input)),
  recordCheckpoint: (input) => ipcRenderer.invoke('s2:mission:record-checkpoint', s2Input(input)),
});

const s3Github = Object.freeze({
  queryState: (workspaceId) => ipcRenderer.invoke('s3:github:query-state', workspaceId || null),
  registerRepository: (input) => ipcRenderer.invoke('s3:github:repository:register', s3Input(input)),
  reserveBranch: (input) => ipcRenderer.invoke('s3:github:branch:reserve', s3Input(input)),
  claimPaths: (input) => ipcRenderer.invoke('s3:github:paths:claim', s3Input(input)),
  bindPullRequest: (input) => ipcRenderer.invoke('s3:github:pr:bind', s3Input(input)),
  observeDelivery: (input) => ipcRenderer.invoke('s3:github:delivery:observe', s3Input(input)),
  createRepairProposal: (input) => ipcRenderer.invoke('s3:github:repair:propose', s3Input(input)),
});

const s4Console = Object.freeze({
  query: (workspaceId) => ipcRenderer.invoke('s4:console:query', workspaceId || null),
  focusWorker: (input) => ipcRenderer.invoke('s4:console:worker:focus', s4Input(input)),
  stopWorker: (input) => ipcRenderer.invoke('s4:console:worker:stop', s4Input(input)),
  pauseWorker: (input) => ipcRenderer.invoke('s4:console:worker:pause', s4Input(input)),
  resumeWorker: (input) => ipcRenderer.invoke('s4:console:worker:resume', s4Input(input)),
});

contextBridge.exposeInMainWorld('aiExecutionOS', Object.freeze({
  getState: () => ipcRenderer.invoke('state:list'),
  createWorker: (input) => ipcRenderer.invoke('worker:create', input),
  startWorker: (workerId) => ipcRenderer.invoke('worker:start', workerId),
  stopWorker: (workerId) => ipcRenderer.invoke('worker:stop', workerId),
  focusWorker: (workerId) => ipcRenderer.invoke('worker:focus', workerId),
  pauseWorker: (workerId) => ipcRenderer.invoke('worker:pause', workerId),
  resumeWorker: (workerId) => ipcRenderer.invoke('worker:resume', workerId),
  createTask: (input) => ipcRenderer.invoke('task:create', input),
  confirmLocalTask: (input) => ipcRenderer.invoke('task:confirm-local', input),
  observePullRequest: (input) => ipcRenderer.invoke('github:observe-pr', input),
  s1: Object.freeze({
    queryState: (workspaceId) => ipcRenderer.invoke('s1:state', { workspaceId }),
    installCapability: (input) => ipcRenderer.invoke('s1:marketplace:install', input),
    grantCapability: (input) => ipcRenderer.invoke('s1:agent:grant', input),
    createTask: (input) => ipcRenderer.invoke('s1:task:create', input),
    rejectHumanGate: (input) => ipcRenderer.invoke('s1:human-gate:reject', input),
    approveHumanGate: (input) => ipcRenderer.invoke('s1:human-gate:approve', input),
  }),
  s2: Object.freeze({ mission: s2Mission }),
  s3: Object.freeze({ github: s3Github }),
  s4: Object.freeze({ console: s4Console }),
}));
