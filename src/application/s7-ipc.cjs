'use strict';

const { createHash } = require('node:crypto');

const CHANNELS = Object.freeze([
  's7:sync:query-state',
  's7:sync:configure',
  's7:sync:push-pending',
  's7:sync:pull-mirror',
  's7:sync:membership:record',
]);

function safeObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('S7 sync command payload must be a plain object');
  return input;
}

function membershipId(input) {
  if (input.id) return input.id;
  return `membership-${createHash('sha256').update(`${input.workspaceId || ''}:${input.subjectId || ''}`).digest('hex').slice(0, 20)}`;
}

function registerS7Ipc({ ipcMain, assertSender, service }) {
  if (!ipcMain?.handle || typeof assertSender !== 'function' || !service) throw new TypeError('S7 IPC dependencies are required');
  ipcMain.handle('s7:sync:query-state', (event, workspaceId) => {
    assertSender(event);
    return service.querySyncState(String(workspaceId || ''));
  });
  ipcMain.handle('s7:sync:configure', (event, input) => {
    assertSender(event);
    return service.configureSync(safeObject(input));
  });
  ipcMain.handle('s7:sync:push-pending', async (event, input) => {
    assertSender(event);
    return service.pushPendingSync(safeObject(input));
  });
  ipcMain.handle('s7:sync:pull-mirror', async (event, input) => {
    assertSender(event);
    return service.pullSharedMirror(safeObject(input));
  });
  ipcMain.handle('s7:sync:membership:record', (event, input) => {
    assertSender(event);
    const value = safeObject(input);
    return service.recordMembership({ ...value, id: membershipId(value) });
  });
  return CHANNELS;
}

module.exports = { CHANNELS, membershipId, registerS7Ipc };
