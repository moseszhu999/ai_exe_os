'use strict';

const CHANNELS = Object.freeze([
  's4:console:query',
  's4:console:worker:focus',
  's4:console:worker:stop',
  's4:console:worker:pause',
  's4:console:worker:resume',
]);

function safeObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected an object payload');
  return input;
}

function registerS4Ipc({ ipcMain, assertSender, service }) {
  if (!ipcMain?.handle || typeof assertSender !== 'function' || !service) throw new TypeError('S4 IPC dependencies are required');
  ipcMain.handle('s4:console:query', (event, workspaceId) => {
    assertSender(event);
    return service.queryOperatorCockpit(String(workspaceId || ''));
  });
  for (const [channel, method] of [
    ['s4:console:worker:focus', 'focusWorker'],
    ['s4:console:worker:stop', 'stopWorker'],
    ['s4:console:worker:pause', 'pauseWorker'],
    ['s4:console:worker:resume', 'resumeWorker'],
  ]) {
    ipcMain.handle(channel, (event, input) => {
      assertSender(event);
      return service[method](safeObject(input));
    });
  }
  return CHANNELS;
}

module.exports = { CHANNELS, registerS4Ipc };
