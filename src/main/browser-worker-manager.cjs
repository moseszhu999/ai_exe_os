const { mkdirSync } = require('node:fs');
const { createWorkerRecord, setWorkerStatus } = require('../domain/worker-record.cjs');

class BrowserWorkerManager {
  constructor({ profilesRoot, leaseManager, eventStore, testBaseUrl, playwrightLoader = () => require('playwright') }) {
    this.profilesRoot = profilesRoot;
    this.leaseManager = leaseManager;
    this.eventStore = eventStore;
    this.testBaseUrl = testBaseUrl;
    this.playwrightLoader = playwrightLoader;
    this.workers = new Map();
    this.contexts = new Map();
    this.rehydrate();
  }

  rehydrate() {
    const records = new Map();
    for (const event of this.eventStore.readAll()) {
      if (event.type === 'worker.created' && event.workerId) {
        const profilePath = require('node:path').join(this.profilesRoot, event.workerId);
        records.set(event.workerId, createWorkerRecord({
          id: event.workerId,
          projectId: event.projectId,
          role: event.role,
          profilePath,
          browserChannel: event.browserChannel || 'chrome',
        }));
      }
      if (!event.workerId || !records.has(event.workerId)) continue;
      const current = records.get(event.workerId);
      if (event.type === 'worker.stopped') records.set(event.workerId, setWorkerStatus(current, 'stopped'));
      if (event.type === 'worker.failed') records.set(event.workerId, setWorkerStatus(current, 'failed'));
    }
    for (const [workerId, record] of records) {
      if (!['stopped', 'failed'].includes(record.status)) {
        records.set(workerId, setWorkerStatus(record, 'stopped'));
      }
    }
    this.workers = records;
  }

  list() {
    return [...this.workers.values()].map((worker) => ({ ...worker }));
  }

  create({ id, projectId, role, browserChannel = process.env.AI_EXE_OS_BROWSER_CHANNEL || 'chrome' }) {
    if (this.workers.has(id)) return { ...this.workers.get(id) };
    const profilePath = require('node:path').join(this.profilesRoot, id);
    mkdirSync(profilePath, { recursive: true });
    const record = createWorkerRecord({ id, projectId, role, profilePath, browserChannel });
    this.workers.set(id, record);
    this.eventStore.append({ type: 'worker.created', workerId: id, projectId, role, browserChannel });
    return { ...record };
  }

  async start(workerId) {
    const current = this.requireWorker(workerId);
    if (this.contexts.has(workerId)) return { ...current };
    this.workers.set(workerId, setWorkerStatus(current, 'starting'));
    this.leaseManager.acquire({ profilePath: current.profilePath, workerId });

    let context = null;
    try {
      const { chromium } = this.playwrightLoader();
      const options = {
        headless: false,
        viewport: null,
        chromiumSandbox: true,
      };
      if (current.browserChannel) options.channel = current.browserChannel;
      context = await chromium.launchPersistentContext(current.profilePath, options);
      const pages = context.pages();
      const page = pages[0] || await context.newPage();
      this.contexts.set(workerId, { context, page });
      this.bindContextLifecycle(workerId, context);
      await page.goto(`${this.testBaseUrl}/task-form.html`);
      const next = setWorkerStatus(current, 'idle', {
        processId: process.pid,
        lastKnownUrl: page.url(),
      });
      this.workers.set(workerId, next);
      this.eventStore.append({ type: 'worker.ready', workerId, url: page.url() });
      return { ...next };
    } catch (error) {
      this.contexts.delete(workerId);
      if (context) await context.close().catch(() => {});
      this.leaseManager.release({ profilePath: current.profilePath, workerId });
      const failed = setWorkerStatus(current, 'failed');
      this.workers.set(workerId, failed);
      this.eventStore.append({ type: 'worker.failed', workerId, message: error.message });
      throw error;
    }
  }

  bindContextLifecycle(workerId, context) {
    if (!context || typeof context.on !== 'function') return;
    context.on('close', () => {
      const session = this.contexts.get(workerId);
      if (!session || session.context !== context) return;

      this.contexts.delete(workerId);
      const current = this.workers.get(workerId);
      if (!current) return;

      let releaseError = null;
      try {
        this.leaseManager.release({ profilePath: current.profilePath, workerId });
      } catch (error) {
        releaseError = error;
      }

      const stopped = setWorkerStatus(current, 'stopped', {
        processId: null,
        activeTaskId: null,
      });
      this.workers.set(workerId, stopped);
      this.eventStore.append({
        type: 'worker.stopped',
        workerId,
        reason: 'browser_context_closed',
        ...(releaseError ? { leaseReleaseError: releaseError.message } : {}),
      });
    });
  }

  async focus(workerId) {
    const session = this.requireSession(workerId);
    await session.page.bringToFront();
    this.eventStore.append({ type: 'worker.focused', workerId });
    return { ...this.requireWorker(workerId) };
  }

  pause(workerId) {
    const current = this.requireWorker(workerId);
    if (!this.contexts.has(workerId)) throw new Error(`Worker ${workerId} is not running`);
    const next = setWorkerStatus(current, 'paused');
    this.workers.set(workerId, next);
    this.eventStore.append({ type: 'worker.paused', workerId });
    return { ...next };
  }

  resume(workerId) {
    const current = this.requireWorker(workerId);
    if (!this.contexts.has(workerId)) throw new Error(`Worker ${workerId} is not running`);
    const next = setWorkerStatus(current, 'idle');
    this.workers.set(workerId, next);
    this.eventStore.append({ type: 'worker.resumed', workerId });
    return { ...next };
  }

  async submitAuthorizedLocalTask({ workerId, taskId, payload }) {
    const current = this.requireWorker(workerId);
    if (current.status === 'paused') throw new Error(`Worker ${workerId} is paused`);
    const session = this.requireSession(workerId);
    const active = setWorkerStatus(current, 'active', { activeTaskId: taskId });
    this.workers.set(workerId, active);
    this.eventStore.append({ type: 'task.submission_started', workerId, taskId, target: 'local-test-page' });

    try {
      await session.page.goto(`${this.testBaseUrl}/task-form.html`);
      await session.page.fill('#task-input', payload);
      await session.page.click('#submit-task');
      await session.page.waitForSelector('#result[data-ready="true"]');
      const result = await session.page.textContent('#result');

      const waiting = setWorkerStatus(active, 'waiting_human', {
        activeTaskId: taskId,
        lastKnownUrl: session.page.url(),
      });
      this.workers.set(workerId, waiting);
      this.eventStore.append({
        type: 'task.local_result_observed',
        workerId,
        taskId,
        evidence: { resultText: result, provider: 'local-project-owned-test-surface' },
      });
      return { worker: { ...waiting }, result };
    } catch (error) {
      const uncertain = setWorkerStatus(active, 'waiting_human', {
        activeTaskId: taskId,
        lastKnownUrl: session.page.url(),
      });
      this.workers.set(workerId, uncertain);
      this.eventStore.append({
        type: 'task.local_submission_uncertain',
        workerId,
        taskId,
        message: error.message,
      });
      throw error;
    }
  }

  async stop(workerId) {
    const current = this.requireWorker(workerId);
    const session = this.contexts.get(workerId);
    let closeError = null;
    let releaseError = null;

    if (session) {
      this.contexts.delete(workerId);
      try {
        await session.context.close();
      } catch (error) {
        closeError = error;
      }
    }

    try {
      this.leaseManager.release({ profilePath: current.profilePath, workerId });
    } catch (error) {
      releaseError = error;
    }

    const next = setWorkerStatus(current, 'stopped', { processId: null, activeTaskId: null });
    this.workers.set(workerId, next);
    this.eventStore.append({
      type: 'worker.stopped',
      workerId,
      reason: 'operator_stop',
      ...(closeError ? { contextCloseError: closeError.message } : {}),
      ...(releaseError ? { leaseReleaseError: releaseError.message } : {}),
    });

    if (closeError || releaseError) {
      throw new AggregateError(
        [closeError, releaseError].filter(Boolean),
        `Worker ${workerId} stopped with cleanup errors`,
      );
    }
    return { ...next };
  }

  async stopAll() {
    for (const workerId of [...this.contexts.keys()]) {
      await this.stop(workerId);
    }
  }

  requireWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Unknown worker: ${workerId}`);
    return worker;
  }

  requireSession(workerId) {
    const session = this.contexts.get(workerId);
    if (!session) throw new Error(`Worker ${workerId} is not running`);
    return session;
  }
}

module.exports = { BrowserWorkerManager };
