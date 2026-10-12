import ts from 'typescript';
import path from 'node:path';
import { slash } from './discovery.js';
import { withinScope } from './paths.js';
import { Semantic, visit } from './semantic.js';
import { resolveIpcCall } from './wrappers.js';
import { getRule } from './rules.js';
import type {
  Config,
  Diagnostic,
  Endpoint,
  FindingKind,
  Confidence,
  Location,
} from './types.js';
export function location(root: string, node: ts.Node): Location {
  const file = node.getSourceFile();
  const start = file.getLineAndCharacterOfPosition(node.getStart(file));
  const end = file.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file: slash(path.relative(root, file.fileName)),
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}
export function diagnostic(
  id: string,
  at: Location,
  message: string,
  kind: FindingKind = 'potential',
  confidence: Confidence = 'medium',
  relatedLocations: Location[] = [],
): Diagnostic {
  const rule = getRule(id);
  return {
    ruleId: id,
    title: rule.title,
    severity: rule.severity,
    confidence,
    kind,
    message,
    explanation: rule.explanation,
    remediation: rule.remediation,
    documentationUrl: rule.documentationUrl,
    location: at,
    relatedLocations,
  };
}
export function analyze(
  semantic: Semantic,
  root: string,
  config: Config,
): { diagnostics: Diagnostic[]; endpoints: Endpoint[] } {
  const diagnostics: Diagnostic[] = [];
  const endpoints: Endpoint[] = [];
  const calls = new Map<ts.CallExpression, ReturnType<typeof resolveIpcCall>>();
  const instantiatedTemplates = new Set<ts.CallExpression>();
  for (const file of semantic.program.getSourceFiles())
    visit(file, (node) => {
      if (!ts.isCallExpression(node)) return;
      const resolved = resolveIpcCall(semantic, node);
      calls.set(node, resolved);
      // A static caller supplies evidence missing from the generic definition.
      if (resolved && typeof semantic.value(resolved.args[0]) === 'string')
        for (const template of resolved.templates)
          instantiatedTemplates.add(template);
    });
  const emit = (
    id: string,
    node: ts.Node,
    message: string,
    kind: FindingKind = 'potential',
    confidence: Confidence = 'medium',
  ): void => {
    diagnostics.push(
      diagnostic(id, location(root, node), message, kind, confidence),
    );
  };
  function bridge(input: ts.Node, seen = new Set<ts.Node>()): void {
    if (seen.has(input)) return;
    if (seen.size > 200) {
      emit(
        'IPC008',
        input,
        'Bridge analysis size limit reached.',
        'inconclusive',
        'high',
      );
      return;
    }
    seen.add(input);
    const origin = semantic.origin(input);
    const bound = semantic.unwrap(semantic.initializer(input) ?? input);
    if (
      ts.isCallExpression(bound) &&
      ts.isPropertyAccessExpression(bound.expression) &&
      bound.expression.name.text === 'bind' &&
      /^electron\.ipcRenderer\.(invoke|send|sendSync)$/.test(origin ?? '') &&
      bound.arguments[0] &&
      semantic.origin(bound.arguments[0]) === 'electron.ipcRenderer' &&
      typeof semantic.value(bound.arguments[1]) === 'string'
    )
      return;
    if (
      origin === 'electron.ipcRenderer' ||
      origin?.startsWith('electron.ipcRenderer.')
    ) {
      emit(
        'IPC001',
        input,
        'Raw IPC capability is exposed through contextBridge.',
        'potential',
        'high',
      );
      return;
    }
    const unwrapped = semantic.unwrap(input);
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const item of unwrapped.elements) bridge(item, seen);
      return;
    }
    const obj = semantic.object(input);
    if (obj) {
      for (const value of obj.values()) bridge(value, seen);
      return;
    }
    const fn = semantic.fn(input);
    if (fn?.body) {
      visit(fn.body, (node) => {
        if (!ts.isCallExpression(node)) return;
        const resolved = calls.get(node);
        const method = resolved?.origin ?? semantic.origin(node.expression);
        const args = resolved?.args ?? node.arguments;
        if (!method?.startsWith('electron.ipcRenderer.')) return;
        if (typeof semantic.value(args[0]) !== 'string' && args[0]) {
          const parameters = new Set(
            fn.parameters
              .map((p) => semantic.checker.getSymbolAtLocation(p.name))
              .filter(Boolean),
          );
          let forwarded = false;
          visit(args[0], (part) => {
            const symbol = semantic.checker.getSymbolAtLocation(part);
            if (symbol && parameters.has(symbol)) forwarded = true;
          });
          if (forwarded)
            emit(
              'IPC001',
              node,
              'Exposed bridge function forwards a renderer-selected channel; review any allowlist before the call.',
              'potential',
              'medium',
            );
        }
        if (
          method === 'electron.ipcRenderer.on' ||
          method === 'electron.ipcRenderer.once' ||
          method === 'electron.ipcRenderer.addListener'
        ) {
          const callback = args[1];
          if (callback && !semantic.fn(callback))
            emit(
              'IPC001',
              callback,
              'IPC listener is forwarded directly; the renderer callback may receive the privileged event object.',
              'potential',
              'high',
            );
          const listener = semantic.fn(callback);
          const event = listener?.parameters[0]?.name;
          if (listener?.body && event && ts.isIdentifier(event)) {
            const eventSymbol = semantic.checker.getSymbolAtLocation(event);
            visit(listener.body, (part) => {
              if (
                ts.isCallExpression(part) &&
                part.arguments.some((arg) => {
                  let containsEvent = false;
                  visit(arg, (value) => {
                    const symbol =
                      ts.isIdentifier(value) &&
                      ts.isShorthandPropertyAssignment(value.parent)
                        ? semantic.checker.getShorthandAssignmentValueSymbol(
                            value.parent,
                          )
                        : semantic.checker.getSymbolAtLocation(value);
                    if (ts.isIdentifier(value) && symbol === eventSymbol)
                      containsEvent = true;
                  });
                  return containsEvent;
                })
              )
                emit(
                  'IPC001',
                  part,
                  'A bridge listener forwards the Electron event object to another callback.',
                  'potential',
                  'medium',
                );
            });
          }
        }
      });
    } else {
      const init = semantic.initializer(input);
      if (init) bridge(init, seen);
      else if (
        semantic.value(input) === undefined &&
        input.kind !== ts.SyntaxKind.NullKeyword
      )
        emit(
          'IPC008',
          input,
          'Exposed bridge value cannot be fully resolved.',
          'inconclusive',
          'high',
        );
    }
  }
  function sensitive(
    fn: ts.FunctionLikeDeclaration,
    depth = 0,
    seen = new Set<ts.Node>(),
  ): boolean {
    if (!fn.body || depth > 3 || seen.has(fn)) return false;
    seen.add(fn);
    let result = false;
    const inspect = (node: ts.Node): void => {
      // A nested function's declaration does not prove it executes in a handler.
      if (ts.isFunctionLike(node)) return;
      ts.forEachChild(node, inspect);
      if (!ts.isCallExpression(node)) return;
      const origin = semantic.origin(node.expression);
      if (
        origin &&
        (/^fs(?:\/promises|\.promises)?\.(?:readFile|readFileSync|writeFile|writeFileSync|unlink|rm|rename|open|appendFile|mkdir|copyFile)$/.test(
          origin,
        ) ||
          /^child_process\.(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)$/.test(
            origin,
          ) ||
          origin === 'electron.shell.openExternal')
      )
        result = true;
      const helper = semantic.fn(node.expression);
      if (helper && sensitive(helper, depth + 1, seen)) result = true;
    };
    inspect(fn.body);
    return result;
  }
  for (const file of semantic.program.getSourceFiles()) {
    for (const error of semantic.program.getSyntacticDiagnostics(file)) {
      const pos = file.getLineAndCharacterOfPosition(error.start ?? 0);
      diagnostics.push(
        diagnostic(
          'IPC008',
          {
            file: slash(path.relative(root, file.fileName)),
            line: pos.line + 1,
            column: pos.character + 1,
            endLine: pos.line + 1,
            endColumn: pos.character + 2,
          },
          'Malformed source; findings from this file may be incomplete.',
          'inconclusive',
          'high',
        ),
      );
    }
    visit(file, (node) => {
      if (
        ts.isNewExpression(node) &&
        semantic.origin(node.expression) === 'electron.BrowserWindow'
      ) {
        const options = node.arguments?.[0];
        if (options) {
          const obj = semantic.object(options);
          const prefs = obj?.get('webPreferences');
          if (!obj || (prefs && !semantic.object(prefs)))
            emit(
              'IPC008',
              options,
              'BrowserWindow options cannot be fully resolved.',
              'inconclusive',
              'high',
            );
          if (prefs)
            for (const [key, value] of semantic.object(prefs) ?? []) {
              const unsafe: Record<string, boolean> = {
                nodeIntegration: true,
                contextIsolation: false,
                sandbox: false,
                webSecurity: false,
                allowRunningInsecureContent: true,
                webviewTag: true,
                enableRemoteModule: true,
              };
              if (key in unsafe && semantic.value(value) === unsafe[key])
                emit(
                  'IPC005',
                  value,
                  `Explicit ${key}=${String(unsafe[key])} weakens renderer isolation.`,
                  'static',
                  'high',
                );
              else if (key in unsafe && semantic.value(value) === undefined)
                emit(
                  'IPC008',
                  value,
                  `The ${key} preference cannot be statically resolved.`,
                  'inconclusive',
                  'high',
                );
            }
          if (config.electronVersion && config.electronVersion < 20)
            emit(
              'IPC008',
              node,
              'Electron versions before 20 have different security defaults; absent preferences are not audited.',
              'inconclusive',
              'high',
            );
        }
      }
      if (!ts.isCallExpression(node)) return;
      const origin = semantic.origin(node.expression);
      const resolved = calls.get(node);
      const match = (resolved?.origin ?? origin)?.match(
        /^electron\.(ipcMain|ipcRenderer)\.(handle|handleOnce|on|once|addListener|invoke|send|sendSync)$/,
      );
      if (match && !instantiatedTemplates.has(node)) {
        const role = match[1] === 'ipcMain' ? 'main' : 'renderer';
        const method = match[2]!;
        if (
          (role === 'main' &&
            ['handle', 'handleOnce', 'on', 'once', 'addListener'].includes(
              method,
            )) ||
          (role === 'renderer' &&
            [
              'invoke',
              'send',
              'sendSync',
              'on',
              'once',
              'addListener',
            ].includes(method))
        ) {
          const args = resolved?.args ?? node.arguments;
          const value = semantic.value(args[0]);
          const channel = typeof value === 'string' ? value : null;
          endpoints.push({
            role,
            method,
            channel,
            location: location(root, node),
            ...(config.applicationRoots
              ? {
                  scope:
                    config.applicationRoots.map(slash).find((scope) => {
                      const file = slash(
                        path.relative(root, node.getSourceFile().fileName),
                      );
                      return withinScope(file, scope);
                    }) ?? '<unassigned>',
                }
              : {}),
          });
          if (channel === null)
            emit(
              'IPC007',
              node,
              'Channel expression cannot be statically resolved.',
              'inconclusive',
              'high',
            );
          if (role === 'main') {
            const fn = semantic.fn(args[1]);
            if (fn && sensitive(fn))
              emit(
                'IPC002',
                node,
                'Handler reaches a filesystem, process execution, or external URL API. Review sender and payload validation, including helpers.',
                'potential',
                'low',
              );
          }
        }
      }
      if (
        origin === 'electron.contextBridge.exposeInMainWorld' &&
        node.arguments[1]
      )
        bridge(node.arguments[1]);
      if (origin === 'electron.shell.openExternal') {
        const url = semantic.value(node.arguments[0]);
        if (typeof url !== 'string' || !/^https:\/\//i.test(url))
          emit(
            'IPC006',
            node,
            'External URL needs protocol and destination validation.',
            'potential',
            'low',
          );
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'loadURL'
      ) {
        const url = semantic.value(node.arguments[0]);
        // Receiver provenance is deliberately required; unrelated loadURL methods are ignored.
        const decl = semantic.declaration(node.expression.expression);
        if (
          decl &&
          ts.isVariableDeclaration(decl) &&
          decl.initializer &&
          ts.isNewExpression(decl.initializer) &&
          semantic.origin(decl.initializer.expression) ===
            'electron.BrowserWindow' &&
          typeof url === 'string' &&
          /^http:\/\//i.test(url)
        )
          emit(
            'IPC009',
            node,
            'BrowserWindow loads content over HTTP.',
            'static',
            'high',
          );
      }
    });
  }
  const main = endpoints.filter((e) => e.role === 'main');
  const key = (e: Endpoint, value: string): string =>
    JSON.stringify([e.scope ?? '.', value]);
  const registrations = new Map<string, Endpoint[]>();
  const dynamicMethods = new Set(
    main.filter((e) => e.channel === null).map((e) => key(e, e.method)),
  );
  for (const endpoint of main)
    if (endpoint.channel !== null) {
      const group = registrations.get(key(endpoint, endpoint.channel)) ?? [];
      group.push(endpoint);
      registrations.set(key(endpoint, endpoint.channel), group);
    }
  for (const caller of endpoints.filter(
    (e) =>
      e.role === 'renderer' &&
      ['invoke', 'send', 'sendSync'].includes(e.method) &&
      e.channel !== null,
  )) {
    const expected =
      caller.method === 'invoke'
        ? ['handle', 'handleOnce']
        : ['on', 'once', 'addListener'];
    const unassigned = caller.scope === '<unassigned>';
    const matches = unassigned
      ? []
      : (registrations.get(key(caller, caller.channel!)) ?? []);
    if (!matches.some((e) => expected.includes(e.method))) {
      const dynamic =
        unassigned ||
        expected.some((method) => dynamicMethods.has(key(caller, method)));
      diagnostics.push(
        diagnostic(
          'IPC003',
          caller.location,
          unassigned
            ? 'Caller is outside configured application roots; its relationship cannot be assigned.'
            : dynamic
              ? 'No static matching handler was discovered; dynamic registrations may handle this call.'
              : `No matching ${expected.join('/')} registration was discovered for this ${caller.method} call.`,
          'inconclusive',
          dynamic ? 'low' : 'medium',
          matches.map((e) => e.location),
        ),
      );
    }
  }
  const groups = new Map<string, Endpoint[]>();
  for (const endpoint of main.filter(
    (e) =>
      ['handle', 'handleOnce'].includes(e.method) &&
      e.channel !== null &&
      e.scope !== '<unassigned>',
  )) {
    const group = groups.get(key(endpoint, endpoint.channel!)) ?? [];
    group.push(endpoint);
    groups.set(key(endpoint, endpoint.channel!), group);
  }
  for (const group of groups.values())
    if (group.length > 1)
      diagnostics.push(
        diagnostic(
          'IPC004',
          group[0]!.location,
          'Multiple invoke handler registration sites share this channel; check whether they execute together.',
          'potential',
          'medium',
          group.slice(1).map((e) => e.location),
        ),
      );
  return { diagnostics, endpoints };
}
