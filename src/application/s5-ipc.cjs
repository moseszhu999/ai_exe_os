'use strict';

const CHANNELS = Object.freeze([
  's5:provider:query-state',
  's5:provider:bind-target',
  's5:provider:observe',
]);

function safeObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('S5 provider command payload must be a plain object');
  return input;
}

function registerS5Ipc({ ipcMain, assertSender, service }) {
  if (!ipcMain?.handle || typeof assertSender !== 'function' || !service) throw new TypeError('S5 IPC dependencies are required');
  ipcMain.handle('s5:provider:query-state', (event, workspaceId) => {
    assertSender(event);
    return service.queryProviderState(String(workspaceId || ''));
  });
  ipcMain.handle('s5:provider:bind-target', (event, input) => {
    assertSender(event);
    return service.bindProviderTarget(safeObject(input));
  });
  ipcMain.handle('s5:provider:observe', (event, input) => {
    assertSender(event);
    return service.observeProvider(safeObject(input));
  });
  return CHANNELS;
}

module.exports = { CHANNELS, registerS5Ipc };
