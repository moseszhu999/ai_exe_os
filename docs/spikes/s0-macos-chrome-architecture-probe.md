# S0 macOS Chrome architecture probe

This document accompanies `npm run probe:chrome-arch`.

The probe compares Playwright Google Chrome launch behavior under every available local Node binary (`process.execPath`, `which -a node`, `/opt/homebrew/bin/node`, and `/usr/local/bin/node`) using both:

- `channel: "chrome"`
- `executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`

It records:

- host architecture (`uname -m`);
- Node `process.arch` and `sysctl.proc_translated`;
- `file` and `lipo -archs` output for Node and Chrome;
- bounded 30-second launch results for each Node/launch-mode pair;
- a machine-readable recommendation.

Allowed recommendations:

```text
RUN_MATRIX_WITH_NATIVE_ARM64_NODE
USE_EXPLICIT_CHROME_EXECUTABLE_PATH
CURRENT_NODE_IS_X64_OR_TRANSLATED
CHROME_LAUNCH_ENVIRONMENT_BLOCKED
```

The probe uses a new isolated Chrome profile per attempt and does not read or modify the user's normal Chrome profile.
