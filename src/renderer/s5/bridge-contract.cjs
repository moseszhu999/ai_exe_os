'use strict';

const METHODS = Object.freeze(['queryState', 'bindTarget', 'observe']);

function assertS5ProviderBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('S5 provider bridge is required');
  for (const method of METHODS) if (typeof bridge[method] !== 'function') throw new TypeError(`S5 provider bridge.${method} is required`);
  return bridge;
}

module.exports = { METHODS, assertS5ProviderBridge };
