import ts from 'typescript';
import type { Semantic } from './semantic.js';

export interface IpcCall {
  origin: string;
  args: (ts.Node | undefined)[];
  templates: ts.CallExpression[];
}

function returnedExpression(
  fn: ts.FunctionLikeDeclaration,
): ts.Node | undefined {
  if (!fn.body) return undefined;
  if (!ts.isBlock(fn.body)) return fn.body;
  const last = fn.body.statements.at(-1);
  return last && ts.isReturnStatement(last)
    ? last.expression
    : last && ts.isExpressionStatement(last)
      ? last.expression
      : undefined;
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
  let effectiveBindings = bindings;
  const substitute = (input: ts.Node): ts.Node | undefined => {
    const node = semantic.unwrap(input);
    const decl = semantic.declaration(node);
    return decl && effectiveBindings.has(decl)
      ? effectiveBindings.get(decl)
      : node;
  };
  const args = call.arguments.map(substitute);
  const origin = semantic.origin(call.expression);
  if (
    /^electron\.(ipcMain|ipcRenderer)\.(handle|handleOnce|on|once|addListener|invoke|send|sendSync)$/.test(
      origin ?? '',
    )
  )
    return { origin: origin!, args, templates: [] };
  let fn = semantic.fn(call.expression);
  // Recognize a factory only when it returns a function directly. No factory
  // invocation executes and no arbitrary returned object or state is modeled.
  if (!fn) {
    const factoryCall = semantic.initializer(call.expression);
    if (factoryCall && ts.isCallExpression(factoryCall)) {
      const factory = semantic.fn(factoryCall.expression);
      const returned = factory && returnedExpression(factory);
      if (
        factory &&
        returned &&
        factory.body &&
        (!ts.isBlock(factory.body) || factory.body.statements.length === 1) &&
        factory.parameters.every(
          (p) => ts.isIdentifier(p.name) && !p.initializer && !p.dotDotDotToken,
        )
      ) {
        fn = semantic.fn(returned);
        effectiveBindings = new Map(bindings);
        factory.parameters.forEach((p, i) =>
          effectiveBindings.set(p, factoryCall.arguments[i]),
        );
      }
    }
  }
  if (
    !fn?.body ||
    fn.parameters.some((p) => !ts.isIdentifier(p.name) || p.initializer)
  )
    return undefined;
  const next = new Map(effectiveBindings);
  for (let i = 0; i < fn.parameters.length; i++) {
    const parameter = fn.parameters[i]!;
    next.set(parameter, parameter.dotDotDotToken ? undefined : args[i]);
  }
  effectiveBindings = next;
  let expression: ts.Node = fn.body;
  if (ts.isBlock(expression)) {
    if (expression.statements.length > 11 || !expression.statements.length)
      return undefined;
    for (const prelude of expression.statements.slice(0, -1)) {
      if (
        !ts.isVariableStatement(prelude) ||
        !(prelude.declarationList.flags & ts.NodeFlags.Const)
      )
        return undefined;
      for (const decl of prelude.declarationList.declarations) {
        if (
          !ts.isIdentifier(decl.name) ||
          !decl.initializer ||
          (!ts.isIdentifier(semantic.unwrap(decl.initializer)) &&
            semantic.value(decl.initializer) === undefined)
        )
          return undefined;
        next.set(decl, substitute(decl.initializer));
      }
    }
    const statement = expression.statements.at(-1)!;
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
  const resolved = resolveIpcCall(semantic, expression, depth + 1, next, seen);
  return resolved
    ? { ...resolved, templates: [expression, ...resolved.templates] }
    : undefined;
}
