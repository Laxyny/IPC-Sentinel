# Historical real-world validation: pre-v0.2 hardening

Current candidate results are recorded in [v0.2 engineering](v0.2-engineering.md); this document preserves the earlier measurements. The published package remains 0.1.0. This report describes development changes against analyzer commit e08995f, whose cross-platform validation succeeded before this mission. The initial repository audit found four open Dependabot PRs with failing checks. Dependency decisions are recorded in [the audit](dependabot-audit.md).

## Reproducible source-only corpus

These public checkouts were fetched at exact revisions, with Git hooks disabled, into an external temporary cache. No target dependencies were installed and no application, build script or configuration code was executed. Licenses and Electron declarations were read from the pinned sources; declarations do not prove a deployed runtime version. Third-party code is not redistributed in this repository. No private application source was used; an optional Orrbit checkout was unavailable.

| Project                                                                     | Pinned commit                            | Architecture                                                          | Declared Electron | License  |
| --------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- | ----------------- | -------- |
| [minimal-repro](https://github.com/electron/minimal-repro)                  | 1e3a9803707b420fe8ee1ef0cceb5a7d1106c17a | Plain JavaScript official template                                    | ^44.5.1           | CC0-1.0  |
| [electron-vite-react](https://github.com/electron-vite/electron-vite-react) | 18d31d5dcfe6637aa1dd6699babcab1849c83f98 | TypeScript, React, Vite, electron-builder                             | ^42.1.0           | MIT      |
| [Electron Fiddle](https://github.com/electron/fiddle)                       | a63225b53664fd750828c29aa35de4b4d0eb0b28 | React, Forge, channel enums, multiple windows                         | ^42.3.3           | MIT      |
| [Signal Desktop](https://github.com/signalapp/Signal-Desktop)               | 5c1a030485ea64a1c311288cd6b5eecbe36964cd | Large TypeScript application, multiple preloads and stateful wrappers | 44.4.5            | AGPL-3.0 |

The manifest is in validation/projects.json. Baseline and candidate aggregates are in validation/baseline.json and validation/candidate.json. Raw reports contain paths and channel names and remain in the private temporary cache; CI does not upload them. Only aggregate measurements are committed.

```sh
npm ci --ignore-scripts
npm run build
npm run test:real-world -- --fetch
# Later runs verify existing clean pinned checkouts without fetching:
npm run test:real-world
# Compare with a separately built baseline implementation:
node scripts/compare-performance.mjs /path/to/baseline/dist/index.js
```

The harness rejects dirty or mismatched checkouts, runs each scan in a fresh subprocess with a 120-second timeout, and compares file/endpoint/rule counts and completeness with validation/expected.json. Fetching public sources requires network access; scanning remains local. CI runs this regression on Ubuntu/Node 24 alongside the six regular OS/Node jobs. Counts are regression expectations, not security verdicts.

## Observed results

Rule vectors below are ordered IPC001 through IPC009. An incomplete report remains useful but cannot support a clean-security claim. Inconclusive counts include dynamic relationships as well as incompleteness findings.

| Project             | Selected files | Endpoints, baseline → candidate | Rule vector, baseline → candidate           | Inconclusive, baseline → candidate | Candidate complete |
| ------------------- | -------------: | ------------------------------- | ------------------------------------------- | ---------------------------------- | ------------------ |
| minimal-repro       |              3 | 0 → 0                           | all zero → all zero                         | 0 → 0                              | yes                |
| electron-vite-react |             15 | 8 → 8                           | 1,0,0,0,2,1,3,0,0 → 4,0,0,0,2,1,3,0,0       | 3 → 3                              | yes                |
| Fiddle              |            290 | 65 → 66                         | 0,0,0,0,0,2,63,10,0 → 0,0,56,1,0,2,3,9,0    | 73 → 68                            | no                 |
| Signal              |           3001 | 269 → 279                       | 0,9,8,1,0,10,16,28,0 → 0,4,8,1,0,10,26,28,0 | 52 → 62                            | no                 |

Enum resolution makes Fiddle's channels visible, but its stateful IPC manager is beyond the simple wrapper model. Its 56 IPC003 observations therefore do not establish 56 missing runtime handlers. Signal similarly uses unsupported runtime abstractions and unresolved BrowserWindow options. More discovered relationships can also expose more uncertainty.

## Manual interpretation and regression evidence

Review was targeted, not an exhaustive application audit: all ten candidate Vite findings and representative findings for each reported rule family in Fiddle and Signal were inspected. Unreviewed findings remain unclassified; no precision or recall percentage is justified.

- **Confirmed static source facts:** Vite has two explicit preference settings flagged by IPC005. This is evidence about source settings, not a confirmed vulnerability in the template.
- **Potential security concerns:** four Vite IPC001 bridge exposures and one IPC006 URL review need application context. Three parameter/event exposure patterns missed by the baseline are now detected through aliases, rest bindings and object/event forwarding. Regression fixtures cover narrow alternatives.
- **Inconclusive:** three Vite dynamic-channel findings and unresolved channel/options observations in the larger applications. These cannot be converted into security conclusions.
- **Unsupported architecture:** representative Fiddle IPC003 observations depend on stateful manager registrations that the analyzer cannot expand. Signal's class/factory abstractions remain outside the bounded forwarding model.
- **Expected behavior / false positive as a runtime-risk claim:** Fiddle's duplicate registration occurs in isolated tests; Signal's duplicate spans alternative platform updater implementations and registration lifecycle. IPC004 correctly identifies source sites but cannot prove simultaneous execution. A production/include/platform-exclude regression demonstrates explicit target selection. Listener cleanup is no longer treated as parameter-selected request exposure.
- **Privileged-handler review:** Signal's IPC002 count falls from nine to four after excluding uncalled nested helpers and resolving forwarded handlers. Remaining findings ask for review; a validation-looking function name never proves sender or payload enforcement.

Reduced fixtures cover raw and fixed-channel binds, listener payload stripping, alias/rest channels, enum imports/re-exports, CommonJS exports and cycles, imported simple wrappers, dynamic/default/guarded wrapper limits, app isolation, shared wrappers, multiple preloads, unassigned/empty roots, Windows path constraints, bundled Yarn exclusions, nested privileged helpers and BrowserWindow aliases. Existing rule fixtures provide unsafe positives and secure negatives for IPC001–IPC009, malformed-source/resource handling, suppression, JSON/SARIF and CLI behavior. IPC009 has no positive in this public corpus; its positive evidence is the synthetic HTTP-window regression.

Known false negatives remain: class-based wrappers, factories, conditional forwarding, mutable state, arbitrary event dataflow and external registrations. Their frequency is unknown. Neither a complete scan nor a zero-finding template measures application safety. [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security) still requires application-specific sender, payload, navigation and isolation review.

## Paired performance

Windows, Node 24.19.0, same machine and pinned clean sources; three alternating baseline/candidate pairs per project in fresh subprocesses. Baseline analyzer code is e08995f, built in an isolated checkout with only the test dependencies upgraded. Measurements exclude checkout fetching and target startup. OS filesystem caching remains uncontrolled. Median scan time and median peak process RSS follow; raw aggregate runs are in validation/performance.json.

| Project             | Baseline ms | Candidate ms | Change | Baseline peak MiB | Candidate peak MiB |
| ------------------- | ----------: | -----------: | -----: | ----------------: | -----------------: |
| minimal-repro       |          43 |           45 |  +4.7% |                86 |                 87 |
| electron-vite-react |         112 |          136 | +21.4% |                96 |                 98 |
| Fiddle              |         987 |         1127 | +14.2% |               258 |                265 |
| Signal              |        7978 |        10568 | +32.5% |               860 |                895 |

Additional semantic traversal has a measurable cost, especially on Signal: approximately 2.6 seconds and 35 MiB. Per-scan memoization and bounded wrapper/helper traversal limit repeated work but do not establish a universal speedup. The initial cold baseline is retained for provenance and is not compared with warm candidate scans to claim improvement. Peak RSS includes the TypeScript program, not just source buffers; file limits are not a hard memory sandbox. Further broad dataflow expansion should require profiling first.

## Release implications

Local final gates passed 52 tests across four files, formatting, ESLint, TypeScript checks, build and packed consumer integration (ESM/CommonJS, CLI, JSON and SARIF). Coverage: 91.26% statements, 88.58% branches, 93.06% functions and 94.66% lines. The CLI is exercised through subprocess integration rather than instrumented library coverage. Clean dependency installation reported zero vulnerabilities. Cross-platform results must be checked on the feature PR's final commit.

The changes add applicationRoots and optional endpoint scope and refine findings. A future minor release, potentially 0.2.0, is appropriate after feature review and final CI. Version, npm publication and tags remain unchanged. Release approval must account for the documented performance overhead, unsupported stateful architectures and the non-exhaustive manual review. No package publication workflow was invoked for this work.
