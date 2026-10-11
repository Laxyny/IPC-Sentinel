# IPC Sentinel

Local-first Electron IPC relationship and security analysis.

IPC boundaries are easy to widen accidentally: a preload can forward arbitrary channels, a renderer can invoke an event-only channel, or two modules can register the same invoke handler. IPC Sentinel scans JavaScript and TypeScript with the TypeScript compiler API and gives actionable findings with source locations, confidence, and related registration sites.

Version 0.1.0 is an initial release candidate. It is prepared for distribution but has not been published. The npm name remains provisional until registry ownership is confirmed.

## Capabilities

- Distinguishes `invoke/handle` from `send/on`, including common one-shot variants.
- Finds undiscovered handlers, duplicate invoke registration sites, dynamic channels, and method mismatches.
- Reviews raw IPC bridge exposure, parameter-selected channels, and callbacks that forward Electron event objects.
- Checks explicit unsafe BrowserWindow preferences and HTTP content loads.
- Recommends validation review when discovered handlers reach selected filesystem, child-process, or external URL APIs, including local helpers.
- Resolves ESM imports, re-exports, namespaces, CommonJS Electron destructuring, local aliases, const expressions and project-local TypeScript path aliases.
- Produces deterministic text, JSON and SARIF 2.1.0 with auditable suppressions.

## Installation and quick start

After an approved npm release:

```sh
npm install --save-dev ipc-sentinel
npx ipc-sentinel scan .
npx ipc-sentinel scan ./src --format json
npx ipc-sentinel rules
npx ipc-sentinel explain IPC001
```

Before publication, build and install the local package:

```sh
npm ci
npm run build
npm pack
# From your Electron application directory:
npm install --save-dev /path/to/ipc-sentinel-0.1.0.tgz
npx ipc-sentinel scan .
```

For example, this preload exposes an unrestricted capability:

```ts
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('app', { send: ipcRenderer.send });
```

Text output includes:

```text
preload.ts:2:48 [HIGH] IPC001 Raw IPC capability is exposed through contextBridge.
  Expose one method per allowed operation; fix channel names and strip the event argument from callbacks.
```

Prefer a fixed operation and remove privileged events from callbacks:

```ts
contextBridge.exposeInMainWorld('app', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  onUpdate: (callback: (value: number) => void) =>
    ipcRenderer.on('update', (_event, value) => callback(value)),
});
```

The main process still needs appropriate sender and payload validation.

## Compatibility

Node.js 22.13+ and 24 LTS are release targets; CI runs both on Windows, macOS and Linux. The package is ESM with no top-level await. CommonJS `require()` uses Node's native synchronous ESM interoperability on supported Node versions. Declarations and source maps ship with the package.

The rules target explicit modern Electron APIs, principally Electron 20+. IPC Sentinel does not install or execute Electron. Older source may be parsed, but absent historical defaults are not audited. `electronVersion` is an explicit major-version hint, not a version resolver; `enableRemoteModule: true` is a legacy review finding even though modern Electron removed that API. A static finding about a deprecated setting does not prove a current runtime vulnerability.

Supports `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts` and `.cts`. Vue/Svelte templates, HTML CSP, compiled ASAR files and binary fuse values are outside the initial release. Forge, electron-builder and Vite Electron projects can be scanned when source is available; their build scripts are never executed. Default output directories are excluded. Multiple preloads and registration modules contribute to one discovered graph. Scan independent monorepo applications separately to avoid unrelated main processes satisfying each other's channels.

## Rules and configuration

| Rule   | Default severity | Focus                                    |
| ------ | ---------------- | ---------------------------------------- |
| IPC001 | High             | Bridge exposure and event forwarding     |
| IPC002 | Medium           | Privileged handler validation review     |
| IPC003 | Low              | Missing relationship or method mismatch  |
| IPC004 | Medium           | Duplicate invoke registration sites      |
| IPC005 | High             | Explicit unsafe renderer preferences     |
| IPC006 | Medium           | External URL review                      |
| IPC007 | Informational    | Dynamic channels                         |
| IPC008 | Informational    | Incomplete source/configuration analysis |
| IPC009 | Medium           | HTTP BrowserWindow content               |

Create `ipc-sentinel.config.json` in the scan root, or use `--config <file>`:

```json
{
  "include": ["src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
  "exclude": ["src/generated/**"],
  "electronVersion": 30,
  "rules": { "IPC003": "medium" },
  "suppressions": [
    {
      "ruleId": "IPC002",
      "file": "src/main/export.ts",
      "reason": "Sender and schema guards reviewed in validateRequest"
    }
  ]
}
```

`init [directory]` creates a config and refuses to overwrite one. Scanning never changes project source. Rule values are `off`, `critical`, `high`, `medium`, `low` or `informational`. Reasons are optional but encouraged. Inline suppression applies to one rule on the immediately following line:

```ts
// ipc-sentinel-disable-next-line IPC002 -- sender and schema guards reviewed
ipcMain.handle('export', validatedExport);
```

Disabled and suppressed findings remain in JSON and SARIF. An incomplete scan stays incomplete even if IPC008 is suppressed. [Configuration reference](docs/configuration.md) and [rule details](docs/rules.md) describe scope and false positives.

## Programmatic API

```ts
import { scanProject, formatSarif } from 'ipc-sentinel';

const report = await scanProject({
  root: process.cwd(),
  config: { rules: { IPC003: 'medium' } },
});
console.log(report.diagnostics);
console.log(report.endpoints);
const sarif = formatSarif(report);
```

`ScanOptions`, `ScanReport`, `Diagnostic`, `Endpoint`, `Config`, severity and confidence types are exported. `rules`, `getRule`, `validateConfig`, `formatText`, `formatSarif` and `version` are public. Configuration and root errors reject the promise; skipped/malformed sources become IPC008 findings. Report schema version is 1. Before 1.0, minor versions may refine the API; rule IDs remain stable and substantive changes are recorded in the changelog. Internal modules are not exported.

## CI

```sh
npx ipc-sentinel scan . --fail-on medium
npx ipc-sentinel scan . --format sarif > ipc-sentinel.sarif
```

Exit codes: `0` below threshold, `1` at least one unsuppressed finding at threshold, `2` error or incomplete scan. Default failing threshold is high. `--quiet` omits the text summary; JSON and SARIF remain full reports. `--verbose` sends discovery observations to stderr. Text output is deliberately uncolored and respects noninteractive environments and `NO_COLOR` without terminal styling. See [CI integration](docs/ci-integration.md) for upload and release examples.

## Limitations and privacy

No source evaluation, project scripts, config imports, telemetry, account or network requests occur during scanning. Dependencies and package installation may access npm as usual. Files, channel names and source locations remain local. Reports include absolute scan roots and channel names; review them before sharing.

This is a static review tool, not proof of application security. Finding kinds separate `static` source facts, `potential` risks, `inconclusive` analysis, and informational observations. Confidence describes the evidence for that finding, not exploitability. `complete` means no detected parse/configuration/resource failure within the documented scope, not coverage of every runtime behavior. Dynamic channels remain inconclusive even in a complete scan.

There is no complete control-flow, taint or contract compatibility analysis. No parameter-selected-channel allowlist proof, request/response type comparison, wrapper call-site instantiation, independent-window reachability or runtime registration-order model. IPC002 intentionally asks for review even when a helper validates requests; names or a call to `validate` do not prove all paths are guarded. Local helpers are followed to depth three; imported runtime libraries are not inspected. Navigation policies, permission handlers, preload path resolution, CSP, fuses and remote-code trust are not comprehensively audited. External HTTPS constants are not a general guarantee of safe destinations. Const object evaluation assumes no later mutation. CommonJS channel-module exports and tsconfig inheritance are not resolved. No autofix is offered because security boundary changes require application-specific decisions.

Source discovery skips symlinks, dependencies and generated outputs, limits file/byte counts, and sanitizes terminal control characters. These are defensive safeguards, not isolation against a concurrently mutating hostile filesystem. [Architecture](docs/architecture.md) and [research](docs/research-and-positioning.md) explain the tradeoffs.

## Development and maintenance

```sh
npm ci
npm run validate
npm run test:coverage
npm run benchmark
npm audit
```

The lockfile pins dependencies. Tests cover secure/unsafe project fixtures, false positives, aliases, dynamic wrappers, malformed sources, suppressions, CLI failures and packed installation. Package tests install the actual tarball in a temporary consumer and test ESM/CommonJS exports, CLI shims, JSON, SARIF and npm publication dry-run. Synthetic benchmarks report measurements rather than universal performance claims.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md). Licensed under [MIT](LICENSE).

Priorities for 0.2.0: app-scoped graphs, wrapper models, explicit validator contracts, and richer navigation/bridge dataflow analysis. Later releases can add serialization-aware contract checks, safe editor integration and packaged fuse audits, each with false-positive regression fixtures.
