'use strict';

const CHANNELS = Object.freeze([
  's6:scheduling:query-state',
  's6:scheduling:record-policy',
  's6:scheduling:compute-decision',
  's6:scheduling:revalidate-proposal',
]);

function safeObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('S6 scheduling command payload must be a plain object');
  return input;
}

function registerS6Ipc({ ipcMain, assertSender, service }) {
  if (!ipcMain?.handle || typeof assertSender !== 'function' || !service) throw new TypeError('S6 IPC dependencies are required');
  ipcMain.handle('s6:scheduling:query-state', (event, workspaceId) => {
    assertSender(event);
    return service.querySchedulingState(String(workspaceId || ''));
  });
  ipcMain.handle('s6:scheduling:record-policy', (event, input) => {
    assertSender(event);
    return service.recordSchedulingPolicy(safeObject(input));
  });
  ipcMain.handle('s6:scheduling:compute-decision', (event, input) => {
    assertSender(event);
    return service.computeSchedulingDecisionForWorkspace(safeObject(input));
  });
  ipcMain.handle('s6:scheduling:revalidate-proposal', (event, input) => {
    assertSender(event);
    return service.revalidateSchedulingProposal(safeObject(input));
  });
  return CHANNELS;
}

module.exports = { CHANNELS, registerS6Ipc };
