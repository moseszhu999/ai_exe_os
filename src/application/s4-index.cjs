'use strict';

const { S3ApplicationService } = require('./s3-index.cjs');
const { createOperatorCockpitSnapshot } = require('../operator-console/read-model/operator-cockpit.cjs');
const { readManagementCeoPortfolioSurface } = require('../operator-console/read-model/management-ceo-portfolio.cjs');
const { createEvidenceLineage } = require('../operator-console/explanation/lineage.cjs');
const { aggregateAttention } = require('../operator-console/attention/attention-inbox.cjs');
const { WorkerSessionControlAdapter } = require('../operator-console/control/worker-session-control.cjs');

class S4ApplicationService extends S3ApplicationService {
  constructor(options = {}) {
    super(options);
    if (options.groupCeoPortfolioBriefReader != null && typeof options.groupCeoPortfolioBriefReader !== 'function') {
      throw new TypeError('groupCeoPortfolioBriefReader must be a function');
    }
    if (options.groupCeoPortfolioBriefReader != null
      && (typeof options.groupManagementWorkspaceId !== 'string' || !options.groupManagementWorkspaceId.trim())) {
      throw new TypeError('groupManagementWorkspaceId is required when Group CEO portfolio reader is configured');
    }
    this.groupCeoPortfolioBriefReader = options.groupCeoPortfolioBriefReader || null;
    this.groupManagementWorkspaceId = options.groupManagementWorkspaceId?.trim() || null;
    this.s4WorkerControl = new WorkerSessionControlAdapter({
      workerManager: this.workerManager,
      resolveWorkspaceId: (workerId) => {
        const binding = this.workerBinding.list().find((item) => item.id === workerId || item.workerId === workerId);
        return binding?.workspaceId || null;
      },
    });
  }

  cockpitMissionState(workspaceId, missionState) {
    const workspace = this.workspace.get(workspaceId);
    const s1 = missionState.s1 || {};
    return Object.freeze({
      ...missionState,
      s1: Object.freeze({
        ...s1,
        projects: (s1.projects || []).map((project) => Object.freeze({ ...project, workspaceId })),
        workerBindings: this.workerBinding.list().filter((item) => item.workspaceId === workspaceId),
        providerSnapshots: this.providerSnapshot.list().map((snapshot) => Object.freeze({ ...snapshot, workspaceId })),
        workspace: workspace ? Object.freeze({ ...workspace }) : null,
      }),
    });
  }

  queryOperatorCockpit(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new TypeError('workspaceId is required');
    if (!this.workspace.get(workspaceId)) {
      const empty = createOperatorCockpitSnapshot({ workspaceId, missionState: { workspaces: [] }, githubState: {}, workers: [] });
      return Object.freeze({ ...empty, attention: Object.freeze([]), lineage: Object.freeze({}) });
    }
    const githubState = this.queryGitHubDeliveryState(workspaceId);
    const missionState = this.cockpitMissionState(workspaceId, githubState.s2);
    const base = createOperatorCockpitSnapshot({
      workspaceId,
      missionState,
      githubState,
      workers: this.workerManager.list(),
    });
    const attention = aggregateAttention({ workspaceId, missionState, githubState });
    const lineage = Object.fromEntries(attention.map((item) => [item.id, createEvidenceLineage({ attentionItem: item, missionState, githubState })]));
    const managementPortfolio = readManagementCeoPortfolioSurface({
      workspaceId,
      groupManagementWorkspaceId: this.groupManagementWorkspaceId,
      groupCeoPortfolioBriefReader: this.groupCeoPortfolioBriefReader,
    });
    return Object.freeze({
      ...base,
      attention,
      lineage: Object.freeze(lineage),
      ...(managementPortfolio ? { managementPortfolio } : {}),
    });
  }

  async controlWorker(action, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Worker control input must be an object');
    const method = { focus: 'focus', stop: 'stop', pause: 'pause', resume: 'resume' }[action];
    if (!method) throw new Error(`Unsupported S4 Worker control: ${action}`);
    const result = await this.s4WorkerControl[method](input);
    return Object.freeze({ result, cockpit: this.queryOperatorCockpit(input.workspaceId) });
  }

  focusWorker(input) { return this.controlWorker('focus', input); }
  stopWorker(input) { return this.controlWorker('stop', input); }
  pauseWorker(input) { return this.controlWorker('pause', input); }
  resumeWorker(input) { return this.controlWorker('resume', input); }
}

module.exports = { S4ApplicationService };
