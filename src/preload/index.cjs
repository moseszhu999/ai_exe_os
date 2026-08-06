const { contextBridge, ipcRenderer } = require('electron');

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
}));
