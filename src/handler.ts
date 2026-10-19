import ts from 'typescript';
import type { Semantic } from './semantic.js';

export interface HandlerEvidence {
  sinks: ts.Node[];
  guards: ts.Node[];
  delegated: boolean;
  controlled: boolean;
  opaque: boolean;
  limited: boolean;
}

export function privilegedOrigin(origin: string | undefined): boolean {
  return (
    !!origin &&
    (/^fs(?:\/promises|\.promises)?\.(?:readFile|readFileSync|writeFile|writeFileSync|unlink|rm|rename|open|appendFile|mkdir|copyFile)$/.test(
      origin,
    ) ||
      /^child_process\.(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)$/.test(
        origin,
      ) ||
      /^electron\.(?:shell\.(?:openExternal|openPath|showItemInFolder|trashItem)|app\.(?:setPath|setLoginItemSettings|relaunch|exit|quit))$/.test(
        origin,
      ))
  );
}

// Syntactic evidence only. A guard never suppresses privileged-handler review.
export function inspectHandler(
  semantic: Semantic,
  fn: ts.FunctionLikeDeclaration,
): HandlerEvidence {
  const result: HandlerEvidence = {
    sinks: [],
    guards: [],
    delegated: false,
    controlled: false,
    opaque: false,
    limited: false,
  };
  const active = new Set<ts.Node>();
  let budget = 2000;
  const depends = (
    node: ts.Node,
    parameters: Set<ts.Declaration>,
    seen = new Set<ts.Node>(),
    depth = 0,
  ): boolean => {
    if (depth > 12 || seen.has(node)) return false;
    seen.add(node);
    const decl = semantic.declaration(node);
    if (decl && parameters.has(decl)) return true;
    if (ts.isIdentifier(node)) {
      const init = semantic.initializer(node);
      if (init && depends(init, parameters, seen, depth + 1)) return true;
    }
    let found = false;
    ts.forEachChild(node, (child) => {
      if (depends(child, parameters, seen, depth + 1)) found = true;
    });
    return found;
  };
  const exits = (node: ts.Statement): boolean =>
    ts.isThrowStatement(node) ||
    ts.isReturnStatement(node) ||
    (ts.isBlock(node) &&
      !!node.statements.at(-1) &&
      exits(node.statements.at(-1)!));
  const inspect = (
    current: ts.FunctionLikeDeclaration,
    parameters: Set<ts.Declaration>,
    depth: number,
  ): void => {
    if (depth > 3 || active.has(current)) {
      result.limited = true;
      return;
    }
    if (!current.body) return;
    active.add(current);
    const walk = (node: ts.Node): void => {
      if (--budget < 0) {
        result.limited = true;
        return;
      }
      if (ts.isFunctionLike(node)) return;
      if (
        ts.isIfStatement(node) &&
        depends(node.expression, parameters) &&
        (exits(node.thenStatement) ||
          (node.elseStatement && exits(node.elseStatement)))
      ) {
        result.guards.push(node);
        if (depth > 0) result.delegated = true;
      }
      if (ts.isCallExpression(node)) {
        const origin = semantic.origin(node.expression);
        const sink = privilegedOrigin(origin);
        const controlled = node.arguments.some((arg) =>
          depends(arg, parameters),
        );
        if (sink) {
          result.sinks.push(node);
          result.controlled ||= controlled;
        }
        const helper = semantic.fn(node.expression);
        if (helper) {
          const inputs = new Set<ts.Declaration>();
          helper.parameters.forEach((parameter, i) => {
            if (node.arguments[i] && depends(node.arguments[i]!, parameters))
              inputs.add(parameter);
          });
          // Closure references to the handler's parameters remain visible.
          for (const parameter of parameters) inputs.add(parameter);
          inspect(helper, inputs, depth + 1);
        } else if (!sink && controlled) result.opaque = true;
      }
      ts.forEachChild(node, walk);
    };
    walk(current.body);
    active.delete(current);
  };
  inspect(fn, new Set(fn.parameters), 0);
  return result;
}
