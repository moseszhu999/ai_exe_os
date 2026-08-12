'use strict';

const {
  MANAGEMENT_CEO_PORTFOLIO_VIEW_SCHEMA,
  createManagementCeoPortfolioView,
} = require('../../management/portfolio/group-ceo-portfolio-brief-adapter.cjs');

const MANAGEMENT_CEO_PORTFOLIO_SURFACE_SCHEMA = 'aiexe.operator-management-ceo-portfolio-surface.v1';
const MANAGEMENT_AUTHORITY = 'observe-and-propose';

function requiredWorkspaceId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function statusSurface({ reasonCode, view = null }) {
  return Object.freeze({
    schema: MANAGEMENT_CEO_PORTFOLIO_SURFACE_SCHEMA,
    available: Boolean(view),
    reasonCode,
    managementAuthority: MANAGEMENT_AUTHORITY,
    readOnly: true,
    writeAuthority: 'none',
    managementProposalCreated: false,
    decisionTruthCreated: false,
    humanGateDecisionCreated: false,
    authorizationDecisionCreated: false,
    delegationCreated: false,
    externalActionPerformed: false,
    view,
  });
}

function readManagementCeoPortfolioSurface({
  workspaceId,
  groupManagementWorkspaceId,
  groupCeoPortfolioBriefReader,
} = {}) {
  const activeWorkspaceId = requiredWorkspaceId(workspaceId, 'workspaceId');
  if (groupCeoPortfolioBriefReader == null) return null;
  if (typeof groupCeoPortfolioBriefReader !== 'function') throw new TypeError('groupCeoPortfolioBriefReader must be a function');
  const ownerWorkspaceId = requiredWorkspaceId(groupManagementWorkspaceId, 'groupManagementWorkspaceId');
  if (activeWorkspaceId !== ownerWorkspaceId) return null;

  let brief;
  try {
    brief = groupCeoPortfolioBriefReader();
  } catch {
    return statusSurface({ reasonCode: 'source_read_failed' });
  }
  if (brief == null) return statusSurface({ reasonCode: 'source_unavailable' });
  if (typeof brief?.then === 'function') return statusSurface({ reasonCode: 'source_async_unsupported' });

  try {
    const view = createManagementCeoPortfolioView(brief);
    if (view.schema !== MANAGEMENT_CEO_PORTFOLIO_VIEW_SCHEMA) {
      return statusSurface({ reasonCode: 'source_invalid' });
    }
    return statusSurface({ reasonCode: 'source_validated', view });
  } catch {
    return statusSurface({ reasonCode: 'source_invalid' });
  }
}

module.exports = {
  MANAGEMENT_CEO_PORTFOLIO_SURFACE_SCHEMA,
  readManagementCeoPortfolioSurface,
};
