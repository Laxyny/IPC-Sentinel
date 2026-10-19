import ts from 'typescript';
import path from 'node:path';
import { slash } from './discovery.js';
import { withinScope } from './paths.js';
import { Semantic, visit } from './semantic.js';
import { resolveIpcCall } from './wrappers.js';
import { inspectHandler, privilegedOrigin } from './handler.js';
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
  const handlerCache = new Map<
    ts.FunctionLikeDeclaration,
    ReturnType<typeof inspectHandler>
  >();
  const handlerEvidence = (fn: ts.FunctionLikeDeclaration) => {
    let evidence = handlerCache.get(fn);
    if (!evidence) {
      evidence = inspectHandler(semantic, fn);
      handlerCache.set(fn, evidence);
    }
    return evidence;
  };
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
  function isWindow(input: ts.Node): boolean {
    let receiver: ts.Node | undefined = input;
    for (let depth = 0; receiver && depth < 10; depth++) {
      receiver = semantic.unwrap(receiver);
      if (ts.isNewExpression(receiver))
        return (
          semantic.origin(receiver.expression) === 'electron.BrowserWindow'
        );
      const decl = semantic.declaration(receiver);
      const next: ts.Node | undefined =
        semantic.initializer(receiver) ??
        (decl && ts.isVariableDeclaration(decl) ? decl.initializer : undefined);
      if (next === receiver) break;
      receiver = next;
    }
    return false;
  }
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
    if (
      privilegedOrigin(origin) &&
      /^(fs|child_process)(\.|\/)/.test(origin!)
    ) {
      emit(
        'IPC001',
        input,
        'A raw filesystem or process capability is exposed through contextBridge.',
        'potential',
        'high',
      );
      return;
    }
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
      const evidence = handlerEvidence(fn);
      if (evidence.controlled && evidence.sinks.length)
        emit(
          'IPC001',
          input,
          'An exposed bridge function forwards renderer-controlled input to a privileged API; review validation.',
          'potential',
          'medium',
        );
      visit(fn.body, (node) => {
        if (!ts.isCallExpression(node)) return;
        const resolved = calls.get(node);
        const method = resolved?.origin ?? semantic.origin(node.expression);
        const args = resolved?.args ?? node.arguments;
        if (!method?.startsWith('electron.ipcRenderer.')) return;
        if (
          /^electron\.ipcRenderer\.(invoke|send|sendSync|on|once|addListener)$/.test(
            method,
          ) &&
          typeof semantic.value(args[0]) !== 'string' &&
          args[0]
        ) {
          const parameters = new Set(
            fn.parameters
              .map((p) => semantic.checker.getSymbolAtLocation(p.name))
              .filter(Boolean),
          );
          let forwarded = false;
          const followed = new Set<ts.Node>();
          const inspectChannel = (part: ts.Node, depth = 0): void => {
            if (depth > 10 || followed.size > 200 || followed.has(part)) return;
            followed.add(part);
            const symbol = semantic.checker.getSymbolAtLocation(part);
            if (symbol && parameters.has(symbol)) forwarded = true;
            if (ts.isIdentifier(part)) {
              const decl = semantic.declaration(part);
              const init =
                decl &&
                ts.isBindingElement(decl) &&
                ts.isVariableDeclaration(decl.parent.parent)
                  ? decl.parent.parent.initializer
                  : semantic.initializer(part);
              if (init) inspectChannel(init, depth + 1);
            }
            ts.forEachChild(part, (child) => inspectChannel(child, depth + 1));
          };
          inspectChannel(args[0]);
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
                  const seen = new Set<ts.Node>();
                  const containsEvent = (
                    input: ts.Node,
                    depth = 0,
                  ): boolean => {
                    if (depth > 12 || seen.size > 200 || seen.has(input))
                      return false;
                    seen.add(input);
                    const value = semantic.unwrap(input);
                    if (ts.isPropertyAccessExpression(value))
                      return (
                        ['sender', 'senderFrame'].includes(value.name.text) &&
                        containsEvent(value.expression, depth + 1)
                      );
                    if (ts.isElementAccessExpression(value))
                      return (
                        ['sender', 'senderFrame'].includes(
                          String(semantic.value(value.argumentExpression)),
                        ) && containsEvent(value.expression, depth + 1)
                      );
                    const symbol =
                      ts.isIdentifier(value) &&
                      ts.isShorthandPropertyAssignment(value.parent)
                        ? semantic.checker.getShorthandAssignmentValueSymbol(
                            value.parent,
                          )
                        : semantic.checker.getSymbolAtLocation(value);
                    if (ts.isIdentifier(value)) {
                      if (symbol === eventSymbol) return true;
                      const init = semantic.initializer(value);
                      if (init && containsEvent(init, depth + 1)) return true;
                    }
                    let found = false;
                    ts.forEachChild(value, (child) => {
                      if (containsEvent(child, depth + 1)) found = true;
                    });
                    return found;
                  };
                  return containsEvent(arg);
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
            if (fn) {
              const evidence = handlerEvidence(fn);
              if (evidence.sinks.length) {
                const finding = diagnostic(
                  'IPC002',
                  location(root, node),
                  'Handler reaches a privileged API. Observed guards and input dependencies are review evidence, not proof of validation.',
                  'potential',
                  'low',
                );
                finding.evidence = {
                  validation: evidence.guards.length
                    ? evidence.delegated
                      ? 'delegated-guard'
                      : 'observed-guard'
                    : evidence.opaque
                      ? 'unverified'
                      : 'not-observed',
                  ipcInput: evidence.controlled
                    ? 'observed'
                    : evidence.limited
                      ? 'unresolved'
                      : 'not-observed',
                  sinkLocations: evidence.sinks.map((n) => location(root, n)),
                  validationLocations: evidence.guards.map((n) =>
                    location(root, n),
                  ),
                  analysisLimited: evidence.limited,
                };
                finding.relatedLocations = [
                  ...finding.evidence.sinkLocations,
                  ...finding.evidence.validationLocations,
                ];
                diagnostics.push(finding);
              }
            }
          }
        }
      }
      if (
        origin === 'electron.contextBridge.exposeInMainWorld' &&
        node.arguments[1]
      )
        bridge(node.arguments[1]);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'setWindowOpenHandler'
      ) {
        const receiver = node.expression.expression;
        if (
          ts.isPropertyAccessExpression(receiver) &&
          receiver.name.text === 'webContents' &&
          isWindow(receiver.expression)
        ) {
          const fn = semantic.fn(node.arguments[0]);
          let returned: ts.Node | undefined = fn?.body;
          if (returned && ts.isBlock(returned)) {
            const statement =
              returned.statements.length === 1
                ? returned.statements[0]
                : undefined;
            returned =
              statement && ts.isReturnStatement(statement)
                ? statement.expression
                : undefined;
          }
          const action =
            returned &&
            semantic.object(semantic.unwrap(returned))?.get('action');
          if (action && semantic.value(action) === 'allow')
            emit(
              'IPC009',
              node,
              'Window-open handler unconditionally allows new windows; review destination and child-window isolation.',
              'potential',
              'medium',
            );
        }
      }
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
        const browserWindow = isWindow(node.expression.expression);
        if (browserWindow && typeof url === 'string' && /^http:\/\//i.test(url))
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
