const { app, BrowserWindow, ipcMain } = require('electron');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync } = require('node:fs');
const { LocalTestServer } = require('./local-test-server.cjs');
const { JsonlEventStore } = require('./event-store.cjs');
const { ProfileLeaseManager } = require('./profile-lease-manager.cjs');
const { BrowserWorkerManager } = require('./browser-worker-manager.cjs');
const { TaskRepository } = require('./task-repository.cjs');
const { GitHubReadOnlyAdapter } = require('./github-readonly-adapter.cjs');
const { GitHubStateObserver } = require('./github-state-observer.cjs');
const { S1ApplicationService } = require('../application/index.cjs');
const { registerS1Ipc } = require('../application/s1-ipc.cjs');

app.enableSandbox();

function configuredTestPort() {
  const raw = process.env.AI_EXE_OS_TEST_PORT || '43119';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new RangeError('AI_EXE_OS_TEST_PORT must be an integer from 1024 to 65535');
  }
  return port;
}

if (process.env.AI_EXE_OS_USER_DATA_DIR) {
  app.setPath('userData', resolve(process.env.AI_EXE_OS_USER_DATA_DIR));
}

let mainWindow;
let testServer;
let eventStore;
let workerManager;
let githubObserver;
let taskRepository;
let s1Service;

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
    return { workers: workerManager.list(), tasks: taskRepository.list(), events: eventStore.readAll().slice(-100) };
  });

  ipcMain.handle('worker:create', (event, input) => {
    assertSender(event);
    return workerManager.create(safeInputObject(input));
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
    return taskRepository.create(safeInputObject(input));
  });

  ipcMain.handle('github:observe-pr', async (event, input) => {
    assertSender(event);
    return githubObserver.observePullRequest(safeInputObject(input));
  });

  ipcMain.handle('task:confirm-local', async (event, input) => {
    assertSender(event);
    const value = safeInputObject(input);
    const active = taskRepository.transition(value.taskId, 'active', { reason: 'human_confirmed' });
    try {
      const execution = await workerManager.submitAuthorizedLocalTask({
        workerId: value.workerId,
        taskId: active.id,
        payload: String(value.payload || ''),
      });
      const waiting = taskRepository.transition(active.id, 'waiting_human', { reason: 'local_result_requires_review' });
      return { task: waiting, execution };
    } catch (error) {
      taskRepository.transition(active.id, 'waiting_human', { reason: 'local_submission_uncertain' });
      throw error;
    }
  });

  registerS1Ipc({ ipcMain, assertSender, service: s1Service });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 940,
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
  const userDataRoot = app.getPath('userData');
  const runtimeRoot = join(userDataRoot, 's0-runtime');
  mkdirSync(runtimeRoot, { recursive: true });
  eventStore = new JsonlEventStore(join(runtimeRoot, 'events.jsonl'));
  taskRepository = new TaskRepository({ eventStore });
  taskRepository.recoverUncertain();

  testServer = new LocalTestServer({
    rootDirectory: join(__dirname, '..', '..', 'test-pages'),
    port: configuredTestPort(),
  });
  const testBaseUrl = await testServer.start();
  workerManager = new BrowserWorkerManager({
    profilesRoot: join(runtimeRoot, 'profiles'),
    leaseManager: new ProfileLeaseManager(),
    eventStore,
    testBaseUrl,
  });

  const s1RuntimeRoot = join(userDataRoot, 's1-runtime');
  mkdirSync(s1RuntimeRoot, { recursive: true });
  s1Service = new S1ApplicationService({
    databasePath: join(s1RuntimeRoot, 'state.sqlite'),
    workerManager,
    localTarget: `${testBaseUrl}/task-form.html`,
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
    s1Service?.close();
  } finally {
    app.exit(0);
  }
});

app.on('window-all-closed', () => app.quit());
