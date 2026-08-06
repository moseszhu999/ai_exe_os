const { app, BrowserWindow, ipcMain } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync } = require('node:fs');
const { LocalTestServer } = require('./local-test-server.cjs');
const { JsonlEventStore } = require('./event-store.cjs');
const { ProfileLeaseManager } = require('./profile-lease-manager.cjs');
const { BrowserWorkerManager } = require('./browser-worker-manager.cjs');
const { createTask, transitionTask } = require('../domain/task-state.cjs');
const { GitHubReadOnlyAdapter } = require('./github-readonly-adapter.cjs');
const { GitHubStateObserver } = require('./github-state-observer.cjs');

app.enableSandbox();

let mainWindow;
let testServer;
let eventStore;
let workerManager;
let githubObserver;
const tasks = new Map();

function rendererPath() {
  return join(__dirname, '..', 'renderer', 'index.html');
}

function validateSender(event) {
  const expected = pathToFileURL(rendererPath()).href;
  return event.senderFrame?.url === expected;
}

function assertSender(event) {
  if (!validateSender(event)) throw new Error('Rejected IPC from untrusted sender');
}

function safeInputObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Expected an object payload');
  }
  return input;
}

function registerIpc() {
  ipcMain.handle('state:list', (event) => {
    assertSender(event);
    return { workers: workerManager.list(), tasks: [...tasks.values()], events: eventStore.readAll().slice(-100) };
  });

  ipcMain.handle('worker:create', (event, input) => {
    assertSender(event);
    const value = safeInputObject(input);
    return workerManager.create(value);
  });
  ipcMain.handle('worker:start', async (event, workerId) => {
    assertSender(event);
    return workerManager.start(String(workerId));
  });
  ipcMain.handle('worker:stop', async (event, workerId) => {
    assertSender(event);
    return workerManager.stop(String(workerId));
  });
  ipcMain.handle('worker:focus', async (event, workerId) => {
    assertSender(event);
    return workerManager.focus(String(workerId));
  });
  ipcMain.handle('worker:pause', (event, workerId) => {
    assertSender(event);
    return workerManager.pause(String(workerId));
  });
  ipcMain.handle('worker:resume', (event, workerId) => {
    assertSender(event);
    return workerManager.resume(String(workerId));
  });

  ipcMain.handle('task:create', (event, input) => {
    assertSender(event);
    const value = safeInputObject(input);
    let task = createTask(value);
    task = transitionTask(task, 'queued', { reason: 'operator_created' });
    task = transitionTask(task, 'ready', { reason: 'no_dependencies' });
    if (tasks.has(task.id)) throw new Error(`Task already exists: ${task.id}`);
    tasks.set(task.id, task);
    eventStore.append({ type: 'task.ready', taskId: task.id, projectId: task.projectId });
    return task;
  });

  ipcMain.handle('github:observe-pr', async (event, input) => {
    assertSender(event);
    return githubObserver.observePullRequest(safeInputObject(input));
  });

  ipcMain.handle('task:confirm-local', async (event, input) => {
    assertSender(event);
    const value = safeInputObject(input);
    const current = tasks.get(value.taskId);
    if (!current) throw new Error(`Unknown task: ${value.taskId}`);
    const active = transitionTask(current, 'active', { reason: 'human_confirmed' });
    tasks.set(active.id, active);
    const execution = await workerManager.submitAuthorizedLocalTask({
      workerId: value.workerId,
      taskId: active.id,
      payload: String(value.payload || ''),
    });
    const waiting = transitionTask(active, 'waiting_human', { reason: 'local_result_requires_review' });
    tasks.set(waiting.id, waiting);
    return { task: waiting, execution };
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(rendererPath()).href) event.preventDefault();
  });
  await mainWindow.loadFile(rendererPath());
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(async () => {
  const runtimeRoot = join(app.getPath('userData'), 's0-runtime');
  mkdirSync(runtimeRoot, { recursive: true });
  eventStore = new JsonlEventStore(join(runtimeRoot, 'events.jsonl'));
  testServer = new LocalTestServer({ rootDirectory: join(__dirname, '..', '..', 'test-pages') });
  const testBaseUrl = await testServer.start();
  workerManager = new BrowserWorkerManager({
    profilesRoot: join(runtimeRoot, 'profiles'),
    leaseManager: new ProfileLeaseManager(),
    eventStore,
    testBaseUrl,
  });
  githubObserver = new GitHubStateObserver({
    adapter: new GitHubReadOnlyAdapter({ token: process.env.AI_EXE_OS_GITHUB_TOKEN || null }),
    eventStore,
  });
  registerIpc();
  await createMainWindow();
});

app.on('before-quit', async (event) => {
  if (!workerManager) return;
  event.preventDefault();
  try {
    await workerManager.stopAll();
    await testServer?.stop();
  } finally {
    app.exit(0);
  }
});

app.on('window-all-closed', () => app.quit());
