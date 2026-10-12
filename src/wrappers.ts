import ts from 'typescript';
import type { Semantic } from './semantic.js';

export interface IpcCall {
  origin: string;
  args: (ts.Node | undefined)[];
  templates: ts.CallExpression[];
}

// Only single-call forwarding functions qualify. Guards, loops, factories and
// receiver state need a different model and are deliberately not interpreted.
export function resolveIpcCall(
  semantic: Semantic,
  call: ts.CallExpression,
  depth = 0,
  bindings = new Map<ts.Declaration, ts.Node | undefined>(),
  seen = new Set<ts.Node>(),
): IpcCall | undefined {
  if (depth > 3 || seen.has(call)) return undefined;
  seen.add(call);
  const substitute = (input: ts.Node): ts.Node | undefined => {
    const node = semantic.unwrap(input);
    const decl = semantic.declaration(node);
    return decl && bindings.has(decl) ? bindings.get(decl) : node;
  };
  const args = call.arguments.map(substitute);
  const origin = semantic.origin(call.expression);
  if (
    /^electron\.(ipcMain|ipcRenderer)\.(handle|handleOnce|on|once|addListener|invoke|send|sendSync)$/.test(
      origin ?? '',
    )
  )
    return { origin: origin!, args, templates: [] };
  const fn = semantic.fn(call.expression);
  if (
    !fn?.body ||
    fn.parameters.some((p) => !ts.isIdentifier(p.name) || p.initializer)
  )
    return undefined;
  let expression: ts.Node = fn.body;
  if (ts.isBlock(expression)) {
    if (expression.statements.length !== 1) return undefined;
    const statement = expression.statements[0]!;
    if (ts.isReturnStatement(statement) && statement.expression)
      expression = statement.expression;
    else if (ts.isExpressionStatement(statement))
      expression = statement.expression;
    else return undefined;
  }
  expression = semantic.unwrap(expression);
  if (ts.isAwaitExpression(expression))
    expression = semantic.unwrap(expression.expression);
  if (!ts.isCallExpression(expression)) return undefined;
  const next = new Map(bindings);
  for (let i = 0; i < fn.parameters.length; i++) {
    const parameter = fn.parameters[i]!;
    // Rest arguments are not represented as a single expression.
    next.set(parameter, parameter.dotDotDotToken ? undefined : args[i]);
  }
  const resolved = resolveIpcCall(semantic, expression, depth + 1, next, seen);
  return resolved
    ? { ...resolved, templates: [expression, ...resolved.templates] }
    : undefined;
}
