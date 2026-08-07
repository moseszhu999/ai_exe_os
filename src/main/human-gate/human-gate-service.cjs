'use strict';

class HumanGateService {
  constructor({ repository, clock = () => new Date().toISOString() }) {
    if (!repository?.get || !repository?.save) throw new TypeError('Human Gate repository is required');
    this.repository = repository;
    this.clock = clock;
  }

  request(input) {
    const existing = this.repository.get(input.id);
    if (existing) {
      const comparable = ['workspaceId', 'taskId', 'executionRunId', 'actionClass', 'workerId', 'capabilityAction', 'target'];
      const same = comparable.every((key) => existing[key] === String(input[key]))
        && JSON.stringify(existing.payloadPreview) === JSON.stringify(input.payloadPreview || {})
        && JSON.stringify(existing.evidenceExpected) === JSON.stringify(input.evidenceExpected || []);
      if (!same) throw new Error(`Human Gate idempotency collision: ${input.id}`);
      return Object.freeze({ created: false, gate: existing });
    }
    const gate = Object.freeze({
      id: String(input.id),
      workspaceId: String(input.workspaceId),
      taskId: String(input.taskId),
      executionRunId: String(input.executionRunId),
      actionClass: String(input.actionClass),
      workerId: String(input.workerId),
      capabilityAction: String(input.capabilityAction),
      target: String(input.target),
      payloadPreview: structuredClone(input.payloadPreview || {}),
      evidenceExpected: structuredClone(input.evidenceExpected || []),
      state: 'requested',
      requestedAt: this.clock(),
      decidedAt: null,
    });
    this.repository.save(gate);
    return Object.freeze({ created: true, gate });
  }

  decide(id, decision) {
    if (!['approved', 'rejected', 'expired'].includes(decision)) throw new Error('Unsupported Human Gate decision');
    const current = this.repository.get(id);
    if (!current) throw new Error(`Unknown Human Gate: ${id}`);
    if (current.state === decision) return Object.freeze({ changed: false, gate: current });
    if (current.state !== 'requested') throw new Error(`Human Gate already decided: ${current.state}`);
    const gate = Object.freeze({ ...current, state: decision, decidedAt: this.clock() });
    this.repository.save(gate);
    return Object.freeze({ changed: true, gate });
  }

  approve(id) { return this.decide(id, 'approved'); }
  reject(id) { return this.decide(id, 'rejected'); }
  expire(id) { return this.decide(id, 'expired'); }
}

module.exports = { HumanGateService };
