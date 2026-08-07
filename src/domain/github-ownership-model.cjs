'use strict';

const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze } = require('./workspace-model.cjs');

function assertSafeBranchName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255) throw new TypeError('branch must be bounded text');
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) throw new TypeError('branch contains unsupported characters');
  if (value.startsWith('/') || value.endsWith('/') || value.startsWith('.') || value.endsWith('.')) throw new TypeError('branch has unsupported edge characters');
  if (value.includes('..') || value.includes('//') || value.includes('@{') || value.endsWith('.lock') || value.includes('\\')) {
    throw new TypeError('branch contains an unsafe Git ref sequence');
  }
  return value;
}

function normalizePathPrefix(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new TypeError('path claim must be bounded text');
  if (value.includes('\\') || value.startsWith('/')) throw new TypeError('path claim must be repository-relative');
  const raw = value.endsWith('/**') ? value.slice(0, -3) : value;
  const segments = raw.split('/');
  if (segments.some((part) => part === '' || part === '.' || part === '..')) throw new TypeError('path claim contains traversal or empty segments');
  if (segments.some((part) => /[\0\r\n]/.test(part))) throw new TypeError('path claim contains unsupported control characters');
  return segments.join('/');
}

function createBranchReservation(input) {
  const mode = input?.mode || 'exclusive_write';
  if (!['exclusive_write', 'read_only'].includes(mode)) throw new TypeError('unsupported branch reservation mode');
  const ownerKind = input?.ownerKind || 'mission_step';
  if (!['mission_step', 'task', 'operator'].includes(ownerKind)) throw new TypeError('unsupported branch reservation ownerKind');
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'branch reservation id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    repositoryRegistrationId: assertSafeIdentifier(input?.repositoryRegistrationId, 'repository registration id'),
    branch: assertSafeBranchName(input?.branch),
    mode,
    ownerKind,
    ownerId: assertSafeIdentifier(input?.ownerId, 'branch reservation owner id'),
    state: 'active',
    createdAt: input?.createdAt || new Date().toISOString(),
    releasedAt: null,
  });
}

function releaseBranchReservation(reservation, occurredAt = new Date().toISOString(), state = 'released') {
  if (!reservation || typeof reservation !== 'object') throw new TypeError('branch reservation is required');
  if (!['released', 'superseded'].includes(state)) throw new TypeError('release state must be released or superseded');
  if (reservation.state !== 'active') return reservation;
  return deepFreeze({ ...reservation, state, releasedAt: occurredAt });
}

function createPathOwnershipClaim(input) {
  const mode = input?.mode || 'exclusive_write';
  if (!['exclusive_write', 'read_only'].includes(mode)) throw new TypeError('unsupported path claim mode');
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'path ownership claim id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    repositoryRegistrationId: assertSafeIdentifier(input?.repositoryRegistrationId, 'repository registration id'),
    branchReservationId: assertSafeIdentifier(input?.branchReservationId, 'branch reservation id'),
    pathPrefix: normalizePathPrefix(input?.pathPattern || input?.pathPrefix),
    mode,
    ownerId: assertSafeIdentifier(input?.ownerId, 'path ownership owner id'),
    state: 'active',
    createdAt: input?.createdAt || new Date().toISOString(),
  });
}

function prefixContains(prefix, candidate) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function pathClaimsConflict(left, right) {
  if (!left || !right) return false;
  if (left.state !== 'active' || right.state !== 'active') return false;
  if (left.workspaceId !== right.workspaceId || left.repositoryRegistrationId !== right.repositoryRegistrationId) return false;
  if (left.mode !== 'exclusive_write' || right.mode !== 'exclusive_write') return false;
  if (left.ownerId === right.ownerId) return false;
  return prefixContains(left.pathPrefix, right.pathPrefix) || prefixContains(right.pathPrefix, left.pathPrefix);
}

function branchReservationsConflict(left, right) {
  if (!left || !right) return false;
  if (left.state !== 'active' || right.state !== 'active') return false;
  if (left.workspaceId !== right.workspaceId || left.repositoryRegistrationId !== right.repositoryRegistrationId) return false;
  if (left.branch !== right.branch) return false;
  if (left.mode !== 'exclusive_write' || right.mode !== 'exclusive_write') return false;
  return left.ownerId !== right.ownerId;
}

function findOwnershipConflicts({ reservations = [], claims = [] } = {}) {
  const conflicts = [];
  for (let i = 0; i < reservations.length; i += 1) {
    for (let j = i + 1; j < reservations.length; j += 1) {
      if (branchReservationsConflict(reservations[i], reservations[j])) {
        conflicts.push(deepFreeze({ kind: 'branch', leftId: reservations[i].id, rightId: reservations[j].id }));
      }
    }
  }
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      if (pathClaimsConflict(claims[i], claims[j])) {
        conflicts.push(deepFreeze({ kind: 'path', leftId: claims[i].id, rightId: claims[j].id, leftPath: claims[i].pathPrefix, rightPath: claims[j].pathPrefix }));
      }
    }
  }
  return deepFreeze(conflicts);
}

module.exports = {
  assertSafeBranchName,
  branchReservationsConflict,
  createBranchReservation,
  createPathOwnershipClaim,
  findOwnershipConflicts,
  normalizePathPrefix,
  pathClaimsConflict,
  releaseBranchReservation,
};
