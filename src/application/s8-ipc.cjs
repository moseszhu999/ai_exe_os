'use strict';

const CHANNELS = Object.freeze([
  's8:delegation:query-state',
  's8:delegation:peer:record',
  's8:delegation:policy:record',
  's8:delegation:request:create',
  's8:delegation:request:push',
  's8:delegation:inbox:pull',
  's8:delegation:proposal:approve-local',
  's8:delegation:proposal:reject-local',
  's8:delegation:cancellation:propose',
  's8:delegation:cancellation:resolve-local',
  's8:delegation:receipts:pull',
  's8:delegation:receipt:consume-local',
]);

function safeObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('S8 delegation command payload must be a plain object');
  return input;
}

function registerS8Ipc({ ipcMain, assertSender, service }) {
  if (!ipcMain?.handle || typeof assertSender !== 'function' || !service) throw new TypeError('S8 IPC dependencies are required');
  ipcMain.handle('s8:delegation:query-state', (event, workspaceId) => {
    assertSender(event);
    return service.queryDelegationState(String(workspaceId || ''));
  });
  ipcMain.handle('s8:delegation:peer:record', (event, input) => {
    assertSender(event);
    return service.recordPeerBinding(safeObject(input));
  });
  ipcMain.handle('s8:delegation:policy:record', (event, input) => {
    assertSender(event);
    return service.recordDelegationPolicy(safeObject(input));
  });
  ipcMain.handle('s8:delegation:request:create', (event, input) => {
    assertSender(event);
    return service.createDelegationRequest(safeObject(input));
  });
  ipcMain.handle('s8:delegation:request:push', async (event, input) => {
    assertSender(event);
    return service.pushDelegationRequest(safeObject(input));
  });
  ipcMain.handle('s8:delegation:inbox:pull', async (event, input) => {
    assertSender(event);
    return service.pullDelegationInbox(safeObject(input));
  });
  ipcMain.handle('s8:delegation:proposal:approve-local', (event, input) => {
    assertSender(event);
    return service.approveDelegationProposal(safeObject(input));
  });
  ipcMain.handle('s8:delegation:proposal:reject-local', (event, input) => {
    assertSender(event);
    return service.rejectDelegationProposal(safeObject(input));
  });
  ipcMain.handle('s8:delegation:cancellation:propose', async (event, input) => {
    assertSender(event);
    return service.proposeDelegationCancellation(safeObject(input));
  });
  ipcMain.handle('s8:delegation:cancellation:resolve-local', (event, input) => {
    assertSender(event);
    return service.resolveDelegationCancellation(safeObject(input));
  });
  ipcMain.handle('s8:delegation:receipts:pull', async (event, input) => {
    assertSender(event);
    return service.pullDelegationReceipts(safeObject(input));
  });
  ipcMain.handle('s8:delegation:receipt:consume-local', (event, input) => {
    assertSender(event);
    return service.consumeDelegationReceipt(safeObject(input));
  });
  return CHANNELS;
}

module.exports = { CHANNELS, registerS8Ipc, safeObject };
