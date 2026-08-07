'use strict';

// Acceptance-only browser plumbing: the project-owned test page intentionally has no favicon.
// Route only /favicon.ico to 204 so Chromium does not turn that non-product resource miss into
// a console error. No other request, console message, page error, or product path is suppressed.
const { BrowserWorkerManager } = require('../src/main/browser-worker-manager.cjs');

const originalStart = BrowserWorkerManager.prototype.start;
BrowserWorkerManager.prototype.start = async function startWithAcceptanceFaviconRoute(workerId) {
  const result = await originalStart.call(this, workerId);
  const session = this.contexts.get(workerId);
  if (session?.page) {
    await session.page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  }
  return result;
};

require('./s2-acceptance-native-mac.cjs');
