const { contextBridge, ipcRenderer } = require('electron');
const { createS2BridgeContract } = require('./s2-bridge-contract.cjs');

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
  s2: Object.freeze({
    mission: createS2BridgeContract(ipcRenderer),
  }),
}));
