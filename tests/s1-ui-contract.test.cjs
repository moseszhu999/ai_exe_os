'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COMMAND_CHANNELS, QUERY_CHANNELS, assertS1Bridge, createS1Bridge } = require('../src/preload/s1-bridge-contract.cjs');
const { NAVIGATION, createS1ViewModel, sanitizeForDisplay } = require('../src/renderer/s1/view-model.cjs');
const { S1UiController } = require('../src/renderer/s1/controller.cjs');
const { renderS1App } = require('../src/renderer/s1/render.cjs');

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  walk() { return [this, ...this.children.flatMap((child) => child.walk())]; }
}

const document = { createElement: (tag) => new FakeElement(tag) };

function state() {
  return {
    workspaces: [
      { id: 'workspace-a', name: 'Workspace A', status: 'active' },
      { id: 'workspace-b', name: 'Workspace B', status: 'active' },
    ],
    marketplace: [{ id: 'local.form-submit', version: '1.0.0' }],
    installations: [
      { id: 'install-a', workspaceId: 'workspace-a' },
      { id: 'install-b', workspaceId: 'workspace-b' },
    ],
    agents: [
      { id: 'agent-a', workspaceId: 'workspace-a' },
      { id: 'agent-b', workspaceId: 'workspace-b' },
    ],
    workers: [{ id: 'worker-a', workspaceId: 'workspace-a' }],
    tasks: [
      { id: 'task-a', workspaceId: 'workspace-a', blockers: [{ code: 'human_gate_required' }] },
      { id: 'task-b', workspaceId: 'workspace-b', blockers: [] },
    ],
    graphs: [{ id: 'graph-a', workspaceId: 'workspace-a' }],
    executionRuns: [{ id: 'run-a', workspaceId: 'workspace-a', state: 'waiting_human' }],
    humanGates: [{
      id: 'gate-a', workspaceId: 'workspace-a', state: 'requested', agentId: 'agent-a', workerId: 'worker-a',
      capabilityAction: 'submit_payload', target: 'http://127.0.0.1:43119/task-form.html',
      payloadPreview: { message: 'hello', accessToken: 'must-not-render' },
    }],
    evidence: [{ id: 'evidence-a', workspaceId: 'workspace-a', type: 'local-result', taskId: 'task-a', executionRunId: 'run-a', workerId: 'worker-a' }],
    events: [{ id: 'event-a', workspaceId: 'workspace-a', type: 'execution.requested' }],
  };
}

test('preload bridge exposes only explicit S1 query and command channels', async () => {
  const calls = [];
  const bridge = createS1Bridge(async (channel, payload) => { calls.push({ channel, payload }); return { ok: true }; });
  assert.equal(assertS1Bridge(bridge), bridge);
  await bridge.queryState('workspace-a');
  await bridge.approveHumanGate({ gateId: 'gate-a' });
  assert.deepEqual(calls.map((call) => call.channel), [QUERY_CHANNELS.state, COMMAND_CHANNELS.approveHumanGate]);
  assert.equal(Object.keys(bridge).length, 6);
});

test('view model contains every S1 surface and isolates active Workspace data', () => {
  const model = createS1ViewModel(state(), 'workspace-a');
  assert.deepEqual(model.navigation, NAVIGATION);
  assert.equal(model.navigation.length, 10);
  assert.equal(model.agents.length, 1);
  assert.equal(model.agents[0].id, 'agent-a');
  assert.equal(model.tasks.some((task) => task.id === 'task-b'), false);
  assert.equal(model.counts.waitingHuman, 1);
  assert.equal(model.blockers[0].label, 'Human approval is required');
});

test('secret and browser profile fields are redacted before rendering', () => {
  const safe = sanitizeForDisplay({ password: 'secret', nested: { accessToken: 'token', profilePath: '/tmp/profile', normal: 'ok' } });
  assert.deepEqual(safe, { password: '[redacted]', nested: { accessToken: '[redacted]', profilePath: '[redacted]', normal: 'ok' } });
  const model = createS1ViewModel(state(), 'workspace-a');
  assert.equal(model.humanGates[0].payloadPreview.accessToken, '[redacted]');
});

test('controller collapses repeated approval clicks into one command', async () => {
  let approvals = 0;
  let queries = 0;
  let release;
  const pendingCommand = new Promise((resolve) => { release = resolve; });
  const bridge = {
    queryState: async () => { queries += 1; return state(); },
    installCapability: async () => ({}),
    grantCapability: async () => ({}),
    createTask: async () => ({}),
    rejectHumanGate: async () => ({}),
    approveHumanGate: async () => { approvals += 1; await pendingCommand; return { ok: true }; },
  };
  const controller = new S1UiController({ bridge });
  const first = controller.approveHumanGate({ workspaceId: 'workspace-a', gateId: 'gate-a' });
  const second = controller.approveHumanGate({ workspaceId: 'workspace-a', gateId: 'gate-a' });
  assert.equal(first, second);
  assert.equal(approvals, 0);
  await Promise.resolve();
  assert.equal(approvals, 1);
  release();
  await first;
  assert.equal(approvals, 1);
  assert.equal(queries, 1);
});

test('component renderer uses DOM construction, shows gate preview and binds distinct decisions', () => {
  const model = createS1ViewModel(state(), 'workspace-a');
  const actions = [];
  const controller = {
    rejectHumanGate: (input) => actions.push({ type: 'reject', input }),
    approveHumanGate: (input) => actions.push({ type: 'approve', input }),
  };
  const root = new FakeElement('root');
  const shell = renderS1App({ document, root, model, controller });
  const nodes = shell.walk();
  assert.equal(shell.dataset.workspaceId, 'workspace-a');
  assert.equal(nodes.filter((node) => node.className === 's1-nav-item').length, 10);
  const reject = nodes.find((node) => node.className === 's1-reject');
  const approve = nodes.find((node) => node.className === 's1-approve');
  assert.ok(reject && approve);
  reject.listeners.click();
  approve.listeners.click();
  assert.deepEqual(actions.map((item) => item.type), ['reject', 'approve']);
  const renderedText = nodes.map((node) => node.textContent).join('\n');
  assert.equal(renderedText.includes('must-not-render'), false);
  assert.equal(renderedText.includes('[redacted]'), true);
  assert.equal(renderedText.includes('task-a / run-a / worker-a'), true);
});
