const assert = require('node:assert/strict');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const outputDirectory = resolve(
  process.env.AI_EXE_OS_MATRIX_OUTPUT
    || mkdtempSync(join(tmpdir(), 'ai-exe-os-recovery-matrix-')),
);
const userDataDirectory = join(outputDirectory, 'electron-user-data');
const runtimeRoot = join(userDataDirectory, 's0-runtime');
const eventFile = join(runtimeRoot, 'events.jsonl');
const resultFile = join(outputDirectory, 'matrix-result.json');
const consoleFile = join(outputDirectory, 'matrix-console.log');
const testPort = String(process.env.AI_EXE_OS_TEST_PORT || '43119');
const stableOrigin = `http://127.0.0.1:${testPort}`;
const persistPayload1 = 'persist-value-before-restart';
const persistPayload2 = 'persist-value-after-restart';
const delayedPayload = 'S0_DELAY_MS=12000\nforced-crash-payload';

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(userDataDirectory, { recursive: true });

const activeElectronPids = new Set();

const result = {
  status: 'RUNNING',
  outputDirectory,
  userDataDirectory,
  stableOrigin,
  phases: {},
  processOutput: [],
  rendererConsole: [],
  pageErrors: [],
  resourceSnapshots: {},
  error: null,
};

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readEvents() {
  if (!existsSync(eventFile)) return [];
  return readFileSync(eventFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function eventCount(type) {
  return readEvents().filter((event) => event.type === type).length;
}

function requireEvent(type, predicate = () => true) {
  const event = readEvents().find((candidate) => candidate.type === type && predicate(candidate));
  assert.ok(event, `Missing required event ${type}`);
  return event;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitFor(description, callback, timeout = 15_000, interval = 150) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`,
  );
}

function captureProcessStream(stream, source) {
  if (!stream) return;
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const line = String(chunk);
    result.processOutput.push({ source, line });
    process.stdout.write(`[${source}] ${line}`);
  });
}

function processTable() {
  if (process.platform !== 'darwin') return [];
  const output = execFileSync(
    'ps',
    ['-axo', 'pid=,ppid=,%cpu=,%mem=,rss=,etime=,command='],
    { encoding: 'utf8' },
  );
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        cpuPercent: Number(match[3]),
        memoryPercent: Number(match[4]),
        rssKb: Number(match[5]),
        elapsed: match[6],
        command: match[7],
      };
    })
    .filter(Boolean);
}

function relevantProcesses() {
  const table = processTable();
  const tracked = new Set(activeElectronPids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of table) {
      if (tracked.has(item.ppid) && !tracked.has(item.pid)) {
        tracked.add(item.pid);
        changed = true;
      }
    }
  }
  return table.filter(
    (item) => tracked.has(item.pid)
      || item.command.includes(userDataDirectory)
      || item.command.includes(join(runtimeRoot, 'profiles')),
  );
}

async function cleanupResidualProcesses() {
  if (process.platform !== 'darwin') return;
  const candidates = relevantProcesses()
    .filter((item) => item.pid !== process.pid)
    .sort((left, right) => right.pid - left.pid);
  for (const item of candidates) {
    try {
      process.kill(item.pid, 'SIGTERM');
    } catch {}
  }
  await sleep(1_000);
  for (const item of relevantProcesses().filter((candidate) => candidate.pid !== process.pid)) {
    try {
      process.kill(item.pid, 'SIGKILL');
    } catch {}
  }
}

function snapshotResources(name) {
  const processes = relevantProcesses();
  const snapshot = {
    capturedAt: new Date().toISOString(),
    processCount: processes.length,
    totalRssKb: processes.reduce((sum, item) => sum + item.rssKb, 0),
    totalCpuPercent: processes.reduce((sum, item) => sum + item.cpuPercent, 0),
    processes,
  };
  result.resourceSnapshots[name] = snapshot;
  writeJson(join(outputDirectory, `resources-${name}.json`), snapshot);
  return snapshot;
}

function profilePath(workerId) {
  return join(runtimeRoot, 'profiles', workerId);
}

function browserRootsForWorker(workerId) {
  const target = profilePath(workerId);
  const matching = processTable().filter((item) => item.command.includes(target));
  const matchingPids = new Set(matching.map((item) => item.pid));
  return matching.filter((item) => !matchingPids.has(item.ppid));
}

async function terminateBrowserForWorker(workerId) {
  assert.equal(process.platform, 'darwin', 'Browser process termination probe requires macOS');
  const roots = await waitFor(
    `browser process for ${workerId}`,
    () => {
      const candidates = browserRootsForWorker(workerId);
      return candidates.length ? candidates : null;
    },
    10_000,
  );
  result.phases.manualCloseProcess = roots;
  for (const item of roots) {
    process.kill(item.pid, 'SIGTERM');
  }
  return roots;
}

async function launchPhase(name) {
  const phase = {
    name,
    startedAt: new Date().toISOString(),
    bridge: null,
    pageErrors: [],
    console: [],
  };
  result.phases[name] = phase;

  const electronApp = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      AI_EXE_OS_USER_DATA_DIR: userDataDirectory,
      AI_EXE_OS_TEST_PORT: testPort,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    timeout: 30_000,
  });

  activeElectronPids.add(electronApp.process().pid);
  captureProcessStream(electronApp.process().stdout, `${name}:electron-stdout`);
  captureProcessStream(electronApp.process().stderr, `${name}:electron-stderr`);

  const page = await electronApp.firstWindow({ timeout: 30_000 });
  page.on('console', (message) => {
    const item = { phase: name, type: message.type(), text: message.text() };
    phase.console.push(item);
    result.rendererConsole.push(item);
  });
  page.on('pageerror', (error) => {
    phase.pageErrors.push(error.message);
    result.pageErrors.push({ phase: name, message: error.message });
  });
  await page.waitForLoadState('domcontentloaded');

  phase.bridge = await page.evaluate(() => ({
    type: typeof window.aiExecutionOS,
    methods: window.aiExecutionOS ? Object.keys(window.aiExecutionOS).sort() : [],
  }));
  assert.equal(phase.bridge.type, 'object', `${name}: preload bridge missing`);

  return { electronApp, page, phase };
}

async function state(page) {
  return page.evaluate(() => window.aiExecutionOS.getState());
}

async function closeGracefully(session) {
  if (!session?.electronApp) return;
  await session.electronApp.close();
  session.electronApp = null;
}

async function dismissRealConfirmation(page, taskTitle) {
  const before = eventCount('task.submission_started');
  await page.locator('#refresh').click();
  const card = page.locator('#tasks > div').filter({ hasText: taskTitle });
  await card.waitFor({ state: 'visible' });
  page.once('dialog', async (dialog) => dialog.dismiss());
  await card.getByRole('button', { name: /Review payload/ }).click();
  await sleep(500);
  const after = eventCount('task.submission_started');
  assert.equal(after, before, 'Dismissed confirmation caused a submission');
  return { before, after };
}

async function run() {
  let session;
  try {
    assert.equal(process.platform, 'darwin', 'Recovery matrix probe requires macOS');

    session = await launchPhase('phase1-seed');
    snapshotResources('idle');

    await session.page.evaluate(async () => {
      await window.aiExecutionOS.createWorker({
        id: 'matrix-chromium',
        projectId: 's0-recovery-matrix',
        role: 'implementation',
        browserChannel: 'chromium',
      });
      await window.aiExecutionOS.createWorker({
        id: 'matrix-chrome',
        projectId: 's0-recovery-matrix',
        role: 'review',
        browserChannel: 'chrome',
      });
      await window.aiExecutionOS.createTask({
        id: 'persist-task',
        projectId: 's0-recovery-matrix',
        title: 'Persist local storage across restart',
        payload: 'persist-value-before-restart',
      });
      await window.aiExecutionOS.createTask({
        id: 'cancel-task',
        projectId: 's0-recovery-matrix',
        title: 'Cancel local submission',
        payload: 'cancelled-payload',
      });
      await window.aiExecutionOS.createTask({
        id: 'crash-task',
        projectId: 's0-recovery-matrix',
        title: 'Recover active task after forced crash',
        payload: 'forced-crash-payload',
      });
    });

    result.phases.cancelConfirmation = await dismissRealConfirmation(
      session.page,
      'Cancel local submission',
    );

    await session.page.evaluate(() => window.aiExecutionOS.startWorker('matrix-chromium'));
    snapshotResources('one-worker');

    const firstSubmission = await session.page.evaluate(
      ({ payload }) => window.aiExecutionOS.confirmLocalTask({
        workerId: 'matrix-chromium',
        taskId: 'persist-task',
        payload,
      }),
      { payload: persistPayload1 },
    );
    assert.match(firstSubmission.result, /previous=<none>/);
    await session.page.evaluate(() => window.aiExecutionOS.stopWorker('matrix-chromium'));
    await session.page.screenshot({
      path: join(outputDirectory, 'phase1-operator-console.png'),
      fullPage: true,
    });
    await closeGracefully(session);
    session = null;

    session = await launchPhase('phase2-restart-dual');
    const recovered = await state(session.page);
    result.phases.phase2RecoveredState = recovered;
    assert.equal(
      recovered.workers.find((worker) => worker.id === 'matrix-chromium')?.status,
      'stopped',
      'Chromium worker did not rehydrate as stopped',
    );
    assert.equal(
      recovered.tasks.find((task) => task.id === 'persist-task')?.state,
      'waiting_human',
      'Persist task did not rehydrate as waiting_human',
    );

    await session.page.evaluate(() => window.aiExecutionOS.startWorker('matrix-chromium'));
    const secondSubmission = await session.page.evaluate(
      ({ payload }) => window.aiExecutionOS.confirmLocalTask({
        workerId: 'matrix-chromium',
        taskId: 'persist-task',
        payload,
      }),
      { payload: persistPayload2 },
    );
    assert.match(
      secondSubmission.result,
      new RegExp(`previous=${persistPayload1}`),
      'Cross-restart localStorage readback did not return the prior payload',
    );
    result.phases.crossRestartLocalStorage = secondSubmission.result;

    await session.page.evaluate(() => window.aiExecutionOS.startWorker('matrix-chrome'));
    const dualState = await state(session.page);
    result.phases.dualWorkerState = dualState;
    assert.equal(
      dualState.workers.find((worker) => worker.id === 'matrix-chromium')?.status,
      'waiting_human',
    );
    assert.equal(
      dualState.workers.find((worker) => worker.id === 'matrix-chrome')?.status,
      'idle',
    );
    snapshotResources('two-workers');

    await session.page.evaluate(() => window.aiExecutionOS.stopWorker('matrix-chrome'));
    const afterSelectedStop = await state(session.page);
    assert.notEqual(
      afterSelectedStop.workers.find((worker) => worker.id === 'matrix-chromium')?.status,
      'stopped',
      'Stopping Chrome incorrectly stopped Chromium',
    );
    result.phases.afterSelectedStop = afterSelectedStop;

    await terminateBrowserForWorker('matrix-chromium');
    await waitFor(
      'unexpected Chromium close reconciliation',
      async () => {
        const current = await state(session.page);
        return current.workers.find((worker) => worker.id === 'matrix-chromium')?.status === 'stopped';
      },
      20_000,
    );
    requireEvent(
      'worker.stopped',
      (event) => event.workerId === 'matrix-chromium'
        && event.reason === 'browser_context_closed',
    );

    await session.page.evaluate(() => window.aiExecutionOS.startWorker('matrix-chromium'));
    const restartedAfterClose = await state(session.page);
    assert.equal(
      restartedAfterClose.workers.find((worker) => worker.id === 'matrix-chromium')?.status,
      'idle',
      'Chromium worker did not restart after unexpected close',
    );
    result.phases.restartedAfterUnexpectedClose = restartedAfterClose;
    await session.page.evaluate(() => window.aiExecutionOS.stopWorker('matrix-chromium'));
    await session.page.screenshot({
      path: join(outputDirectory, 'phase2-operator-console.png'),
      fullPage: true,
    });
    await closeGracefully(session);
    session = null;

    session = await launchPhase('phase3-forced-crash');
    await session.page.evaluate(() => window.aiExecutionOS.startWorker('matrix-chromium'));
    const submissionsBeforeCrash = eventCount('task.submission_started');

    await session.page.evaluate(({ payload }) => {
      window.aiExecutionOS.confirmLocalTask({
        workerId: 'matrix-chromium',
        taskId: 'crash-task',
        payload,
      }).catch(() => {});
    }, { payload: delayedPayload });

    await waitFor(
      'active task and submission_started before forced crash',
      () => {
        const events = readEvents();
        const started = events.some(
          (event) => event.type === 'task.submission_started' && event.taskId === 'crash-task',
        );
        const active = [...events].reverse().find(
          (event) => event.type === 'task.snapshot' && event.task?.id === 'crash-task',
        )?.task?.state === 'active';
        return started && active;
      },
      10_000,
    );

    result.phases.beforeForcedCrash = {
      submissionsBeforeCrash,
      submissionsAtCrash: eventCount('task.submission_started'),
      electronPid: session.electronApp.process().pid,
      browserProcesses: browserRootsForWorker('matrix-chromium'),
    };
    snapshotResources('before-forced-crash');
    session.electronApp.process().kill('SIGKILL');
    await session.electronApp.waitForEvent('close', { timeout: 20_000 }).catch(() => {});
    session = null;
    await sleep(2_000);

    session = await launchPhase('phase4-crash-recovery');
    const crashRecovered = await state(session.page);
    result.phases.crashRecoveredState = crashRecovered;
    const crashTask = crashRecovered.tasks.find((task) => task.id === 'crash-task');
    assert.equal(crashTask?.state, 'waiting_human', 'Crash task did not recover to waiting_human');
    assert.equal(
      crashTask?.lastTransitionReason,
      'application_recovery_requires_review',
      'Crash recovery reason was not recorded',
    );
    assert.equal(
      crashRecovered.workers.find((worker) => worker.id === 'matrix-chromium')?.status,
      'stopped',
      'Worker did not recover as stopped after forced Electron termination',
    );

    const submissionsAfterRecovery = eventCount('task.submission_started');
    assert.equal(
      submissionsAfterRecovery,
      submissionsBeforeCrash + 1,
      'Application restart created an automatic duplicate submission',
    );
    result.phases.noDuplicateAfterCrash = {
      before: submissionsBeforeCrash,
      after: submissionsAfterRecovery,
    };

    await session.page.evaluate(() => window.aiExecutionOS.startWorker('matrix-chromium'));
    const afterStaleLeaseRecovery = await state(session.page);
    assert.equal(
      afterStaleLeaseRecovery.workers.find((worker) => worker.id === 'matrix-chromium')?.status,
      'idle',
      'Stale profile lease was not reclaimed after the recorded process died',
    );
    result.phases.afterStaleLeaseRecovery = afterStaleLeaseRecovery;
    await session.page.evaluate(() => window.aiExecutionOS.stopWorker('matrix-chromium'));
    await session.page.screenshot({
      path: join(outputDirectory, 'phase4-operator-console.png'),
      fullPage: true,
    });
    await closeGracefully(session);
    session = null;

    assert.equal(result.pageErrors.length, 0, 'Renderer page errors were observed');
    result.persistedEventCount = readEvents().length;
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL';
    result.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    process.exitCode = 1;
  } finally {
    if (session?.electronApp) {
      try {
        await session.electronApp.close();
      } catch {}
    }
    await cleanupResidualProcesses();
    result.finalResidualProcesses = relevantProcesses();
    writeFileSync(
      consoleFile,
      [
        ...result.rendererConsole.map(
          (item) => `[${item.phase}:${item.type}] ${item.text}`,
        ),
        ...result.pageErrors.map(
          (item) => `[${item.phase}:pageerror] ${item.message}`,
        ),
        ...result.processOutput.map(
          (item) => `[${item.source}] ${item.line}`,
        ),
      ].join('\n'),
      'utf8',
    );
    writeJson(resultFile, result);
    process.stdout.write(`S0 recovery matrix ${result.status}: ${resultFile}\n`);
  }
}

run();
