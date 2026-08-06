const assert = require('node:assert/strict');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mode = process.argv[2] || 'parent';

function command(commandName, args = []) {
  try {
    return execFileSync(commandName, args, { encoding: 'utf8' }).trim();
  } catch (error) {
    return String(error.stdout || error.stderr || error.message || '').trim();
  }
}

function processTranslated() {
  return command('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated']) === '1';
}

function physicalHostArchitecture() {
  if (command('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64']) === '1') return 'arm64';
  return command('/usr/bin/uname', ['-m']);
}

function fileInfo(path) {
  if (!existsSync(path)) return { path, exists: false };
  return {
    path,
    exists: true,
    file: command('/usr/bin/file', [path]),
    architectures: command('/usr/bin/lipo', ['-archs', path]),
  };
}

async function child() {
  const { chromium } = require('playwright');
  const launchKind = process.env.AI_EXE_OS_CHROME_LAUNCH_KIND;
  const userDataDir = process.env.AI_EXE_OS_CHROME_USER_DATA_DIR;
  const output = {
    status: 'RUNNING',
    launchKind,
    node: process.execPath,
    processArch: process.arch,
    translated: processTranslated(),
    nodeInfo: fileInfo(process.execPath),
    chromeInfo: fileInfo(chromeExecutable),
    error: null,
  };

  let context;
  try {
    const options = {
      headless: false,
      viewport: null,
      chromiumSandbox: true,
      timeout: 30_000,
    };
    if (launchKind === 'channel') options.channel = 'chrome';
    if (launchKind === 'executablePath') options.executablePath = chromeExecutable;
    context = await chromium.launchPersistentContext(userDataDir, options);
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    await page.goto('data:text/html,<title>S0 Chrome Architecture Probe</title><h1>PASS</h1>');
    output.pageTitle = await page.title();
    output.status = 'PASS';
  } catch (error) {
    output.status = 'FAIL';
    output.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    process.exitCode = 1;
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

function uniqueExisting(values) {
  return [...new Set(values.filter((value) => value && existsSync(value)))];
}

function parseChild(stdout, stderr) {
  const lines = String(stdout || '').trim().split('\n').filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith('{'));
  if (!jsonLine) {
    return {
      status: 'FAIL',
      error: { message: `No JSON result. stderr=${String(stderr || '').trim()}` },
    };
  }
  try {
    return JSON.parse(jsonLine);
  } catch (error) {
    return {
      status: 'FAIL',
      error: { message: `Invalid child JSON: ${error.message}` },
      stdout,
      stderr,
    };
  }
}

function recommendation(attempts, hostArchitecture) {
  const nativeArm64Channel = attempts.find(
    (attempt) => attempt.launchKind === 'channel'
      && attempt.status === 'PASS'
      && attempt.processArch === 'arm64',
  );
  if (hostArchitecture === 'arm64' && nativeArm64Channel) {
    return {
      code: 'RUN_MATRIX_WITH_NATIVE_ARM64_NODE',
      node: nativeArm64Channel.node,
      reason: 'A native arm64 Node process launches the installed Chrome channel successfully.',
    };
  }

  const currentChannel = attempts.find(
    (attempt) => attempt.node === process.execPath && attempt.launchKind === 'channel',
  );
  const currentDirect = attempts.find(
    (attempt) => attempt.node === process.execPath && attempt.launchKind === 'executablePath',
  );
  if (currentDirect?.status === 'PASS' && currentChannel?.status !== 'PASS') {
    return {
      code: 'USE_EXPLICIT_CHROME_EXECUTABLE_PATH',
      node: process.execPath,
      executablePath: chromeExecutable,
      reason: 'The current Node fails by channel but succeeds with the explicit installed Chrome binary.',
    };
  }

  if (currentChannel?.status === 'PASS') {
    return {
      code: 'CURRENT_RUNTIME_CAN_LAUNCH_CHROME',
      node: process.execPath,
      reason: 'The current runtime launches the installed Chrome channel successfully.',
    };
  }

  if (
    hostArchitecture === 'arm64'
    && (process.arch === 'x64' || processTranslated())
  ) {
    return {
      code: 'CURRENT_NODE_IS_X64_OR_TRANSLATED',
      node: process.execPath,
      reason: 'The probe is running under x64/Rosetta on Apple Silicon; use a native arm64 shell before changing Chrome.',
    };
  }

  const anyPass = attempts.find((attempt) => attempt.status === 'PASS');
  if (anyPass) {
    return {
      code: 'USE_SUCCESSFUL_NODE_CONFIGURATION',
      node: anyPass.node,
      launchKind: anyPass.launchKind,
      reason: 'At least one measured Node and launch-mode combination starts Chrome successfully.',
    };
  }

  return {
    code: 'CHROME_LAUNCH_ENVIRONMENT_BLOCKED',
    reason: 'Neither channel nor explicit-path launch succeeded under the available Node runtimes.',
  };
}

function parent() {
  assert.equal(process.platform, 'darwin', 'This probe requires macOS');
  const outputDirectory = resolve(
    process.env.AI_EXE_OS_CHROME_ARCH_OUTPUT
      || mkdtempSync(join(tmpdir(), 'ai-exe-os-chrome-arch-')),
  );
  mkdirSync(outputDirectory, { recursive: true });

  const hostArchitecture = physicalHostArchitecture();
  const processVisibleArchitecture = command('/usr/bin/uname', ['-m']);
  const whichNodes = command('/usr/bin/which', ['-a', 'node'])
    .split('\n')
    .filter(Boolean);
  const nodeCandidates = uniqueExisting([
    process.execPath,
    ...whichNodes,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ]);

  const attempts = [];
  for (const nodePath of nodeCandidates) {
    for (const launchKind of ['channel', 'executablePath']) {
      const safeName = `${attempts.length}-${launchKind}`;
      const userDataDir = join(outputDirectory, `profile-${safeName}`);
      rmSync(userDataDir, { recursive: true, force: true });
      const childResult = spawnSync(
        nodePath,
        [__filename, 'child'],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 45_000,
          env: {
            ...process.env,
            AI_EXE_OS_CHROME_LAUNCH_KIND: launchKind,
            AI_EXE_OS_CHROME_USER_DATA_DIR: userDataDir,
          },
        },
      );
      const parsed = parseChild(childResult.stdout, childResult.stderr);
      attempts.push({
        ...parsed,
        node: parsed.node || nodePath,
        launchKind,
        exitStatus: childResult.status,
        signal: childResult.signal,
        stderr: String(childResult.stderr || '').trim(),
      });
    }
  }

  const result = {
    status: attempts.some((attempt) => attempt.status === 'PASS') ? 'PASS' : 'FAIL',
    capturedAt: new Date().toISOString(),
    outputDirectory,
    hostArchitecture,
    processVisibleArchitecture,
    currentProcess: {
      node: process.execPath,
      processArch: process.arch,
      translated: processTranslated(),
      nodeInfo: fileInfo(process.execPath),
    },
    chrome: fileInfo(chromeExecutable),
    attempts,
    recommendation: recommendation(attempts, hostArchitecture),
  };

  writeFileSync(
    join(outputDirectory, 'chrome-architecture-result.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}

if (mode === 'child') {
  child();
} else {
  parent();
}
