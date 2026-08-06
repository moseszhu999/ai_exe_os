const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { _electron: electron } = require('playwright');

const outputDirectory = resolve(
  process.env.AI_EXE_OS_PROBE_OUTPUT
    || mkdtempSync(join(tmpdir(), 'ai-exe-os-ipc-probe-')),
);
const userDataDirectory = join(outputDirectory, 'electron-user-data');
const eventFile = join(userDataDirectory, 's0-runtime', 'events.jsonl');
const resultFile = join(outputDirectory, 'probe-result.json');
const consoleFile = join(outputDirectory, 'renderer-console.log');
const screenshotFile = join(outputDirectory, 'operator-console.png');

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(userDataDirectory, { recursive: true });

const result = {
  status: 'RUNNING',
  outputDirectory,
  userDataDirectory,
  bridge: null,
  states: {},
  rendererConsole: [],
  pageErrors: [],
  processOutput: [],
  error: null,
};

function captureProcessStream(stream, source) {
  if (!stream) return;
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const line = String(chunk);
    result.processOutput.push({ source, line });
    process.stdout.write(`[${source}] ${line}`);
  });
}

function readEvents() {
  if (!existsSync(eventFile)) return [];
  return readFileSync(eventFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function requireEventTypes(events, requiredTypes) {
  const types = new Set(events.map((event) => event.type));
  for (const type of requiredTypes) {
    assert.ok(types.has(type), `Missing required runtime event: ${type}`);
  }
}

async function run() {
  let electronApp;
  let page;
  try {
    electronApp = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        AI_EXE_OS_USER_DATA_DIR: userDataDirectory,
        AI_EXE_OS_TEST_PORT: process.env.AI_EXE_OS_TEST_PORT || '43119',
        ELECTRON_ENABLE_LOGGING: '1',
      },
      timeout: 30_000,
    });

    const child = electronApp.process();
    captureProcessStream(child.stdout, 'electron-stdout');
    captureProcessStream(child.stderr, 'electron-stderr');

    page = await electronApp.firstWindow({ timeout: 30_000 });
    page.on('console', (message) => {
      const item = { type: message.type(), text: message.text() };
      result.rendererConsole.push(item);
      process.stdout.write(`[renderer:${item.type}] ${item.text}\n`);
    });
    page.on('pageerror', (error) => {
      result.pageErrors.push(error.message);
      process.stderr.write(`[renderer-error] ${error.stack || error.message}\n`);
    });

    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: screenshotFile, fullPage: true });

    result.bridge = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      bridgeType: typeof window.aiExecutionOS,
      methods: window.aiExecutionOS ? Object.keys(window.aiExecutionOS).sort() : [],
    }));

    assert.equal(result.bridge.bridgeType, 'object', 'Preload bridge window.aiExecutionOS is unavailable');
    for (const method of ['getState', 'createWorker', 'startWorker', 'createTask', 'confirmLocalTask']) {
      assert.ok(result.bridge.methods.includes(method), `Preload bridge is missing ${method}`);
    }

    result.states.initial = await page.evaluate(() => window.aiExecutionOS.getState());

    await page.evaluate(async () => {
      await window.aiExecutionOS.createWorker({
        id: 'probe-chromium',
        projectId: 's0-runtime-probe',
        role: 'review',
        browserChannel: 'chromium',
      });
      await window.aiExecutionOS.createTask({
        id: 'probe-task',
        projectId: 's0-runtime-probe',
        title: 'Verify renderer preload IPC chain',
        payload: 'authorized local IPC probe payload',
      });
    });

    result.states.afterCreate = await page.evaluate(() => window.aiExecutionOS.getState());
    requireEventTypes(result.states.afterCreate.events, ['worker.created', 'task.snapshot']);

    await page.evaluate(() => window.aiExecutionOS.startWorker('probe-chromium'));
    result.states.afterStart = await page.evaluate(() => window.aiExecutionOS.getState());
    requireEventTypes(result.states.afterStart.events, ['worker.ready']);
    assert.equal(
      result.states.afterStart.workers.find((worker) => worker.id === 'probe-chromium')?.status,
      'idle',
      'Chromium worker did not reach idle',
    );

    await page.evaluate(async () => {
      await window.aiExecutionOS.focusWorker('probe-chromium');
      await window.aiExecutionOS.pauseWorker('probe-chromium');
      await window.aiExecutionOS.resumeWorker('probe-chromium');
      await window.aiExecutionOS.confirmLocalTask({
        workerId: 'probe-chromium',
        taskId: 'probe-task',
        payload: 'authorized local IPC probe payload',
      });
    });

    result.states.afterSubmission = await page.evaluate(() => window.aiExecutionOS.getState());
    requireEventTypes(result.states.afterSubmission.events, [
      'worker.focused',
      'worker.paused',
      'worker.resumed',
      'task.submission_started',
      'task.local_result_observed',
    ]);
    assert.equal(
      result.states.afterSubmission.tasks.find((task) => task.id === 'probe-task')?.state,
      'waiting_human',
      'Probe task did not return to waiting_human',
    );

    await page.evaluate(() => window.aiExecutionOS.stopWorker('probe-chromium'));
    result.states.afterStop = await page.evaluate(() => window.aiExecutionOS.getState());
    requireEventTypes(result.states.afterStop.events, ['worker.stopped']);

    await page.screenshot({ path: screenshotFile, fullPage: true });
    await electronApp.close();
    electronApp = null;

    const persistedEvents = readEvents();
    requireEventTypes(persistedEvents, [
      'worker.created',
      'worker.ready',
      'task.snapshot',
      'task.submission_started',
      'task.local_result_observed',
      'worker.stopped',
    ]);
    result.persistedEventCount = persistedEvents.length;
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL';
    result.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if (page) {
      try {
        result.rendererHtml = await page.content();
        await page.screenshot({ path: screenshotFile, fullPage: true });
      } catch {}
    }
    process.exitCode = 1;
  } finally {
    if (electronApp) {
      try {
        await electronApp.close();
      } catch {}
    }
    writeFileSync(consoleFile, [
      ...result.rendererConsole.map((item) => `[${item.type}] ${item.text}`),
      ...result.pageErrors.map((message) => `[pageerror] ${message}`),
      ...result.processOutput.map((item) => `[${item.source}] ${item.line}`),
    ].join('\n'), 'utf8');
    writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`S0 IPC probe ${result.status}: ${resultFile}\n`);
  }
}

run();
