# 0.1.0 release candidate validation

Validation date: 12 October 2026 (Europe/Paris). This document records checks before first publication. Package identity: `ipc-sentinel@0.1.0`, MIT. Initial registry lookup returned E404; name availability and publisher ownership were unconfirmed at that stage.

## Product scope

Nine stable rule IDs cover IPC bridge exposure, privileged handler review, missing/mismatched relationships, duplicate invoke registration sites, explicit renderer preferences, external URL review, dynamic channels, incomplete analysis and HTTP BrowserWindow content. Public typed API and scan/rules/explain/init CLI commands are implemented. JSON and SARIF preserve related locations and suppressions.

Analysis uses TypeScript 5.9.3 with a source-restricted compiler host, project-local aliases, constant reduction and a channel index. Two pinned production dependencies: TypeScript and picomatch. Source is never executed or uploaded. Modern explicit Electron APIs are targeted; Forge, builder and Vite project source can be scanned without running their configuration. Node 22.13+ and 24 are tested release targets.

Limits are explicit in README and docs/rules.md: no full sender/payload control-flow proof, window/build-target reachability, wrapper call-site expansion, request/response type compatibility, HTML CSP or binary fuse verification. Navigation and privileged bridge dataflow coverage are partial. No autofix is provided.

## Local commands and results

Clean installation and validation ran on Windows with Node v24.19.0 and npm 11.6.4:

```sh
npm ci --ignore-scripts
npm run validate
npm run test:coverage
npm audit --audit-level=moderate
npm run benchmark
npm run benchmark -- 5000
npm pack --json
npm publish --dry-run --json --access public
```

`validate` ran formatting checks, ESLint, strict TypeScript checks, all tests, the production build and packed consumer checks. All passed. There are 33 tests across three suites. Core coverage (CLI tested through subprocess integration and excluded from instrumentation): 90.32% statements, 85.51% branches, 90.24% functions and 93.30% lines. Audit reported zero vulnerabilities across production and development dependencies at the time of validation.

The real tarball was installed into an empty temporary consumer. ESM imports, CommonJS require, installed CLI shim, secure and unsafe Electron project fixtures, JSON, SARIF and `npm publish --dry-run --json --ignore-scripts --access public` all passed. SARIF was additionally validated offline against the vendored external SARIF 2.1.0 schema; the configuration editor schema is checked against runtime acceptance. Direct `npm pack --json` and `npm publish --dry-run --json --access public` also exercised the actual prepack build hook. npm's repository URL normalization warning was resolved in package metadata. Its dry-run authentication notice is expected; actual publication remains unapproved and npm authentication has not been verified.

The package contents whitelist was checked: compiled code, declarations, source maps with embedded project source, documentation, schema and public metadata only. No tests, external test schema, dependency tree, credentials, private attachments or temporary consumer files are included. The package is approximately 54 KiB before this validation document was added; final size depends on documentation changes and must be read from the final tarball rather than inferred here.

## Measured performance

These are single local synthetic runs, not production guarantees. Source generation is outside the measured scan interval. RSS is process RSS after the scan, not measured peak allocation.

| Node / OS          | Source modules | Endpoints | Scan time | RSS     | Findings |
| ------------------ | -------------- | --------- | --------- | ------- | -------- |
| v24.19.0 / Windows | 1000           | 2000      | 425 ms    | 128 MiB | 0        |
| v24.19.0 / Windows | 5000           | 10000     | 2154 ms   | 240 MiB | 0        |

Both reports were complete within documented scope. Run `npm run benchmark` on representative application structures before using these figures for capacity planning.

## Repository and CI

Implementation and release workflow revision: `27ab927c14b81b0d7c4e0fdc3d76ba4c828e5e66`, pushed to the explicitly configured `Laxyny/IPC-Sentinel` repository's `dev` branch. Initial history and README were preserved and expanded; progress is split into tooling, research, discovery/semantics, IPC/security, API/CLI, tests, hardening, documentation and CI commits. This record is committed separately after validation; use `git rev-parse HEAD` for the final documentation revision.

The [six-job workflow](https://github.com/Laxyny/IPC-Sentinel/actions/runs/38184296099) passed all six jobs: Ubuntu, macOS and Windows with Node 22 and 24. Each job completed clean install, full validation, coverage, audit and artifact upload. Later documentation-only commits can trigger fresh runs without changing the validated analyzer code.

## Publication status and remaining gates

The local package gates passed. At the time of this validation record, nothing had been published to npm, no public GitHub release had been created, and no tag had been pushed. Publication was subsequently authorized by the user on 12 October 2026. Actual registry availability must be verified after publishing.

Before publication: confirm the final six-job CI matrix, merge reviewed changes to the default branch, approve the exact package/version/revision, verify npm authentication and ownership, configure the GitHub protected `npm-release` environment and npm trusted publisher, rerun release validation on the approved commit, publish through the approved route, and verify public installation. A first-package bootstrap may need an approved authenticated initial publication if npm requires an existing package before trusted publisher setup. No credentials should be pasted into source.

The manual release workflow checks the approved version and exact SHA, runs validation and audit, then uses environment approval and npm OIDC provenance. Environment protection is an account-side requirement and has not been represented as configured or tested. Publication dry-run cannot prove authentication, provenance or name reservation.

## Prioritized next releases

0.2.0: separate application graphs by entry point/build target; add wrapper models and explicit validation evidence; broaden bridge and navigation dataflow with secure counterexamples. Extend local module resolution for inherited tsconfig and CommonJS registries.

Later: serialization-aware request/response contracts, editor integration, performance profiling on real large projects, binary fuse inspection, and a deliberately scoped rule extension API. Each feature must state evidence limits and ship positive and false-positive regression tests.
