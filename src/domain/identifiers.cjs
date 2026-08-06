const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

function assertSafeIdentifier(value, label = 'identifier') {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${label} must match ${SAFE_IDENTIFIER}`);
  }
  return value;
}

function assertSafeGitHubName(value, label) {
  if (typeof value !== 'string' || !SAFE_GITHUB_NAME.test(value)) {
    throw new TypeError(`${label} contains unsupported characters`);
  }
  return value;
}

module.exports = { SAFE_IDENTIFIER, assertSafeIdentifier, assertSafeGitHubName };
