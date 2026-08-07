'use strict';

function node(kind, id, state = null) {
  if (!id) return null;
  return Object.freeze({ kind, id: String(id), state: state || null });
}

function edge(from, to, relation) {
  if (!from || !to) return null;
  return Object.freeze({ from, to, relation });
}

function createEvidenceLineage({ attentionItem, missionState = {}, githubState = {} } = {}) {
  if (!attentionItem || typeof attentionItem !== 'object') throw new TypeError('attentionItem is required');
  const nodes = [];
  const edges = [];
  const addNode = (value) => { if (value && !nodes.some((item) => item.kind === value.kind && item.id === value.id)) nodes.push(value); return value; };
  const addEdge = (value) => { if (value) edges.push(value); return value; };

  const source = addNode(node('attention', attentionItem.id || `${attentionItem.code}:${attentionItem.aggregateId || 'unknown'}`, attentionItem.state));
  let affected = null;

  if (attentionItem.missionRunId) affected = addNode(node('missionRun', attentionItem.missionRunId));
  if (!affected && attentionItem.stepAttemptId) affected = addNode(node('stepAttempt', attentionItem.stepAttemptId));
  if (!affected && attentionItem.executionRunId) affected = addNode(node('executionRun', attentionItem.executionRunId));
  if (!affected && attentionItem.taskId) affected = addNode(node('task', attentionItem.taskId));
  if (!affected && attentionItem.deliveryGateId) affected = addNode(node('deliveryGate', attentionItem.deliveryGateId));
  if (affected) addEdge(edge(source, affected, 'affects'));

  const attempts = missionState.stepAttempts || [];
  const attempt = attentionItem.stepAttemptId ? attempts.find((item) => item.id === attentionItem.stepAttemptId) : null;
  if (attempt) {
    const run = addNode(node('missionRun', attempt.missionRunId));
    addEdge(edge(addNode(node('stepAttempt', attempt.id, attempt.state)), run, 'belongs_to'));
    if (attempt.executionRunId) addEdge(edge(addNode(node('stepAttempt', attempt.id)), addNode(node('executionRun', attempt.executionRunId)), 'executed_by'));
  }

  const gates = missionState.humanGates || missionState.s1?.humanGates || [];
  const humanGate = attentionItem.humanGateId ? gates.find((item) => item.id === attentionItem.humanGateId) : null;
  if (humanGate) {
    const gateNode = addNode(node('humanGate', humanGate.id, humanGate.state));
    addEdge(edge(affected || source, gateNode, 'blocked_by'));
  }

  const deliveryGates = githubState.deliveryGates || [];
  const deliveryGate = attentionItem.deliveryGateId ? deliveryGates.find((item) => item.id === attentionItem.deliveryGateId) : null;
  if (deliveryGate) {
    const gateNode = addNode(node('deliveryGate', deliveryGate.id, deliveryGate.state));
    addEdge(edge(affected || source, gateNode, 'blocked_by'));
    const evidence = (githubState.deliveryEvidence || []).filter((item) => item.pullRequestBindingId === deliveryGate.pullRequestBindingId);
    for (const item of evidence) addEdge(edge(gateNode, addNode(node('deliveryEvidence', item.id, item.kind)), 'supported_by'));
  }

  for (const evidenceId of attentionItem.evidenceIds || []) addEdge(edge(affected || source, addNode(node('evidence', evidenceId)), 'supported_by'));
  for (const eventId of attentionItem.eventIds || []) addEdge(edge(affected || source, addNode(node('executionEvent', eventId)), 'provenance'));

  return Object.freeze({
    available: nodes.length > 1,
    missingProvenance: nodes.length <= 1,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
}

module.exports = { createEvidenceLineage };
