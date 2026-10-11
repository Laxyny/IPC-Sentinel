# Research and positioning

Research date: 12 October 2026. These are source-level capabilities, not guarantees of exploitability.

| Tool | Existing capability | IPC Sentinel's practical distinction |
| --- | --- | --- |
| [Electronegativity](https://github.com/doyensec/electronegativity) | AST and DOM checks for Electron security anti-patterns | Typed public API, auditable suppressions, cross-file channel graph without application migration |
| [eslint-plugin-security](https://github.com/eslint-community/eslint-plugin-security) | General Node.js suspicious patterns | Electron import provenance and invoke/handle versus send/on relationships |
| [eslint-plugin-electron-security](https://github.com/biw/eslint-plugin-electron-security) | Electron-specific ESLint rules including sender validation | Whole discovered-project relationship analysis; complements file-level linting |
| [electron-trpc](https://github.com/jsonnull/electron-trpc) | Type-safe IPC through a runtime framework | Analyze existing Electron APIs without adopting a transport framework |
| [MarshallOfSound/ipc](https://github.com/MarshallOfSound/ipc) | IPC framework with contracts and runtime validation | Findings and channel relationships for existing applications |
| TypeScript compiler | Symbol resolution and type checking | Security and IPC semantics layered on compiler infrastructure |

The official [security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [ipcMain](https://www.electronjs.org/docs/latest/api/ipc-main), [ipcRenderer](https://www.electronjs.org/docs/latest/api/ipc-renderer), and [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge) documentation guide rule design. Review findings for sensitive handlers remain potential risks: lack of visible validation does not establish exploitation. Electron 29 prevents transfer of the entire ipcRenderer object, but individual raw methods and forwarding callbacks still merit review. Duplicate on listeners are legal; duplicate handle registrations are a different concern. Conditional registrations and separately built main processes require interpretation.

[Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) are binary packaging toggles. [Forge's fuses plugin](https://www.electronforge.io/config/plugins/fuses) and [electron-builder fuse setup](https://www.electron.build/v26/docs/tutorials/adding-electron-fuses/) apply them at packaging time. Reading source configuration cannot prove the shipped binary's fuse values. Binary fuse audits and executable build configuration are deliberately outside 0.1.0.

## Decisions

Use the [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) pinned to 5.9.3 rather than the registry's current major: it provides the stable AST API this implementation uses. Parse JS/TS with a restricted compiler host that only sees discovered files, no standard library or external dependencies. Resolve project-local imports, const channels, re-exports and tsconfig path mappings without evaluating code. Do not import project configuration; accept JSON only. Use one graph per scan; separate independent applications with separate invocations.

Only two production dependencies: TypeScript and picomatch. No application runtime, Electron download, account, telemetry, network client, or autofix. Do not infer request/response compatibility from channel names or TypeScript annotations: serialization and runtime validation are separate problems. Do not claim call graph or control flow completeness.

## Registry identity

`npm view ipc-sentinel name version --json` returned registry E404 on 12 October 2026. Select `ipc-sentinel` provisionally; E404 does not reserve a name, prove publish eligibility, or establish ownership. Recheck availability and authenticated ownership immediately before the approved first publication. If unavailable, investigate `@laxyny/ipc-sentinel` only after verifying that scope ownership. Do not change branding to resemble competing projects.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) with provenance, an explicitly dispatched release workflow, and a protected GitHub environment. Environment approval and npm trusted publisher configuration require repository owner setup; source files cannot enforce that external state.
