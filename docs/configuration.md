# Configuration

`ipc-sentinel.config.json` is loaded from the scan root if present. `--config` selects an explicit path relative to the root or an absolute path. Only JSON data is supported; no JavaScript configuration or application scripts execute. API options override top-level file options, and `rules` maps merge. Invalid configuration throws an API error or CLI exit 2. JSON files must be regular non-symlink files of at most 1 MiB. Scan roots must be directories.

The published `ipc-sentinel.schema.json` supports editor completion; `validateConfig` independently validates runtime input.

| Field           | Behavior                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| include         | Glob array relative to root; replaces default supported-extension pattern                                |
| exclude         | Additional globs or directory paths; default exclusions always apply                                     |
| rules           | Rule ID to `off` or severity; unknown IDs rejected                                                       |
| suppressions    | Array of ruleId, file glob and optional reason                                                           |
| electronVersion | Positive integer major; older versions receive an absent-defaults scope notice when options are supplied |
| maxFiles        | Positive integer; default 10000                                                                          |
| maxFileBytes    | Positive integer; default 2097152                                                                        |
| maxTotalBytes   | Positive integer; default 33554432                                                                       |

Glob paths use `/`; excludes and suppression paths also normalize Windows `\`. Include patterns are relative glob patterns, not absolute paths. Negation is unsupported for include/exclude. Each pattern is at most 512 characters. Default excludes are `node_modules`, `.git`, `.yarn`, `dist`, `build`, `coverage`, `out` at any depth. Declaration files are skipped. Files outside the root and symlink targets are not followed. Specify source, not transpiled output; generated duplicate registrations would distort a graph.

CLI example:

```sh
npx ipc-sentinel scan packages/desktop --include 'src/**/*.ts' --exclude 'src/generated/**' --fail-on medium
```

Repeated include/exclude options form arrays. A custom include still needs source file extensions recognized by TypeScript. If a selected file cannot be parsed, IPC008 marks the scan incomplete. Empty selection also exits 2 rather than claiming a clean scan.

Suppressions are retained even for `off` rules. A configuration suppression applies to all findings for the rule matching the file glob. Inline `// ipc-sentinel-disable-next-line IPC001 -- reason` applies to a finding whose primary source line is immediately next. Only single-line comments are supported, with one ID per directive. It does not disable an entire block or its later lines. Invalid/unused directives are not currently diagnosed. Configuration suppression takes precedence over inline reasons; disabled-rule reasons take precedence over both. Original severity is retained on suppressed findings.

`complete` is determined before suppressions. Lowering or disabling IPC008 does not change CLI exit 2. Partial results remain available in machine output. Fatal root/config errors print a sanitized stderr message; they do not produce a report.

Tsconfig alias support reads nearest project-local JSON/JSONC `compilerOptions.baseUrl` and `paths` (comments and trailing commas are accepted there). Relative imports and local re-exports work. Relative extends strings and arrays are read as bounded data: up to ten levels/parents and one hundred cached config files, with cycle and real-path containment checks. Inherited baseUrl is anchored to its declaring config; paths without baseUrl retain their own declaring directory. Later parents override settings they define; a nearer config without extends stops parent alias lookup. Package-based extends, missing parents, cycles and escapes produce IPC008. Package exports, references and runtime bundler aliases are not interpreted. Static configuration is never proof of the delivered Electron version or runtime defaults.

## Independent application graphs (v0.2)

The v0.2 candidate accepts applicationRoots, an array of 1�100 non-overlapping root-relative directory paths. This option is not available in npm 0.1.0.

```json
{
  "applicationRoots": ["apps/desktop", "apps/admin"],
  "include": ["apps/**/*.ts", "shared/**/*.ts"]
}
```

Paths normalize backslashes, reject absolute paths, traversal, globs and duplicates (case-insensitive), and are bounded to 512 characters. Windows membership is case-insensitive. Each root forms an independent channel graph; windows and multiple preloads inside one app still share a graph. Endpoints carry an optional scope. Files outside roots remain unassigned and cannot satisfy app requests. A declared root with no selected files produces IPC008. Shared wrapper calls inherit caller scope.

Select production sources and the relevant platform with include/exclude; tests and alternative build targets can contain legitimate duplicate registration sites. The scanner excludes .yarn directories by default. Runtime validation enforces path constraints in addition to the editor schema. No build scripts run and build target membership is not inferred.

Without explicit roots, at least two non-overlapping selected-source package directories declaring an Electron dependency create separate graphs. One package or no evidence retains the global graph. Nested or excessive boundaries produce IPC008 and leave endpoints unassigned; no cross-app match is invented. This does not infer window reachability or registration timing. Shared direct registrations outside an app remain unassigned; simple forwarded wrapper calls use caller scope.

```sh
ipc-sentinel scan . --application-root apps/desktop --application-root apps/admin --verbose
```

Explicit roots override package heuristics. Verbose observations go to stderr; JSON/SARIF stdout remains parseable.
