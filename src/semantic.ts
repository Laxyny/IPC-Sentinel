import ts from 'typescript';
import path from 'node:path';
import { readJson } from './config.js';
import type { Discovery } from './discovery.js';

type AliasConfig = { base: string; paths: Record<string, string[]> };
export async function createSemantic(discovery: Discovery): Promise<Semantic> {
  const aliases = new Map<string, AliasConfig>();
  const checked = new Set<string>();
  for (const file of discovery.sources.keys()) {
    let dir = path.dirname(file);
    while (!checked.has(dir)) {
      checked.add(dir);
      try {
        const raw = (await readJson(path.join(dir, 'tsconfig.json'), true)) as {
          compilerOptions?: { baseUrl?: unknown; paths?: unknown };
          extends?: unknown;
        };
        const opts = raw.compilerOptions;
        if (raw.extends)
          discovery.observations.push(
            'Inherited tsconfig settings are not loaded; supply local baseUrl and paths for aliases.',
          );
        if (
          opts &&
          (opts.baseUrl === undefined || typeof opts.baseUrl === 'string') &&
          opts.paths &&
          typeof opts.paths === 'object'
        ) {
          const paths: Record<string, string[]> = {};
          for (const [key, value] of Object.entries(opts.paths))
            if (
              Array.isArray(value) &&
              value.every((v) => typeof v === 'string')
            )
              paths[key] = value;
          aliases.set(dir, {
            base: path.resolve(dir, opts.baseUrl ?? '.'),
            paths,
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          discovery.issues.push({
            file: path.relative(
              discovery.root,
              path.join(dir, 'tsconfig.json'),
            ),
            message:
              'tsconfig JSON could not be read; aliases may be incomplete',
          });
      }
      if (dir === discovery.root) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noLib: true,
    noResolve: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const sources = new Map<string, ts.SourceFile>();
  for (const [file, text] of discovery.sources)
    sources.set(
      path.resolve(file),
      ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
    );
  function resolve(
    specifier: string,
    containing: string,
  ): ts.ResolvedModule | undefined {
    const candidates: string[] = [];
    if (specifier.startsWith('.'))
      candidates.push(path.resolve(path.dirname(containing), specifier));
    else {
      let dir = path.dirname(path.resolve(containing));
      while (true) {
        const config = aliases.get(dir);
        if (config) {
          for (const [pattern, targets] of Object.entries(config.paths)) {
            const star = pattern.indexOf('*');
            const match =
              star < 0
                ? specifier === pattern
                : specifier.startsWith(pattern.slice(0, star)) &&
                  specifier.endsWith(pattern.slice(star + 1));
            if (match)
              for (const target of targets)
                candidates.push(
                  path.resolve(
                    config.base,
                    target.replace(
                      '*',
                      star < 0
                        ? ''
                        : specifier.slice(
                            star,
                            specifier.length - (pattern.length - star - 1),
                          ),
                    ),
                  ),
                );
          }
          break;
        }
        if (dir === discovery.root || path.dirname(dir) === dir) break;
        dir = path.dirname(dir);
      }
    }
    for (const candidate of candidates) {
      const stem = candidate.replace(/\.(?:mjs|cjs|js)$/, '');
      for (const file of [
        candidate,
        ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(
          (ext) => stem + ext,
        ),
        ...['.ts', '.js'].map((ext) => path.join(candidate, 'index' + ext)),
      ])
        if (sources.has(file)) return { resolvedFileName: file };
    }
    return undefined;
  }
  const host: ts.CompilerHost = {
    getSourceFile: (file) => sources.get(path.resolve(file)),
    getDefaultLibFileName: () => '',
    writeFile: () => {},
    getCurrentDirectory: () => discovery.root,
    getDirectories: () => [],
    fileExists: (file) => sources.has(path.resolve(file)),
    readFile: (file) => discovery.sources.get(path.resolve(file)),
    getCanonicalFileName: (file) => file,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n',
    resolveModuleNames: (names, file) =>
      names.map((name) => resolve(name, file)),
  };
  return new Semantic(ts.createProgram([...sources.keys()], options, host));
}

export class Semantic {
  readonly checker: ts.TypeChecker;
  constructor(readonly program: ts.Program) {
    this.checker = program.getTypeChecker();
  }
  declaration(node: ts.Node): ts.Declaration | undefined {
    let symbol = this.checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      const target = this.checker.getAliasedSymbol(symbol);
      if (target.declarations?.length) symbol = target;
    }
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }
  unwrap(node: ts.Node): ts.Node {
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      node = node.expression;
    return node;
  }
  initializer(node: ts.Node, depth = 0): ts.Node | undefined {
    if (depth > 20) return undefined;
    const decl = this.declaration(node);
    if (
      decl &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      ts.isVariableDeclarationList(decl.parent) &&
      decl.parent.flags & ts.NodeFlags.Const
    )
      return decl.initializer;
    if (decl && ts.isPropertyAssignment(decl)) return decl.initializer;
    if (decl && ts.isShorthandPropertyAssignment(decl)) {
      const symbol = this.checker.getShorthandAssignmentValueSymbol(decl);
      const value = symbol?.valueDeclaration;
      if (value && ts.isVariableDeclaration(value)) return value.initializer;
    }
    if (
      decl &&
      ts.isBindingElement(decl) &&
      ts.isVariableDeclaration(decl.parent.parent) &&
      decl.parent.parent.initializer &&
      ts.isObjectBindingPattern(decl.parent)
    ) {
      const object = this.object(decl.parent.parent.initializer, depth + 1);
      return object?.get((decl.propertyName ?? decl.name).getText());
    }
    return undefined;
  }
  value(
    input: ts.Node | undefined,
    depth = 0,
  ): string | boolean | number | undefined {
    if (!input || depth > 20) return undefined;
    const node = this.unwrap(input);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = this.value(node.left, depth + 1);
      const right = this.value(node.right, depth + 1);
      if (typeof left === 'string' && typeof right === 'string')
        return left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const part = this.value(span.expression, depth + 1);
        if (part === undefined) return undefined;
        value += String(part) + span.literal.text;
      }
      return value;
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : this.value(node.argumentExpression, depth + 1);
      const item =
        typeof name === 'string'
          ? this.object(node.expression, depth + 1)?.get(name)
          : undefined;
      if (item) return this.value(item, depth + 1);
    }
    const init = this.initializer(node, depth + 1);
    return init && init !== node ? this.value(init, depth + 1) : undefined;
  }
  object(input: ts.Node, depth = 0): Map<string, ts.Node> | undefined {
    if (depth > 20) return undefined;
    const node = this.unwrap(input);
    if (!ts.isObjectLiteralExpression(node)) {
      const init = this.initializer(node, depth + 1);
      return init && init !== node ? this.object(init, depth + 1) : undefined;
    }
    const result = new Map<string, ts.Node>();
    for (const prop of node.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const spread = this.object(prop.expression, depth + 1);
        if (!spread) return undefined;
        for (const [key, value] of spread) result.set(key, value);
      } else {
        const name =
          prop.name &&
          (ts.isComputedPropertyName(prop.name)
            ? this.value(prop.name.expression, depth + 1)
            : ts.isStringLiteralLike(prop.name) || ts.isIdentifier(prop.name)
              ? prop.name.text
              : undefined);
        if (typeof name !== 'string') return undefined;
        result.set(
          name,
          ts.isPropertyAssignment(prop)
            ? prop.initializer
            : ts.isShorthandPropertyAssignment(prop)
              ? prop.name
              : prop,
        );
      }
    }
    return result;
  }
  origin(input: ts.Node, depth = 0): string | undefined {
    if (depth > 20) return undefined;
    const node = this.unwrap(input);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'bind'
    )
      return this.origin(node.expression.expression, depth + 1);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      !this.declaration(node.expression) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      return node.arguments[0].text.replace(/^node:/, '');
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const base = this.origin(node.expression, depth + 1);
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : this.value(node.argumentExpression);
      if (base && typeof name === 'string') return `${base}.${name}`;
    }
    const decl = this.declaration(node);
    if (decl && ts.isImportSpecifier(decl)) {
      const imp = decl.parent.parent.parent;
      if (
        ts.isImportDeclaration(imp) &&
        ts.isStringLiteral(imp.moduleSpecifier)
      )
        return `${imp.moduleSpecifier.text.replace(/^node:/, '')}.${(decl.propertyName ?? decl.name).text}`;
    }
    if (decl && (ts.isNamespaceImport(decl) || ts.isImportClause(decl))) {
      const imp = ts.isNamespaceImport(decl) ? decl.parent.parent : decl.parent;
      if (
        ts.isImportDeclaration(imp) &&
        ts.isStringLiteral(imp.moduleSpecifier)
      )
        return imp.moduleSpecifier.text.replace(/^node:/, '');
    }
    if (
      decl &&
      ts.isBindingElement(decl) &&
      ts.isVariableDeclaration(decl.parent.parent) &&
      decl.parent.parent.initializer
    ) {
      const base = this.origin(decl.parent.parent.initializer, depth + 1);
      if (base && ts.isObjectBindingPattern(decl.parent))
        return `${base}.${(decl.propertyName ?? decl.name).getText()}`;
    }
    const init = this.initializer(node, depth + 1);
    return init && init !== node ? this.origin(init, depth + 1) : undefined;
  }
  fn(input: ts.Node | undefined): ts.FunctionLikeDeclaration | undefined {
    if (!input) return undefined;
    const node = this.unwrap(input);
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    )
      return node;
    const decl = this.declaration(node);
    if (decl && ts.isFunctionDeclaration(decl)) return decl;
    const init = this.initializer(node);
    return init ? this.fnDirect(init) : undefined;
  }
  private fnDirect(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
    node = this.unwrap(node);
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
      ? node
      : undefined;
  }
}
export function visit(node: ts.Node, action: (node: ts.Node) => void): void {
  action(node);
  ts.forEachChild(node, (child) => visit(child, action));
}
