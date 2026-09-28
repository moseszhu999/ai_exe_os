'use strict';

const { createGithubReadOnlyProjectObservation } = require('./read-only-adapters.cjs');

const LIVE_PROVIDER_OBSERVATION_SCHEMA = 'aiexe.live-provider-observation.github.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function createLiveGithubProviderObservation(input) {
  plainObject(input, 'live GitHub provider observation');
  if (!Object.prototype.hasOwnProperty.call(input, 'openPullRequests') || !Array.isArray(input.openPullRequests)) {
    throw new TypeError('live GitHub provider observation requires an explicit openPullRequests array; [] means provider-confirmed zero, omission means not observed');
  }
  const observedAt = input.openPullRequestsObservedAt || input.observedAt;
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError('open pull requests observed at must be an ISO timestamp');
  }
  const { openPullRequestsObservedAt, ...adapterInput } = input;
  const observation = createGithubReadOnlyProjectObservation(adapterInput);
  return freezeDeep({
    ...observation,
    providerCapture: {
      schema: LIVE_PROVIDER_OBSERVATION_SCHEMA,
      headObserved: true,
      openPullRequestsObserved: true,
      openPullRequestsObservedAt: observedAt,
      openPullRequestCount: observation.openWork.pullRequests.length,
      inferenceAllowed: false,
    },
  });
}

module.exports = {
  LIVE_PROVIDER_OBSERVATION_SCHEMA,
  createLiveGithubProviderObservation,
};
