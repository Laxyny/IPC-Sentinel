# Migrating to the v0.2.0 candidate

The candidate is not yet published. npm continues to serve 0.1.0. Build this branch and install ipc-sentinel-0.2.0.tgz to evaluate it. Package identity, Node >=22.13, ESM/native CommonJS interoperability, exported entry points, rule IDs, SARIF 2.1.0, JSON schemaVersion 1 and CLI exits 0/1/2 remain unchanged.

## Additive API

Config.applicationRoots and repeatable CLI --application-root isolate independent app directories. Endpoint.scope is optional; unassigned files do not satisfy app requests. Without explicit roots, multiple non-overlapping Electron package declarations provide conservative boundaries. Multiple BrowserWindows/preloads inside one app remain one graph. Use explicit roots for ambiguous layouts and source include/exclude for tests or alternative build targets.

IPC002 diagnostics may include evidence with validation, ipcInput, sinkLocations, validationLocations and analysisLimited. SARIF stores this under result.properties.evidence. Existing diagnostic fields retain their meanings. Consumers should tolerate optional fields. Evidence is review context, not a security verdict: no finding is removed because a guard or validator-looking call was observed.

```ts
const report = await scanProject({
  root: process.cwd(),
  config: { applicationRoots: ['apps/desktop', 'apps/admin'] },
});
for (const finding of report.diagnostics) {
  console.log(finding.ruleId, finding.evidence?.validation);
}
```

## Expected diagnostic changes

Enums, local CommonJS exports and simple wrappers can replace dynamic-channel observations with resolved endpoints or relationship findings. Conditional/stateful abstractions remain unsupported. Root-contained relative tsconfig inheritance is supported; unsupported package inheritance now produces IPC008 and exit 2, which may affect pipelines that previously saw only an observation.

Bridge analysis includes Node capabilities, renderer-controlled privileged calls and event aliases. Privileged-handler review includes selected shell/application operations and supporting guard/input evidence. IPC009 includes unconditional child-window allowance. These refinements can add findings; review baseline changes rather than disabling broad rule families.

No changed-files shortcut or finding-suppression baseline is introduced. Full discovered-source relationships remain necessary for cross-file correctness. No automatic security remediation is provided.
