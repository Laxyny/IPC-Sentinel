# Architecture

`scanProject` orchestrates seven stages:

1. `config.ts`: read bounded JSON configuration without executing it; validate runtime options.
2. `discovery.ts`: deterministic directory walk, exclusion pruning, symlink skipping, file and byte limits.
3. `semantic.ts`: build a TypeScript program over the selected sources only; resolve local module paths, imports, aliases and bounded static expressions.
4. `analysis.ts`: extract Electron-provenance endpoints and bridge/configuration facts; inspect selected privileged calls through local helpers.
5. Relationship analysis: match invoke to handle and send to on families; collect related locations; do not match renderer listeners to requests.
6. `index.ts`: sort and deduplicate findings, apply severity overrides, preserve suppression records, retain incompleteness state.
7. `formatters.ts` and `cli.ts`: sanitize text, serialize JSON/SARIF, calculate documented exit codes.

Public types are in `types.ts`; stable metadata and remediation live in `rules.ts`. A report lists files, endpoints, findings, suppressed findings, observations and completeness. Root-relative diagnostic paths use forward slashes. TypeScript source positions are one-based in public reports and SARIF, including end positions. Output order uses codepoint comparisons rather than locale-specific collation.

The TypeScript program has no lib or external dependency source and does not emit or execute target code. Only selected files are readable through the compiler host. Tsconfig lookup stops at the scan root and reads JSON path settings; inheritance is observed but not loaded. This avoids traversing external package configuration or running build systems. Unresolved dependencies remain unresolved.

One scan is one graph. It does not establish entry-point reachability, build target membership, registration timing or isolation between windows. Use separate scans per monorepo application. Declared types are not runtime schemas; request and response type compatibility is deliberately deferred.

Static reduction follows const initializers, bounded property/spread objects, string concatenation and constant templates. It assumes no mutation of const objects after declaration and does not interpret calls, loops, arbitrary getters, destructured default expressions or CommonJS channel-module exports. Electron's CommonJS imports are recognized, but CommonJS global `require` must not be locally shadowed. Symbol-based import provenance avoids flagging similarly named local objects. Function helper traversal has a maximum depth of three and a cycle guard.

Default bounds: 10,000 selected sources, 2 MiB per file, 32 MiB total source bytes, and 100,000 directory entries. Limits do not bound all compiler allocations; deep or adversarial syntax can still exhaust a process. The API rejects fatal failures; CLI exits 2. Resource and parse limitations become IPC008 and cannot be hidden by suppression. Symlinks are skipped; directory race protection is best effort. A root symlink explicitly selected by the user resolves to its real root.

There is no persistent cache in 0.1.0. The in-memory source and symbol model avoids repeated filesystem reads. Measure before introducing cache invalidation, workers or additional graph abstractions. `npm run benchmark` generates a synthetic many-module fixture and reports its runtime, platform, time and RSS. It does not represent every application or a cold filesystem baseline.

Rules are internal functions with exported stable metadata. A third-party rule plugin API is deferred so untrusted scans do not accidentally execute configuration plugins. New rules need a secure negative case, a realistic positive case, locations and documented confidence limits. No autofix is implemented because none of the initial security transformations can preserve all application-specific behavior deterministically.
