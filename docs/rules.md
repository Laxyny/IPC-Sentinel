# Rules

Severity describes review priority. Confidence describes evidence for the reported source fact or heuristic, not confidence that exploitation is possible. Kinds: `static` for directly resolved source facts; `potential` for risks requiring context; `inconclusive` for unresolved relationships or analysis gaps; `informational` is reserved for future non-risk findings. Observations are separate strings. None guarantees security.

## IPC001

Dangerous IPC bridge exposure. High severity. Detects raw ipcRenderer object/method references (including aliases and unrestricted bind), functions forwarding a renderer parameter into a channel, direct listener callbacks, and a listener forwarding its event to another call. Nested statically resolvable objects are traversed. Fixed-channel invoke/send and listeners forwarding only payloads are accepted.

Electron 29 disallows transfer of the entire ipcRenderer object; reporting this source pattern still identifies an attempted broad boundary or broken bridge, not proof that it works in every version. Channel allowlist guards are not proven; review the call before suppression. Complex returned APIs, custom wrappers, arbitrary event dataflow and Node capabilities other than raw IPC are not comprehensively analyzed.

```ts
// Risk
contextBridge.exposeInMainWorld('app', { invoke: ipcRenderer.invoke });
// Narrower boundary
contextBridge.exposeInMainWorld('app', {
  version: () => ipcRenderer.invoke('app:version'),
});
```

## IPC002

Privileged handler validation review. Medium severity, low confidence, potential risk. Follows direct handler callbacks and project-local function helpers to depth three. Selected filesystem methods, child_process methods and shell.openExternal trigger review. No channel-name guessing. A handler with no privileged call does not trigger this rule.

This rule does not prove validation missing. Guards, helpers and wrapper libraries can implement it outside the visible call path; even a visible `validate` call cannot prove dominance or rejection of invalid inputs. Review both exact senderFrame origin checks and request schemas before privileged effects. A validated implementation may suppress with an audited reason. No autofix is safe here.

## IPC003

Missing IPC relationship or method mismatch. Low severity and inconclusive. Each discovered invoke needs a handle/handleOnce; send/sendSync needs on/once/addListener. If only the opposite family exists, its locations are attached. Dynamic registrations reduce confidence. Renderer on/once listeners are never assumed to need main handlers.

Excluded files, runtime wrappers, package-provided handlers and independent app targets can explain findings or hide problems. Matching names never proves compatible payloads, serialization or responses. Scan all relevant source, and separate independent main applications.

## IPC004

Multiple invoke registration sites. Medium severity, medium confidence, potential. Groups handle/handleOnce registrations sharing a resolved string and attaches other sites. Multiple on listeners are allowed and not flagged. Mutually exclusive branches, separate main applications and removeHandler/re-registration patterns require manual interpretation. The tool does not know which sites execute simultaneously.

## IPC005

Explicit unsafe BrowserWindow preference. High severity, high confidence in the source fact. Detects nodeIntegration=true, contextIsolation=false, sandbox=false, webSecurity=false, allowRunningInsecureContent=true, webviewTag=true and legacy enableRemoteModule=true. Resolves local options objects and spreads. Absent properties never receive unsafe-default findings. Dynamic relevant values/options produce IPC008.

An explicit setting is not necessarily an exploitable vulnerability: local content, Electron version and application threat model matter. Historical defaults are not inferred. Prefer Node integration disabled, context isolation and sandbox enabled, web security enabled and narrow preload methods.

## IPC006

External URL review. Medium severity, low confidence, potential. Detects shell.openExternal with unresolved arguments or constants that do not begin with HTTPS. Values may already be validated in helpers; suppress only after review. Static HTTPS is an exclusion from this heuristic, not proof of safe host selection, robust URL parsing or trusted content. Comprehensive navigation, new-window and permissions analysis is deferred.

## IPC007

Dynamic channel. Informational severity, high confidence that the expression is unresolved, inconclusive. Reports dynamic main and renderer channels including wrapper bodies. On the development branch, simple single-call forwarding wrappers are instantiated at caller locations to depth three. Conditional, default-parameter, stateful and class-based wrappers remain unresolved. Use shared constants or manually confirm routing. These observations do not alone mark source parsing incomplete.

## IPC008

Incomplete analysis. Informational severity, high confidence, inconclusive. Covers malformed source, unreadable/oversized files, resource caps, empty selections, invalid project tsconfig JSON, and unresolved BrowserWindow options or relevant values. Scan exit 2 takes precedence over severity thresholds and suppression. These findings may be located at the file start when no accurate parsed range exists.

`complete: true` only means no detected failure in implemented analysis, not exhaustive understanding. Unsupported external libraries and unmodeled code can still exist. Inherited tsconfig limitations appear as verbose/report observations.

## IPC009

Insecure remote content. Medium severity, high confidence in the static source fact. Detects HTTP constants in loadURL on variables initialized with an Electron BrowserWindow, including bounded local aliases on the development branch. Unproven receivers are ignored to avoid unrelated method-name findings. HTTPS or local content should be combined with restrictive navigation, permissions and renderer isolation.

## General limitations

No complete control-flow or taint model, mutable object tracking, package export resolver, arbitrary CommonJS exports, contract type proof, CSP parser, arbitrary window association or packaged fuse audit. Rules operate on discovered source rather than executable reachability. Diagnostics intentionally avoid embedding source snippets, URL values, payload values and channel names in messages. The endpoint inventory contains resolved channel names and paths; handle reports accordingly.
