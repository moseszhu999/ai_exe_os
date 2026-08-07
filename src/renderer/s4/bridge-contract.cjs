'use strict';

const S4_CONSOLE_METHODS = Object.freeze(['query', 'focusWorker', 'stopWorker', 'pauseWorker', 'resumeWorker']);

function assertS4ConsoleBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('S4 console bridge is required');
  for (const method of S4_CONSOLE_METHODS) {
    if (typeof bridge[method] !== 'function') throw new TypeError(`S4 console bridge missing ${method}`);
  }
  return bridge;
}

module.exports = { S4_CONSOLE_METHODS, assertS4ConsoleBridge };
