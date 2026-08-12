'use strict';

const { S8SourceHandoffApplicationService } = require('./s8-source-handoff-service.cjs');
const { S8DestinationAuthorityApplicationService } = require('./s8-destination-authority-service.cjs');

const DESTINATION_AUTHORITY_METHODS = Object.freeze([
  'localAuthorityForRequest',
  'currentAdmission',
  'requestDelegationGate',
  'decideDelegationGate',
  'createLocalDelegatedMission',
  'approveDelegationProposal',
  'rejectDelegationProposal',
]);

class S8ProductApplicationService extends S8SourceHandoffApplicationService {}

for (const method of DESTINATION_AUTHORITY_METHODS) {
  const descriptor = Object.getOwnPropertyDescriptor(S8DestinationAuthorityApplicationService.prototype, method);
  if (!descriptor || typeof descriptor.value !== 'function') throw new Error(`Missing S8 destination authority method: ${method}`);
  Object.defineProperty(S8ProductApplicationService.prototype, method, descriptor);
}

module.exports = {
  DESTINATION_AUTHORITY_METHODS,
  S8ApplicationService: S8ProductApplicationService,
  S8ProductApplicationService,
};