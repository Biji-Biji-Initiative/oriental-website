import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const adminLoginRoute = "app/api/admin/login/route.ts";
const adminAuthPath = resolve("lib/server/admin-auth.ts");
const adminRoutePath = resolve("lib/server/admin-route.ts");
const sourceExtensionList = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"] as const;
const sourceExtensions = `{${sourceExtensionList.join(",")}}`;
const routeConfigExports = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "generateStaticParams",
]);
type RuntimeExportKind = "class" | "function" | "reexport" | "variable";
const allowedAdminAuthRuntimeExports: ReadonlyMap<string, RuntimeExportKind> = new Map([
  ["adminCookieName", "variable"],
  ["verifyAdminLoginCredential", "function"],
  ["createAdminLoginSession", "function"],
  ["verifyAdminSessionCookie", "function"],
  ["verifyAdminRequest", "function"],
  ["verifyAdminPermission", "function"],
  ["adminAuthFailureStatus", "function"],
  ["isSameOriginJsonRequest", "function"],
  ["adminCookieHeader", "function"],
  ["clearAdminCookieHeader", "function"],
] as const);
const canonicalAdminRoutePermissions = {
  "app/api/admin/evals/route.ts": { POST: "evals.run" },
  "app/api/admin/leads/[leadId]/route.ts": { PATCH: "leads.update" },
  "app/api/admin/leads/archive/route.ts": { POST: "leads.archive" },
  "app/api/admin/leads/bulk/route.ts": { POST: "leads.bulk_assign" },
  [adminLoginRoute]: { POST: "login" },
  "app/api/admin/logout/route.ts": { POST: "session.logout" },
  "app/api/admin/metrics/route.ts": { GET: "dashboard.aggregate" },
  "app/api/admin/privacy/route.ts": { DELETE: "privacy.delete" },
  "app/api/admin/retention/route.ts": { POST: "ops.retention" },
  "app/api/admin/review/route.ts": { GET: "dashboard.read" },
  "app/api/admin/sla-check/route.ts": { POST: "ops.sla_check" },
  "app/api/admin/voice-sessions/[reviewId]/route.ts": {
    GET: "voice.read",
    PATCH: "voice.follow_up",
  },
} as const;
const canonicalAdminRoutes = Object.keys(canonicalAdminRoutePermissions).sort();
const httpMethodNames = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type HttpMethod = (typeof httpMethodNames)[number];
const httpMethods = new Set<string>(httpMethodNames);
const protectedLoginSymbols = new Set(["verifyAdminLoginCredential", "createAdminLoginSession"]);
const protectedRuntimeSymbols = new Set([...protectedLoginSymbols, "sign", "verifyAdminBearerToken"]);
const parsedTsConfig = ts.parseJsonConfigFileContent(
  ts.readConfigFile("tsconfig.json", ts.sys.readFile).config,
  ts.sys,
  process.cwd(),
);

function isProductionRootPath(path: string) {
  return (
    !path.startsWith(".") &&
    !path.startsWith("node_modules/") &&
    !path.startsWith("convex/_generated/") &&
    !path.includes("/__tests__/") &&
    !/(?:^|\/)tests?\//u.test(path) &&
    !/\.(?:test|spec)\.[^.]+$/u.test(path) &&
    !path.endsWith(".d.ts")
  );
}

async function effectiveNextPageExtensions(root = process.cwd()) {
  const [{ default: loadConfig }, { PHASE_PRODUCTION_BUILD }] = await Promise.all([
    import("next/dist/server/config.js"),
    import("next/constants.js"),
  ]);
  const config = await loadConfig(PHASE_PRODUCTION_BUILD, root, { silent: true });
  if (
    !Array.isArray(config.pageExtensions) ||
    config.pageExtensions.length === 0 ||
    config.pageExtensions.some((extension) => typeof extension !== "string" || extension.length === 0)
  ) {
    throw new Error("Next effective pageExtensions must be a non-empty string array");
  }
  return config.pageExtensions;
}

function unsupportedNextPageExtensions(pageExtensions: readonly string[]) {
  return pageExtensions.filter(
    (extension) => !sourceExtensionList.includes(extension as (typeof sourceExtensionList)[number]),
  );
}

function governedProgramPaths(program: ts.Program, root = process.cwd()) {
  const repositoryRoot = resolve(root);
  return program
    .getSourceFiles()
    .filter((source) => !source.isDeclarationFile)
    .map((source) => relative(repositoryRoot, resolve(source.fileName)).replaceAll("\\", "/"))
    .filter(
      (path) =>
        path !== ".." &&
        !path.startsWith("../") &&
        !path.startsWith("node_modules/") &&
        sourceExtensionList.includes(path.slice(path.lastIndexOf(".") + 1) as (typeof sourceExtensionList)[number]),
    )
    .sort();
}

function routePatternCanMatchPrefix(pattern: string[], prefix = ["api", "admin"]) {
  const memo = new Map<string, boolean>();
  const visit = (patternIndex: number, prefixIndex: number): boolean => {
    if (prefixIndex === prefix.length) return true;
    if (patternIndex === pattern.length) return false;
    const key = `${patternIndex}:${prefixIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const segment = pattern[patternIndex] ?? "";
    const target = prefix[prefixIndex] ?? "";
    let matches = false;
    if (/^\[\[\.\.\.[^\]]+\]\]$/u.test(segment)) {
      matches =
        visit(patternIndex + 1, prefixIndex) ||
        visit(patternIndex + 1, prefixIndex + 1) ||
        visit(patternIndex, prefixIndex + 1);
    } else if (/^\[\.\.\.[^\]]+\]$/u.test(segment)) {
      matches = visit(patternIndex + 1, prefixIndex + 1) || visit(patternIndex, prefixIndex + 1);
    } else if (/^\[[^\]]+\]$/u.test(segment) || segment.startsWith("(")) {
      matches = visit(patternIndex + 1, prefixIndex + 1);
    } else {
      matches = segment === target && visit(patternIndex + 1, prefixIndex + 1);
    }
    memo.set(key, matches);
    return matches;
  };
  return visit(0, 0);
}

function routePatternForSourcePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  const extension = normalized.slice(normalized.lastIndexOf(".") + 1);
  if (!sourceExtensionList.includes(extension as (typeof sourceExtensionList)[number])) return null;
  const appMatch = /^(?:src\/)?app\/(.*)\/route\.[^.]+$/u.exec(normalized);
  if (appMatch) {
    return (appMatch[1] ?? "")
      .split("/")
      .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")) && !segment.startsWith("@"));
  }
  const pagesMatch = /^(?:src\/)?pages\/(api(?:\/.*)?)\.[^.]+$/u.exec(normalized);
  if (!pagesMatch) return null;
  const segments = (pagesMatch[1] ?? "").split("/");
  if (segments.at(-1) === "index") segments.pop();
  return segments;
}

function routeCanMatchAdminPath(path: string) {
  const pattern = routePatternForSourcePath(path);
  return Boolean(pattern && routePatternCanMatchPrefix(pattern));
}

function discoverAdminRoutePaths(root = process.cwd()) {
  return globSync(
    [
      `{app,src/app}/**/route.${sourceExtensions}`,
      `{pages,src/pages}/api/*.${sourceExtensions}`,
      `{pages,src/pages}/api/**/*.${sourceExtensions}`,
    ],
    { cwd: root },
  )
    .filter(routeCanMatchAdminPath)
    .sort();
}

const adminRoutePaths = discoverAdminRoutePaths();
const productionRootPaths = [
  ...new Set([
    ...parsedTsConfig.fileNames.map((path) => relative(process.cwd(), path)),
    ...globSync(`**/*.${sourceExtensions}`),
  ]),
]
  .filter(isProductionRootPath)
  .sort();
const productionProgram = ts.createProgram(
  productionRootPaths.map((path) => resolve(path)),
  { ...parsedTsConfig.options, allowJs: true },
);
const productionChecker = productionProgram.getTypeChecker();
const productionPaths = governedProgramPaths(productionProgram);

function sourceFile(path: string, sourceText = readFileSync(path, "utf8")) {
  const extension = path.slice(path.lastIndexOf("."));
  const scriptKind =
    extension === ".tsx"
      ? ts.ScriptKind.TSX
      : extension === ".jsx"
        ? ts.ScriptKind.JSX
        : extension === ".js" || extension === ".mjs" || extension === ".cjs"
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  return ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

function resolvesToModule(moduleName: string, containingPath: string, targetPath: string) {
  const resolved = ts.resolveModuleName(
    moduleName,
    resolve(containingPath),
    parsedTsConfig.options,
    ts.sys,
  ).resolvedModule;
  return Boolean(resolved && resolve(resolved.resolvedFileName) === targetPath);
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
}

function propertyNameText(name: ts.PropertyName | undefined) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text;
  return null;
}

function isExported(node: { modifiers?: ts.NodeArray<ts.ModifierLike> }) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function isDefaultExported(node: { modifiers?: ts.NodeArray<ts.ModifierLike> }) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
}

function forbiddenRouteExportForms(source: ts.SourceFile) {
  const errors: string[] = [];
  if (source.statements.some(ts.isExportDeclaration)) errors.push("route modules cannot use re-export declarations");
  if (
    source.statements.some(
      (statement) =>
        ts.isExportAssignment(statement) ||
        isDefaultExported(statement as ts.Statement & { modifiers?: ts.NodeArray<ts.ModifierLike> }),
    )
  ) {
    errors.push("route modules cannot use default exports or export assignments");
  }
  let commonJs = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && (node.text === "exports" || node.text === "module")) commonJs = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (commonJs) errors.push("route modules cannot use CommonJS export mechanisms");
  return errors;
}

type DeclaredRuntimeExport = { kind: RuntimeExportKind; name: string };

function declaredRuntimeExports(source: ts.SourceFile): DeclaredRuntimeExport[] {
  const exports: DeclaredRuntimeExport[] = [];
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      exports.push({ kind: "reexport", name: "default" });
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
        exports.push({ kind: "reexport", name: "*" });
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) exports.push({ kind: "reexport", name: element.name.text });
      }
      continue;
    }
    if (!isExported(statement as ts.Statement & { modifiers?: ts.NodeArray<ts.ModifierLike> })) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) exports.push({ kind: "variable", name });
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement)) {
      exports.push({
        kind: "function",
        name: isDefaultExported(statement) ? "default" : (statement.name?.text ?? "default"),
      });
      continue;
    }
    if (ts.isClassDeclaration(statement)) {
      exports.push({
        kind: "class",
        name: isDefaultExported(statement) ? "default" : (statement.name?.text ?? "default"),
      });
      continue;
    }
    if (ts.isEnumDeclaration(statement)) exports.push({ kind: "variable", name: statement.name.text });
  }
  return exports;
}

function unexpectedRouteRuntimeExports(source: ts.SourceFile, expectedMethods: Iterable<string>) {
  const allowed = new Set([...expectedMethods, ...routeConfigExports]);
  return declaredRuntimeExports(source)
    .filter((entry) => !allowed.has(entry.name))
    .map((entry) => `route module cannot export runtime value ${entry.name}`);
}

const protectedAuthEscapeNames = new Set([...protectedRuntimeSymbols, "verifiedAdminLoginClaims"]);
const allowedAdminAuthExportNames = new Set(allowedAdminAuthRuntimeExports.keys());

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function constantStringExpression(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression> = new Map(),
  visited = new Set<string>(),
): string | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) return unwrapped.text;
  if (ts.isNumericLiteral(unwrapped)) return unwrapped.text;
  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantStringExpression(unwrapped.left, bindings, visited);
    const right = constantStringExpression(unwrapped.right, bindings, visited);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isIdentifier(unwrapped)) {
    if (visited.has(unwrapped.text)) return null;
    const initializer = bindings.get(unwrapped.text);
    if (!initializer) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(unwrapped.text);
    return constantStringExpression(initializer, bindings, nextVisited);
  }
  return null;
}

function constantStringBindings(source: ts.SourceFile) {
  const bindings = new Map<string, ts.Expression>();
  const ambiguous = new Set<string>();
  const recordBinding = (name: string, initializer: ts.Expression | null) => {
    if (ambiguous.has(name)) return;
    if (!initializer || bindings.has(name)) {
      bindings.delete(name);
      ambiguous.add(name);
      return;
    }
    bindings.set(name, initializer);
  };
  const recordBindingName = (name: ts.BindingName, initializer: ts.Expression | null) => {
    const names = bindingNames(name);
    for (const binding of names) recordBinding(binding, names.length === 1 ? initializer : null);
  };
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) {
      const isConst = ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
      recordBindingName(node.name, isConst && node.initializer ? node.initializer : null);
    } else if (ts.isParameter(node)) {
      recordBindingName(node.name, null);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      recordBindingName(node.variableDeclaration.name, null);
    } else if (ts.isImportClause(node) && node.name) {
      recordBinding(node.name.text, null);
    } else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      recordBinding(node.name.text, null);
    } else if (ts.isImportEqualsDeclaration(node)) {
      recordBinding(node.name.text, null);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      recordBinding(node.name.text, null);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

function expressionRootName(expression: ts.Expression): string | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return unwrapped.text;
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return expressionRootName(unwrapped.expression);
  }
  return null;
}

function containsIdentifierFrom(node: ts.Node, names: ReadonlySet<string>) {
  let found = false;
  const visit = (child: ts.Node) => {
    if (ts.isIdentifier(child) && names.has(child.text)) found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

type ReturnBearingFunctionLike =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

type SemanticReturnSummaries = {
  fromCall(call: ts.CallExpression): readonly ts.Expression[];
  fromValue(expression: ts.Expression): readonly ts.Expression[];
};

function isReturnBearingFunctionLike(node: ts.Node): node is ReturnBearingFunctionLike {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function functionLikeReturnExpressions(node: ReturnBearingFunctionLike) {
  if (ts.isArrowFunction(node) && ts.isExpression(node.body)) return [node.body];
  return node.body ? returnedExpressions(node.body) : [];
}

function semanticFunctionReturns(
  source: ts.SourceFile,
  bindings: ReadonlyMap<string, ts.Expression>,
): SemanticReturnSummaries {
  const options: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  };
  const rootName = source.fileName;
  const defaultHost = ts.createCompilerHost(options, true);
  const isRoot = (fileName: string) => resolve(fileName) === resolve(rootName);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) => isRoot(fileName) || defaultHost.fileExists(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      isRoot(fileName)
        ? source
        : defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile),
    readFile: (fileName) => (isRoot(fileName) ? source.text : defaultHost.readFile(fileName)),
  };
  const checker = ts.createProgram({ host, options, rootNames: [rootName] }).getTypeChecker();
  const assignedValues = new Map<ts.Symbol, ts.Expression[]>();
  const unalias = (symbol: ts.Symbol) =>
    (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  const symbolAt = (expression: ts.Expression): ts.Symbol | null => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = checker.getSymbolAtLocation(unwrapped);
      return symbol ? unalias(symbol) : null;
    }
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const symbol = checker.getSymbolAtLocation(unwrapped.name);
      return symbol ? unalias(symbol) : null;
    }
    if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression) {
      const member = constantStringExpression(unwrapped.argumentExpression, bindings);
      const symbol = member ? checker.getTypeAtLocation(unwrapped.expression).getProperty(member) : undefined;
      return symbol ? unalias(symbol) : null;
    }
    return null;
  };
  const recordAssignedValue = (expression: ts.Expression, value: ts.Expression) => {
    const symbol = symbolAt(expression);
    if (symbol) assignedValues.set(symbol, [...(assignedValues.get(symbol) ?? []), value]);
  };
  const visitAssignments = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      recordAssignedValue(node.name, node.initializer);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      recordAssignedValue(node.left, node.right);
    }
    ts.forEachChild(node, visitAssignments);
  };
  visitAssignments(source);

  const functionLikesForSymbol = (
    symbol: ts.Symbol,
    visitedSymbols: ReadonlySet<ts.Symbol>,
  ): ReturnBearingFunctionLike[] => {
    const resolved = unalias(symbol);
    if (visitedSymbols.has(resolved)) return [];
    const nextVisited = new Set(visitedSymbols).add(resolved);
    const candidates: ts.Node[] = [...(resolved.declarations ?? []), ...(assignedValues.get(resolved) ?? [])];
    return candidates.flatMap((candidate) => {
      if (isReturnBearingFunctionLike(candidate)) return [candidate];
      if (ts.isVariableDeclaration(candidate) && candidate.initializer) {
        return functionLikesForValue(candidate.initializer, nextVisited);
      }
      if (ts.isPropertyAssignment(candidate)) return functionLikesForValue(candidate.initializer, nextVisited);
      if (ts.isShorthandPropertyAssignment(candidate)) {
        const value = checker.getShorthandAssignmentValueSymbol(candidate);
        return value ? functionLikesForSymbol(value, nextVisited) : [];
      }
      if (ts.isExpression(candidate)) return functionLikesForValue(candidate, nextVisited);
      return [];
    });
  };
  const functionLikesForValue = (
    expression: ts.Expression,
    visitedSymbols = new Set<ts.Symbol>(),
  ): ReturnBearingFunctionLike[] => {
    const unwrapped = unwrapExpression(expression);
    if (isReturnBearingFunctionLike(unwrapped)) return [unwrapped];
    const symbol = symbolAt(unwrapped);
    return symbol ? functionLikesForSymbol(symbol, visitedSymbols) : [];
  };
  const unique = <Value>(values: readonly Value[]) => [...new Set(values)];
  const fromCall = (call: ts.CallExpression, visited = new Set<ts.CallExpression>()): readonly ts.Expression[] => {
    if (visited.has(call)) return [];
    const nextVisited = new Set(visited).add(call);
    const callee = unwrapExpression(call.expression);
    const functionLikes = functionLikesForValue(callee);
    if (ts.isCallExpression(callee)) {
      for (const returned of fromCall(callee, nextVisited)) {
        functionLikes.push(...functionLikesForValue(returned));
      }
    }
    return unique(functionLikes.flatMap((declaration) => functionLikeReturnExpressions(declaration)));
  };
  const fromValue = (expression: ts.Expression): readonly ts.Expression[] => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isCallExpression(unwrapped)) return fromCall(unwrapped);
    const symbol = symbolAt(unwrapped);
    if (!symbol) return [];
    return unique(
      functionLikesForSymbol(symbol, new Set())
        .filter(ts.isGetAccessorDeclaration)
        .flatMap((declaration) => functionLikeReturnExpressions(declaration)),
    );
  };
  return { fromCall, fromValue };
}

function containsIdentifierFromSemantic(
  expression: ts.Expression,
  names: ReadonlySet<string>,
  returns: SemanticReturnSummaries,
  visited = new Set<ts.Expression>(),
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (visited.has(unwrapped)) return false;
  if (containsIdentifierFrom(unwrapped, names)) return true;
  const nextVisited = new Set(visited).add(unwrapped);
  return returns
    .fromValue(unwrapped)
    .some((returned) => containsIdentifierFromSemantic(returned, names, returns, nextVisited));
}

const authMutationPrimitiveNames = new Set([
  "Object.assign",
  "Object.defineProperties",
  "Object.defineProperty",
  "Object.freeze",
  "Object.preventExtensions",
  "Object.seal",
  "Object.setPrototypeOf",
  "Reflect.apply",
  "Reflect.defineProperty",
  "Reflect.deleteProperty",
  "Reflect.preventExtensions",
  "Reflect.set",
  "Reflect.setPrototypeOf",
]);
type AuthMutationPrimitive = `${"Object" | "Reflect"}.${string}`;
type AuthBuiltinReceiver = "Object" | "Reflect";

function authBuiltinReceiver(
  expression: ts.Expression,
  receiverAliases: ReadonlyMap<string, AuthBuiltinReceiver>,
  globalAliases: ReadonlySet<string>,
  bindings: ReadonlyMap<string, ts.Expression>,
): AuthBuiltinReceiver | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return receiverAliases.get(unwrapped.text) ?? null;
  if (ts.isCallExpression(unwrapped)) {
    const callee = unwrapExpression(unwrapped.expression);
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const member = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : callee.argumentExpression
          ? constantStringExpression(callee.argumentExpression, bindings)
          : null;
      const target = unwrapped.arguments[0] ? unwrapExpression(unwrapped.arguments[0]) : null;
      const reflectedMember = unwrapped.arguments[1]
        ? constantStringExpression(unwrapped.arguments[1], bindings)
        : null;
      if (
        member === "get" &&
        authBuiltinReceiver(callee.expression, receiverAliases, globalAliases, bindings) === "Reflect" &&
        target &&
        ts.isIdentifier(target) &&
        globalAliases.has(target.text) &&
        (reflectedMember === "Object" || reflectedMember === "Reflect")
      ) {
        return reflectedMember;
      }
      if (member === "get" && target) {
        const targetRoot = expressionRootName(target);
        const containedReceiver = targetRoot ? receiverAliases.get(targetRoot) : null;
        if (containedReceiver) return containedReceiver;
      }
    }
    return null;
  }
  if (!ts.isPropertyAccessExpression(unwrapped) && !ts.isElementAccessExpression(unwrapped)) return null;
  const receiver = unwrapExpression(unwrapped.expression);
  const member = ts.isPropertyAccessExpression(unwrapped)
    ? unwrapped.name.text
    : unwrapped.argumentExpression
      ? constantStringExpression(unwrapped.argumentExpression, bindings)
      : null;
  if (ts.isIdentifier(receiver) && globalAliases.has(receiver.text) && (member === "Object" || member === "Reflect")) {
    return member;
  }
  const receiverRoot = expressionRootName(receiver);
  return receiverRoot ? (receiverAliases.get(receiverRoot) ?? null) : null;
}

function directAuthMutationPrimitive(
  expression: ts.Expression,
  receiverAliases: ReadonlyMap<string, AuthBuiltinReceiver>,
  globalAliases: ReadonlySet<string>,
  bindings: ReadonlyMap<string, ts.Expression>,
): AuthMutationPrimitive | null {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(unwrapped) && !ts.isElementAccessExpression(unwrapped)) return null;
  const builtin = authBuiltinReceiver(unwrapped.expression, receiverAliases, globalAliases, bindings);
  if (!builtin) return null;
  const member = ts.isPropertyAccessExpression(unwrapped)
    ? unwrapped.name.text
    : unwrapped.argumentExpression
      ? constantStringExpression(unwrapped.argumentExpression, bindings)
      : null;
  if (member === null) return `${builtin}.<unresolved>`;
  const primitive = `${builtin}.${member}` as AuthMutationPrimitive;
  return authMutationPrimitiveNames.has(primitive) ? primitive : null;
}

function mutationPrimitiveAliases(
  source: ts.SourceFile,
  bindings: ReadonlyMap<string, ts.Expression>,
  semanticReturns: SemanticReturnSummaries,
) {
  const receiverAliases = new Map<string, AuthBuiltinReceiver>([
    ["Object", "Object"],
    ["Reflect", "Reflect"],
  ]);
  const globalAliases = new Set(["globalThis"]);
  const aliases = new Map<string, AuthMutationPrimitive>();
  const isGlobalAlias = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    return ts.isIdentifier(unwrapped) && globalAliases.has(unwrapped.text);
  };
  const receiverFor = (expression: ts.Expression): AuthBuiltinReceiver | null =>
    authBuiltinReceiver(expression, receiverAliases, globalAliases, bindings);
  const primitiveFor = (expression: ts.Expression): AuthMutationPrimitive | null => {
    const direct = directAuthMutationPrimitive(expression, receiverAliases, globalAliases, bindings);
    if (direct) return direct;
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) return aliases.get(unwrapped.text) ?? null;
    if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
      const root = expressionRootName(unwrapped);
      const rootPrimitive = root ? aliases.get(root) : null;
      if (rootPrimitive) return rootPrimitive;
      const member = ts.isPropertyAccessExpression(unwrapped)
        ? unwrapped.name.text
        : unwrapped.argumentExpression
          ? constantStringExpression(unwrapped.argumentExpression, bindings)
          : null;
      const returnedReceiver = mergeMutationIdentities(
        semanticReturns.fromValue(unwrapped.expression).map((returned) => mutationBindingIdentity(returned)),
      ).receiver;
      if (returnedReceiver && member) {
        const returnedPrimitive = `${returnedReceiver}.${member}` as AuthMutationPrimitive;
        if (authMutationPrimitiveNames.has(returnedPrimitive)) return returnedPrimitive;
      }
      if (member === "bind" || member === "call" || member === "apply") {
        return primitiveFor(unwrapped.expression);
      }
    }
    if (ts.isCallExpression(unwrapped)) {
      const callee = unwrapExpression(unwrapped.expression);
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const member = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : callee.argumentExpression
            ? constantStringExpression(callee.argumentExpression, bindings)
            : null;
        if (member === "bind" || member === "call" || member === "apply") {
          return primitiveFor(callee.expression);
        }
      }
    }
    return null;
  };
  const primitivesInNode = (node: ts.Node) => {
    const primitives = new Set<AuthMutationPrimitive>();
    const visit = (child: ts.Node) => {
      if (ts.isExpression(child)) {
        const primitive = primitiveFor(child);
        if (primitive) primitives.add(primitive);
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return primitives;
  };
  type MutationBindingIdentity = {
    global?: true;
    primitive?: AuthMutationPrimitive;
    receiver?: AuthBuiltinReceiver;
  };
  const mergeMutationIdentities = (identities: readonly MutationBindingIdentity[]): MutationBindingIdentity => {
    const globals = identities.some((identity) => identity.global);
    const receivers = new Set(identities.flatMap((identity) => (identity.receiver ? [identity.receiver] : [])));
    const primitives = new Set(identities.flatMap((identity) => (identity.primitive ? [identity.primitive] : [])));
    return {
      ...(globals ? { global: true as const } : {}),
      ...(receivers.size === 1 ? { receiver: receivers.values().next().value as AuthBuiltinReceiver } : {}),
      ...(primitives.size === 1
        ? { primitive: primitives.values().next().value as AuthMutationPrimitive }
        : primitives.size > 1
          ? { primitive: "Object.<unresolved>" as AuthMutationPrimitive }
          : {}),
    };
  };
  const mutationBindingIdentity = (
    expression: ts.Expression,
    visited = new Set<ts.Expression>(),
  ): MutationBindingIdentity => {
    const unwrapped = unwrapExpression(expression);
    if (visited.has(unwrapped)) return {};
    const nextVisited = new Set(visited).add(unwrapped);
    const direct: MutationBindingIdentity = {
      ...(isGlobalAlias(unwrapped) ? { global: true as const } : {}),
      ...(receiverFor(unwrapped) ? { receiver: receiverFor(unwrapped) ?? undefined } : {}),
      ...(primitiveFor(unwrapped) ? { primitive: primitiveFor(unwrapped) ?? undefined } : {}),
    };
    if (direct.global || direct.receiver || direct.primitive) return direct;
    if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
      const root = expressionRootName(unwrapped.expression);
      const member = ts.isPropertyAccessExpression(unwrapped)
        ? unwrapped.name.text
        : unwrapped.argumentExpression
          ? constantStringExpression(unwrapped.argumentExpression, bindings)
          : null;
      if (root && globalAliases.has(root) && (member === null || /^(?:\d+|at)$/u.test(member))) {
        return { global: true };
      }
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      return mergeMutationIdentities(
        unwrapped.elements.flatMap((element) =>
          ts.isExpression(element) ? [mutationBindingIdentity(element, nextVisited)] : [],
        ),
      );
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
      return mergeMutationIdentities(
        unwrapped.properties.flatMap((property) => {
          if (ts.isPropertyAssignment(property)) {
            return [mutationBindingIdentity(property.initializer, nextVisited)];
          }
          if (ts.isShorthandPropertyAssignment(property)) {
            return [mutationBindingIdentity(property.name, nextVisited)];
          }
          if (ts.isSpreadAssignment(property)) {
            return [mutationBindingIdentity(property.expression, nextVisited)];
          }
          return [];
        }),
      );
    }
    if (ts.isBinaryExpression(unwrapped)) {
      const operator = unwrapped.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.CommaToken ||
        (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment)
      ) {
        return mergeMutationIdentities([
          mutationBindingIdentity(unwrapped.left, nextVisited),
          mutationBindingIdentity(unwrapped.right, nextVisited),
        ]);
      }
    }
    if (ts.isCallExpression(unwrapped)) {
      const semanticReturnedValues = semanticReturns.fromCall(unwrapped);
      if (semanticReturnedValues.length > 0) {
        const returnedIdentity = mergeMutationIdentities(
          semanticReturnedValues.map((returned) => mutationBindingIdentity(returned, nextVisited)),
        );
        return returnedIdentity;
      }
      const callee = unwrapExpression(unwrapped.expression);
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const member = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : callee.argumentExpression
            ? constantStringExpression(callee.argumentExpression, bindings)
            : null;
        if (member === "concat") {
          return mergeMutationIdentities([
            mutationBindingIdentity(callee.expression, nextVisited),
            ...unwrapped.arguments.map((argument) => mutationBindingIdentity(argument, nextVisited)),
          ]);
        }
      }
      const bridgedIdentity = mutationBindingIdentity(unwrapped.expression, nextVisited);
      if (bridgedIdentity.global || bridgedIdentity.receiver) {
        return {
          ...(bridgedIdentity.global ? { global: true as const } : {}),
          ...(bridgedIdentity.receiver ? { receiver: bridgedIdentity.receiver } : {}),
        };
      }
    }
    return {};
  };
  const mutationMemberIdentity = (
    identity: MutationBindingIdentity,
    member: string | null,
  ): MutationBindingIdentity => {
    if (!member) return identity;
    if (identity.global && (member === "Object" || member === "Reflect")) return { receiver: member };
    if (identity.receiver) {
      const primitive = `${identity.receiver}.${member}` as AuthMutationPrimitive;
      if (authMutationPrimitiveNames.has(primitive)) return { primitive };
    }
    if (identity.primitive && (member === "bind" || member === "call" || member === "apply")) {
      return { primitive: identity.primitive };
    }
    return {};
  };
  const recordMutationBinding = (name: ts.BindingName, identity: MutationBindingIdentity) => {
    if (ts.isIdentifier(name)) {
      if (identity.global && !globalAliases.has(name.text)) {
        globalAliases.add(name.text);
        changed = true;
      }
      if (identity.receiver && receiverAliases.get(name.text) !== identity.receiver) {
        receiverAliases.set(name.text, identity.receiver);
        changed = true;
      }
      if (identity.primitive && aliases.get(name.text) !== identity.primitive) {
        aliases.set(name.text, identity.primitive);
        changed = true;
      }
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const member = ts.isObjectBindingPattern(name)
        ? propertyNameText(element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined))
        : null;
      recordMutationBinding(element.name, mutationMemberIdentity(identity, member));
    }
  };
  const recordMutationAssignmentTarget = (target: ts.Expression, identity: MutationBindingIdentity) => {
    const unwrapped = unwrapExpression(target);
    if (ts.isIdentifier(unwrapped)) {
      recordMutationBinding(unwrapped, identity);
      return;
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
      for (const property of unwrapped.properties) {
        if (ts.isPropertyAssignment(property)) {
          recordMutationAssignmentTarget(
            property.initializer,
            mutationMemberIdentity(identity, propertyNameText(property.name)),
          );
        } else if (ts.isShorthandPropertyAssignment(property)) {
          recordMutationAssignmentTarget(
            property.name,
            mutationMemberIdentity(identity, propertyNameText(property.name)),
          );
        }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) {
        if (ts.isExpression(element)) recordMutationAssignmentTarget(element, identity);
      }
    }
    const root = expressionRootName(unwrapped);
    if (root) recordMutationBinding(ts.factory.createIdentifier(root), identity);
  };
  const accessMember = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
    if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression) {
      return constantStringExpression(unwrapped.argumentExpression, bindings);
    }
    return null;
  };
  const firstArrayElement = (expression: ts.Expression | undefined): ts.Expression | null => {
    if (!expression) return null;
    const unwrapped = unwrapExpression(expression);
    if (!ts.isArrayLiteralExpression(unwrapped)) return null;
    const first = unwrapped.elements[0];
    return first && ts.isExpression(first) ? first : null;
  };
  const mutationTargets = (call: ts.CallExpression) => {
    const targets: Array<{ primitive: AuthMutationPrimitive; target: ts.Expression }> = [];
    const callee = unwrapExpression(call.expression);
    const direct = primitiveFor(call.expression);
    const member = accessMember(call.expression);
    if (direct === "Reflect.apply") {
      const invoked = call.arguments[0] ? primitiveFor(call.arguments[0]) : null;
      const target = firstArrayElement(call.arguments[2]);
      if (invoked && invoked !== "Reflect.apply" && target) targets.push({ primitive: invoked, target });
    } else if (direct) {
      let target: ts.Expression | null = null;
      if (member === "call") {
        target = call.arguments[1] ?? null;
      } else if (member === "apply") {
        target = firstArrayElement(call.arguments[1]);
      } else if (ts.isCallExpression(callee) && accessMember(callee.expression) === "bind") {
        target = callee.arguments[1] ?? call.arguments[0] ?? null;
      } else {
        target = call.arguments[0] ?? null;
      }
      if (target) targets.push({ primitive: direct, target });
    } else if ((member === "call" || member === "apply") && call.arguments[0] && primitiveFor(call.arguments[0])) {
      const primitive = primitiveFor(call.arguments[0]);
      const wrappedMember =
        ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
          ? accessMember(callee.expression)
          : null;
      const target = wrappedMember === "apply" ? firstArrayElement(call.arguments[2]) : (call.arguments[2] ?? null);
      if (primitive && target) targets.push({ primitive, target });
    }
    if (targets.length === 0) {
      for (const primitive of primitivesInNode(call)) {
        for (const argument of call.arguments) targets.push({ primitive, target: argument });
      }
    }
    return targets;
  };
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        recordMutationBinding(node.name, mutationBindingIdentity(node.initializer));
        if (ts.isIdentifier(node.name)) {
          if (isGlobalAlias(node.initializer) && !globalAliases.has(node.name.text)) {
            globalAliases.add(node.name.text);
            changed = true;
          }
          const receiver = receiverFor(node.initializer);
          if (receiver && receiverAliases.get(node.name.text) !== receiver) {
            receiverAliases.set(node.name.text, receiver);
            changed = true;
          }
          const primitive =
            primitiveFor(node.initializer) ?? primitivesInNode(node.initializer).values().next().value ?? null;
          if (primitive && aliases.get(node.name.text) !== primitive) {
            aliases.set(node.name.text, primitive);
            changed = true;
          }
        } else {
          const receiver = receiverFor(node.initializer);
          const nestedPrimitive =
            primitiveFor(node.initializer) ?? primitivesInNode(node.initializer).values().next().value ?? null;
          if (ts.isObjectBindingPattern(node.name) && isGlobalAlias(node.initializer)) {
            for (const element of node.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const member = propertyNameText(element.propertyName ?? element.name);
              if ((member === "Object" || member === "Reflect") && receiverAliases.get(element.name.text) !== member) {
                receiverAliases.set(element.name.text, member);
                changed = true;
              }
            }
          } else if (ts.isObjectBindingPattern(node.name) && receiver) {
            for (const element of node.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const member = propertyNameText(element.propertyName ?? element.name);
              const primitive = member ? (`${receiver}.${member}` as AuthMutationPrimitive) : null;
              if (
                primitive &&
                authMutationPrimitiveNames.has(primitive) &&
                aliases.get(element.name.text) !== primitive
              ) {
                aliases.set(element.name.text, primitive);
                changed = true;
              }
            }
          } else if (nestedPrimitive) {
            for (const name of bindingNames(node.name)) {
              if (aliases.get(name) !== nestedPrimitive) {
                aliases.set(name, nestedPrimitive);
                changed = true;
              }
            }
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        recordMutationAssignmentTarget(node.left, mutationBindingIdentity(node.right));
      }
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const returnedIdentity = mergeMutationIdentities(
          returnedExpressions(node.body).map((expression) => mutationBindingIdentity(expression)),
        );
        recordMutationBinding(node.name, returnedIdentity);
      }
      if (ts.isCallExpression(node)) {
        const mutation = receiverMutationCall(node, bindings);
        if (mutation) {
          const targetRoot = expressionRootName(mutation.target);
          if (targetRoot) {
            recordMutationBinding(
              ts.factory.createIdentifier(targetRoot),
              mergeMutationIdentities(mutation.values.map((value) => mutationBindingIdentity(value))),
            );
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        if (isGlobalAlias(node.right) && !globalAliases.has(node.left.text)) {
          globalAliases.add(node.left.text);
          changed = true;
        }
        const receiver = receiverFor(node.right);
        if (receiver && receiverAliases.get(node.left.text) !== receiver) {
          receiverAliases.set(node.left.text, receiver);
          changed = true;
        }
        const primitive = primitiveFor(node.right) ?? primitivesInNode(node.right).values().next().value ?? null;
        if (primitive && aliases.get(node.left.text) !== primitive) {
          aliases.set(node.left.text, primitive);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { aliases, mutationTargets, primitiveFor, primitivesInNode, receiverAliases };
}

type PrivateAuthTaint = "authority" | "claims" | "container" | "factory";
const safeVerifiedClaimProperties = new Set(["actor", "credential", "principal", "role"]);

function protectedAuthTaint(
  expression: ts.Expression,
  privateAliases: ReadonlyMap<string, PrivateAuthTaint>,
  taintedFactories: ReadonlySet<string>,
  semanticReturns?: SemanticReturnSummaries,
  visited = new Set<ts.Expression>(),
): PrivateAuthTaint | null {
  const unwrapped = unwrapExpression(expression);
  if (visited.has(unwrapped)) return null;
  const nextVisited = new Set(visited).add(unwrapped);
  const returnedTaint = semanticReturns
    ?.fromValue(unwrapped)
    .map((returned) => protectedAuthTaint(returned, privateAliases, taintedFactories, semanticReturns, nextVisited))
    .find((taint): taint is PrivateAuthTaint => Boolean(taint));
  if (returnedTaint) return returnedTaint;
  if (ts.isIdentifier(unwrapped)) return privateAliases.get(unwrapped.text) ?? null;
  if (ts.isBinaryExpression(unwrapped)) {
    const operator = unwrapped.operatorToken.kind;
    const returnsOperand =
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.CommaToken ||
      (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment);
    if (!returnsOperand) return null;
    return (
      protectedAuthTaint(unwrapped.left, privateAliases, taintedFactories, semanticReturns, nextVisited) ??
      protectedAuthTaint(unwrapped.right, privateAliases, taintedFactories, semanticReturns, nextVisited)
    );
  }
  if (ts.isTemplateExpression(unwrapped)) return null;
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    const root = expressionRootName(unwrapped);
    const rootTaint = root ? privateAliases.get(root) : null;
    if (!rootTaint) return null;
    const member = ts.isPropertyAccessExpression(unwrapped)
      ? unwrapped.name.text
      : unwrapped.argumentExpression
        ? constantStringExpression(unwrapped.argumentExpression)
        : null;
    if (rootTaint === "claims" && member && safeVerifiedClaimProperties.has(member)) return null;
    return rootTaint === "factory" ? "factory" : "authority";
  }
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    const expressions = ts.isExpression(unwrapped.body) ? [unwrapped.body] : returnedExpressions(unwrapped.body);
    return expressions.some((candidate) =>
      protectedAuthTaint(candidate, privateAliases, taintedFactories, semanticReturns, nextVisited),
    )
      ? "factory"
      : null;
  }
  if (ts.isCallExpression(unwrapped)) {
    const root = expressionRootName(unwrapped.expression);
    if (root === "verifiedAdminLoginClaims") return "claims";
    if (root && taintedFactories.has(root)) return "authority";
    const callee = unwrapExpression(unwrapped.expression);
    if (
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      root &&
      privateAliases.has(root)
    ) {
      const member = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : callee.argumentExpression
          ? constantStringExpression(callee.argumentExpression)
          : null;
      if (member === "bind") return "authority";
    }
    if (ts.isIdentifier(callee) && callee.text === "Object") {
      return (
        unwrapped.arguments
          .map((argument) =>
            protectedAuthTaint(argument, privateAliases, taintedFactories, semanticReturns, nextVisited),
          )
          .find((taint): taint is PrivateAuthTaint => Boolean(taint)) ?? null
      );
    }
    return (
      unwrapped.arguments
        .map((argument) => protectedAuthTaint(argument, privateAliases, taintedFactories, semanticReturns, nextVisited))
        .find((taint): taint is PrivateAuthTaint => Boolean(taint)) ?? null
    );
  }
  if (ts.isNewExpression(unwrapped) && ts.isIdentifier(unwrapped.expression) && unwrapped.expression.text === "Proxy") {
    const target = unwrapped.arguments?.[0];
    return target ? protectedAuthTaint(target, privateAliases, taintedFactories, semanticReturns, nextVisited) : null;
  }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.some(
      (element) =>
        ts.isExpression(element) &&
        protectedAuthTaint(element, privateAliases, taintedFactories, semanticReturns, nextVisited),
    )
      ? "container"
      : null;
  }
  if (ts.isObjectLiteralExpression(unwrapped)) {
    for (const property of unwrapped.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        protectedAuthTaint(property.initializer, privateAliases, taintedFactories, semanticReturns, nextVisited)
      ) {
        return "container";
      }
      if (
        ts.isShorthandPropertyAssignment(property) &&
        protectedAuthTaint(property.name, privateAliases, taintedFactories, semanticReturns, nextVisited)
      ) {
        return "container";
      }
      if (
        ts.isSpreadAssignment(property) &&
        protectedAuthTaint(property.expression, privateAliases, taintedFactories, semanticReturns, nextVisited)
      ) {
        return "container";
      }
      if (
        (ts.isMethodDeclaration(property) ||
          ts.isGetAccessorDeclaration(property) ||
          ts.isSetAccessorDeclaration(property)) &&
        property.body &&
        nodeContainsProtectedAuthTaint(property.body, privateAliases, taintedFactories, semanticReturns)
      ) {
        return "container";
      }
    }
    return null;
  }
  let taint: PrivateAuthTaint | null = null;
  const visitChild = (child: ts.Node) => {
    if (taint) return;
    if (ts.isExpression(child)) {
      taint = protectedAuthTaint(child, privateAliases, taintedFactories, semanticReturns, nextVisited);
      return;
    }
    ts.forEachChild(child, visitChild);
  };
  ts.forEachChild(unwrapped, visitChild);
  return taint;
}

function nodeContainsProtectedAuthTaint(
  node: ts.Node,
  privateAliases: ReadonlyMap<string, PrivateAuthTaint>,
  taintedFactories: ReadonlySet<string>,
  semanticReturns?: SemanticReturnSummaries,
) {
  let tainted = false;
  const visit = (child: ts.Node) => {
    if (tainted) return;
    if (ts.isExpression(child) && protectedAuthTaint(child, privateAliases, taintedFactories, semanticReturns)) {
      tainted = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return tainted;
}

function containerReferenceRoots(
  expression: ts.Expression,
  semanticReturns?: SemanticReturnSummaries,
  visited = new Set<ts.Expression>(),
): Set<string> {
  const unwrapped = unwrapExpression(expression);
  if (visited.has(unwrapped)) return new Set();
  const nextVisited = new Set(visited).add(unwrapped);
  const root = expressionRootName(unwrapped);
  if (root) return new Set([root]);
  const roots = new Set<string>();
  const collect = (candidate: ts.Expression) => {
    for (const name of containerReferenceRoots(candidate, semanticReturns, nextVisited)) roots.add(name);
  };
  for (const returned of semanticReturns?.fromValue(unwrapped) ?? []) collect(returned);
  if (ts.isSpreadElement(unwrapped)) {
    collect(unwrapped.expression);
  } else if (ts.isArrayLiteralExpression(unwrapped)) {
    for (const element of unwrapped.elements) if (ts.isExpression(element)) collect(element);
  } else if (ts.isObjectLiteralExpression(unwrapped)) {
    for (const property of unwrapped.properties) {
      if (ts.isPropertyAssignment(property)) collect(property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) roots.add(property.name.text);
      else if (ts.isSpreadAssignment(property)) collect(property.expression);
    }
  } else if (ts.isBinaryExpression(unwrapped)) {
    const operator = unwrapped.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.CommaToken ||
      (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment)
    ) {
      collect(unwrapped.left);
      collect(unwrapped.right);
    }
  } else if (ts.isCallExpression(unwrapped)) {
    const callee = unwrapExpression(unwrapped.expression);
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const member = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : callee.argumentExpression
          ? constantStringExpression(callee.argumentExpression)
          : null;
      if (member === "concat" || member === "bind") {
        collect(callee.expression);
        for (const argument of unwrapped.arguments) collect(argument);
      }
    }
  }
  return roots;
}

const receiverMutationMethodNames = new Set(["add", "copyWithin", "fill", "push", "set", "splice", "unshift"]);

function receiverMutationCall(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, ts.Expression>,
): { target: ts.Expression; values: readonly ts.Expression[] } | null {
  const accessMember = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
    if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression) {
      return constantStringExpression(unwrapped.argumentExpression, bindings);
    }
    return null;
  };
  const mutationMethod = (expression: ts.Expression) => {
    const member = accessMember(expression);
    return member && receiverMutationMethodNames.has(member) ? member : null;
  };
  const callee = unwrapExpression(call.expression);
  if (ts.isCallExpression(callee) && accessMember(callee.expression) === "bind") {
    const boundCallee = unwrapExpression(callee.expression);
    if (
      (ts.isPropertyAccessExpression(boundCallee) || ts.isElementAccessExpression(boundCallee)) &&
      mutationMethod(boundCallee.expression) &&
      callee.arguments[0]
    ) {
      return { target: callee.arguments[0], values: [...callee.arguments.slice(1), ...call.arguments] };
    }
  }
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return null;
  const member = accessMember(callee);
  if (member && receiverMutationMethodNames.has(member)) {
    return { target: callee.expression, values: call.arguments };
  }
  if (member !== "call" && member !== "apply") return null;
  const invoked = unwrapExpression(callee.expression);
  if (ts.isPropertyAccessExpression(invoked) || ts.isElementAccessExpression(invoked)) {
    const invokedMember = accessMember(invoked);
    if (invokedMember && receiverMutationMethodNames.has(invokedMember) && call.arguments[0]) {
      if (member === "call") return { target: call.arguments[0], values: call.arguments.slice(1) };
      const vector = call.arguments[1] ? unwrapExpression(call.arguments[1]) : null;
      return {
        target: call.arguments[0],
        values:
          vector && ts.isArrayLiteralExpression(vector)
            ? vector.elements.filter((element): element is ts.Expression => ts.isExpression(element))
            : call.arguments.slice(1),
      };
    }
  }
  const wrappedMutationIndex = call.arguments.findIndex((argument) => mutationMethod(argument) !== null);
  if (wrappedMutationIndex < 0 || !call.arguments[wrappedMutationIndex + 1]) return null;
  const target = call.arguments[wrappedMutationIndex + 1] as ts.Expression;
  const possibleVector = call.arguments[wrappedMutationIndex + 2]
    ? unwrapExpression(call.arguments[wrappedMutationIndex + 2] as ts.Expression)
    : null;
  return {
    target,
    values:
      member === "apply" && possibleVector && ts.isArrayLiteralExpression(possibleVector)
        ? possibleVector.elements.filter((element): element is ts.Expression => ts.isExpression(element))
        : call.arguments.slice(wrappedMutationIndex + 2),
  };
}

function expressionEscapesProtectedAuthValue(
  expression: ts.Expression,
  privateAliases: ReadonlyMap<string, PrivateAuthTaint>,
  taintedFactories: ReadonlySet<string>,
  semanticReturns?: SemanticReturnSummaries,
) {
  return protectedAuthTaint(expression, privateAliases, taintedFactories, semanticReturns) !== null;
}

function returnedExpressions(node: ts.Node) {
  const expressions: ts.Expression[] = [];
  const visit = (child: ts.Node) => {
    if (
      child !== node &&
      (ts.isFunctionDeclaration(child) || ts.isFunctionExpression(child) || ts.isArrowFunction(child))
    ) {
      return;
    }
    if (ts.isReturnStatement(child) && child.expression) expressions.push(child.expression);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return expressions;
}

function authRuntimeExportViolations(sourceText = readFileSync("lib/server/admin-auth.ts", "utf8")) {
  const source = sourceFile("lib/server/admin-auth.ts", sourceText);
  const entries = declaredRuntimeExports(source);
  const violations: string[] = [];
  for (const [name, kind] of allowedAdminAuthRuntimeExports) {
    const matches = entries.filter((entry) => entry.name === name && entry.kind === kind);
    if (matches.length !== 1) violations.push(`${name} must be one direct exported ${kind}`);
  }
  for (const entry of entries) {
    if (allowedAdminAuthRuntimeExports.get(entry.name) !== entry.kind) {
      violations.push(`unexpected auth runtime export ${entry.name}:${entry.kind}`);
    }
  }

  const constantBindings = constantStringBindings(source);
  const semanticReturns = semanticFunctionReturns(source, constantBindings);
  const mutationAnalysis = mutationPrimitiveAliases(source, constantBindings, semanticReturns);
  const privateAliases = new Map<string, PrivateAuthTaint>(
    [...protectedAuthEscapeNames].map((name) => [name, "authority"] as const),
  );
  const taintedFactories = new Set<string>();
  const taintAliasGraph = new Map<string, Set<string>>();
  const linkTaintAliases = (left: string, right: string) => {
    if (left === right) return;
    const leftLinks = taintAliasGraph.get(left) ?? new Set<string>();
    const rightLinks = taintAliasGraph.get(right) ?? new Set<string>();
    leftLinks.add(right);
    rightLinks.add(left);
    taintAliasGraph.set(left, leftLinks);
    taintAliasGraph.set(right, rightLinks);
  };
  const lexicalScope = (node: ts.Node): ts.Node => {
    let current: ts.Node | undefined = node.parent;
    while (current && current !== source) {
      if (ts.isFunctionLike(current)) return current;
      current = current.parent;
    }
    return source;
  };
  type BoundReceiverMutation = { target: ts.Expression; values: readonly ts.Expression[] };
  const boundMutationKey = (node: ts.Node, name: string) => `${lexicalScope(node).pos}:${name}`;
  const boundReceiverMutations = new Map<string, BoundReceiverMutation>();
  const accessMember = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
    if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression) {
      return constantStringExpression(unwrapped.argumentExpression, constantBindings);
    }
    return null;
  };
  const directBoundReceiverMutation = (expression: ts.Expression): BoundReceiverMutation | null => {
    const unwrapped = unwrapExpression(expression);
    if (!ts.isCallExpression(unwrapped) || accessMember(unwrapped.expression) !== "bind" || !unwrapped.arguments[0]) {
      return null;
    }
    const callee = unwrapExpression(unwrapped.expression);
    if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return null;
    const mutationMember = accessMember(callee.expression);
    if (!mutationMember || !receiverMutationMethodNames.has(mutationMember)) return null;
    return { target: unwrapped.arguments[0], values: unwrapped.arguments.slice(1) };
  };
  let boundMutationChanged = true;
  while (boundMutationChanged) {
    boundMutationChanged = false;
    const recordBoundMutation = (node: ts.Node, name: string, mutation: BoundReceiverMutation | null) => {
      if (!mutation) return;
      const key = boundMutationKey(node, name);
      if (boundReceiverMutations.has(key)) return;
      boundReceiverMutations.set(key, mutation);
      boundMutationChanged = true;
    };
    const boundMutationFor = (node: ts.Node, expression: ts.Expression) => {
      const direct = directBoundReceiverMutation(expression);
      if (direct) return direct;
      const unwrapped = unwrapExpression(expression);
      return ts.isIdentifier(unwrapped)
        ? (boundReceiverMutations.get(boundMutationKey(node, unwrapped.text)) ?? null)
        : null;
    };
    const visitBoundMutations = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        recordBoundMutation(node, node.name.text, boundMutationFor(node, node.initializer));
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isIdentifier(unwrapExpression(node.left))
      ) {
        recordBoundMutation(
          node,
          (unwrapExpression(node.left) as ts.Identifier).text,
          boundMutationFor(node, node.right),
        );
      }
      ts.forEachChild(node, visitBoundMutations);
    };
    visitBoundMutations(source);
  }
  const boundReceiverMutationCall = (call: ts.CallExpression): BoundReceiverMutation | null => {
    const callee = unwrapExpression(call.expression);
    if (ts.isIdentifier(callee)) {
      const bound = boundReceiverMutations.get(boundMutationKey(call, callee.text));
      return bound ? { target: bound.target, values: [...bound.values, ...call.arguments] } : null;
    }
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const member = accessMember(callee);
      const receiver = unwrapExpression(callee.expression);
      if ((member === "call" || member === "apply") && ts.isIdentifier(receiver)) {
        const bound = boundReceiverMutations.get(boundMutationKey(call, receiver.text));
        if (bound) {
          if (member === "call") {
            return { target: bound.target, values: [...bound.values, ...call.arguments.slice(1)] };
          }
          const vector = call.arguments[1] ? unwrapExpression(call.arguments[1]) : null;
          return {
            target: bound.target,
            values: [
              ...bound.values,
              ...(vector && ts.isArrayLiteralExpression(vector)
                ? vector.elements.filter((element): element is ts.Expression => ts.isExpression(element))
                : call.arguments.slice(1)),
            ],
          };
        }
      }
    }
    if (mutationAnalysis.primitiveFor(call.expression) === "Reflect.apply") {
      const invoked = call.arguments[0] ? unwrapExpression(call.arguments[0]) : null;
      if (invoked && ts.isIdentifier(invoked)) {
        const bound = boundReceiverMutations.get(boundMutationKey(call, invoked.text));
        if (bound) {
          return {
            target: bound.target,
            values: [...bound.values, ...(call.arguments[2] ? [call.arguments[2]] : [])],
          };
        }
      }
    }
    return null;
  };
  const invocationVectorValues = (
    expression: ts.Expression,
    call: ts.CallExpression,
    visited = new Set<string>(),
  ): ts.Expression[] => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isArrayLiteralExpression(unwrapped)) {
      return unwrapped.elements.flatMap((element) => (ts.isExpression(element) ? [element] : []));
    }
    if (ts.isCallExpression(unwrapped)) {
      const returnedValues = semanticReturns
        .fromCall(unwrapped)
        .flatMap((returned) => invocationVectorValues(returned, call, visited));
      if (returnedValues.length > 0) return returnedValues;
      const callee = unwrapExpression(unwrapped.expression);
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const member = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : callee.argumentExpression
            ? constantStringExpression(callee.argumentExpression, constantBindings)
            : null;
        if (member === "concat") {
          return [...invocationVectorValues(callee.expression, call, visited), ...unwrapped.arguments];
        }
      }
      return [];
    }
    if (!ts.isIdentifier(unwrapped) || visited.has(unwrapped.text)) return [];
    const nextVisited = new Set(visited).add(unwrapped.text);
    const values: ts.Expression[] = [];
    const scope = lexicalScope(call);
    const visit = (node: ts.Node) => {
      if (node !== scope && ts.isFunctionLike(node)) return;
      if (node.pos >= call.pos) return;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === unwrapped.text &&
        node.initializer
      ) {
        values.push(...invocationVectorValues(node.initializer, call, nextVisited));
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        expressionRootName(node.left) === unwrapped.text
      ) {
        values.push(node.right);
      }
      if (ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        if (
          (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
          expressionRootName(callee.expression) === unwrapped.text
        ) {
          const member = ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : callee.argumentExpression
              ? constantStringExpression(callee.argumentExpression, constantBindings)
              : null;
          if (member === "push" || member === "unshift" || member === "splice") values.push(...node.arguments);
        }
        for (const { target } of mutationAnalysis.mutationTargets(node)) {
          if (expressionRootName(target) === unwrapped.text) values.push(...node.arguments);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
    return values;
  };
  const visitTaintAliases = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const roots = containerReferenceRoots(node.initializer, semanticReturns);
      for (const name of bindingNames(node.name)) {
        for (const root of roots) linkTaintAliases(name, root);
      }
    }
    if (ts.isCallExpression(node)) {
      const mutation = receiverMutationCall(node, constantBindings) ?? boundReceiverMutationCall(node);
      if (mutation) {
        const targetRoots = containerReferenceRoots(mutation.target, semanticReturns);
        for (const value of mutation.values) {
          const valueRoots = containerReferenceRoots(value, semanticReturns);
          for (const targetRoot of targetRoots) {
            for (const valueRoot of valueRoots) linkTaintAliases(targetRoot, valueRoot);
          }
        }
      }
      if (mutationAnalysis.primitiveFor(node.expression) === "Reflect.apply" && node.arguments[2]) {
        const vectorRoots = [
          ...containerReferenceRoots(node.arguments[2], semanticReturns),
          ...invocationVectorValues(node.arguments[2], node).flatMap((value) => [
            ...containerReferenceRoots(value, semanticReturns),
          ]),
        ];
        for (let leftIndex = 0; leftIndex < vectorRoots.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < vectorRoots.length; rightIndex += 1) {
            const left = vectorRoots[leftIndex];
            const right = vectorRoots[rightIndex];
            if (left && right) linkTaintAliases(left, right);
          }
        }
      }
    }
    ts.forEachChild(node, visitTaintAliases);
  };
  visitTaintAliases(source);
  let changed = true;
  while (changed) {
    changed = false;
    const taintOf = (expression: ts.Expression) =>
      protectedAuthTaint(expression, privateAliases, taintedFactories, semanticReturns);
    const escapes = (expression: ts.Expression) => taintOf(expression) !== null;
    const recordTaint = (name: string, taint: PrivateAuthTaint) => {
      const pending = [name];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const current = pending.pop();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        if (!privateAliases.has(current)) {
          privateAliases.set(current, taint);
          changed = true;
        }
        for (const linked of taintAliasGraph.get(current) ?? []) pending.push(linked);
      }
    };
    const visitTaint = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        if (!taintedFactories.has(node.name.text) && returnedExpressions(node.body).some(escapes)) {
          taintedFactories.add(node.name.text);
          recordTaint(node.name.text, "factory");
          changed = true;
        }
      }
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const initializer = node.initializer;
        const taint = taintOf(initializer);
        if (taint) {
          const isFactory =
            (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
            (ts.isExpression(initializer.body) ? [initializer.body] : returnedExpressions(initializer.body)).some(
              escapes,
            );
          for (const name of bindingNames(node.name)) {
            recordTaint(name, isFactory ? "factory" : taint);
            if (isFactory && !taintedFactories.has(name)) {
              taintedFactories.add(name);
              changed = true;
            }
          }
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const taint = taintOf(node.right);
        const root = taint ? expressionRootName(node.left) : null;
        if (root && taint) recordTaint(root, taint);
      }
      if (ts.isCallExpression(node)) {
        const argumentTaint = node.arguments
          .map((argument) => taintOf(argument))
          .find((taint): taint is PrivateAuthTaint => Boolean(taint));
        if (argumentTaint) {
          const receiverMutation = receiverMutationCall(node, constantBindings) ?? boundReceiverMutationCall(node);
          const receiverRoots = receiverMutation
            ? containerReferenceRoots(receiverMutation.target, semanticReturns)
            : new Set<string>();
          for (const receiverRoot of receiverRoots) {
            if (
              !privateAliases.has(receiverRoot) &&
              receiverRoot !== "Object" &&
              receiverRoot !== "Reflect" &&
              receiverRoot !== "globalThis"
            ) {
              recordTaint(receiverRoot, "container");
            }
          }
          for (const { target } of mutationAnalysis.mutationTargets(node)) {
            for (const root of containerReferenceRoots(target, semanticReturns)) {
              if (
                !privateAliases.has(root) &&
                root !== "Object" &&
                root !== "Reflect" &&
                root !== "globalThis" &&
                root !== "Function"
              ) {
                recordTaint(root, "container");
              }
            }
          }
        }
      }
      ts.forEachChild(node, visitTaint);
    };
    visitTaint(source);
  }

  const mutableAuthExportAliases = new Set(allowedAdminAuthExportNames);
  changed = true;
  while (changed) {
    changed = false;
    const recordMutableRoot = (expression: ts.Expression) => {
      const root = expressionRootName(expression);
      if (!root || mutableAuthExportAliases.has(root)) return;
      mutableAuthExportAliases.add(root);
      changed = true;
    };
    const visitAlias = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        containsIdentifierFromSemantic(node.initializer, mutableAuthExportAliases, semanticReturns)
      ) {
        for (const name of bindingNames(node.name)) {
          if (!mutableAuthExportAliases.has(name)) {
            mutableAuthExportAliases.add(name);
            changed = true;
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        containsIdentifierFromSemantic(node.right, mutableAuthExportAliases, semanticReturns)
      ) {
        recordMutableRoot(node.left);
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        containsIdentifierFromSemantic(node.right, mutableAuthExportAliases, semanticReturns)
      ) {
        recordMutableRoot(node.left);
      }
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        node.body &&
        returnedExpressions(node.body).some((expression) =>
          containsIdentifierFromSemantic(expression, mutableAuthExportAliases, semanticReturns),
        ) &&
        !mutableAuthExportAliases.has(node.name.text)
      ) {
        mutableAuthExportAliases.add(node.name.text);
        changed = true;
      }
      if (
        ts.isCallExpression(node) &&
        node.arguments.some((argument) =>
          containsIdentifierFromSemantic(argument, mutableAuthExportAliases, semanticReturns),
        )
      ) {
        const receiverMutation = receiverMutationCall(node, constantBindings);
        if (receiverMutation) recordMutableRoot(receiverMutation.target);
        for (const { target } of mutationAnalysis.mutationTargets(node)) recordMutableRoot(target);
      }
      ts.forEachChild(node, visitAlias);
    };
    visitAlias(source);
  }

  for (const statement of source.statements) {
    if (
      ts.isModuleDeclaration(statement) &&
      ts.isIdentifier(statement.name) &&
      allowedAdminAuthExportNames.has(statement.name.text)
    ) {
      violations.push(`allowed auth export ${statement.name.text} cannot be augmented by a namespace`);
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && allowedAdminAuthExportNames.has(statement.name.text)) {
      if (
        returnedExpressions(statement.body ?? statement).some((expression) =>
          expressionEscapesProtectedAuthValue(expression, privateAliases, taintedFactories, semanticReturns),
        )
      ) {
        violations.push(`allowed auth export ${statement.name.text} cannot return private authority or claims state`);
      }
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          allowedAdminAuthExportNames.has(declaration.name.text) &&
          declaration.initializer &&
          expressionEscapesProtectedAuthValue(
            declaration.initializer,
            privateAliases,
            taintedFactories,
            semanticReturns,
          )
        ) {
          violations.push(
            `allowed auth export ${declaration.name.text} cannot expose private authority or claims state`,
          );
        }
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      expressionRootName(node.left) &&
      mutableAuthExportAliases.has(expressionRootName(node.left) ?? "")
    ) {
      if (
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        violations.push(`allowed auth export ${expressionRootName(node.left)} cannot be mutated`);
      }
    }
    if (ts.isCallExpression(node)) {
      for (const { primitive, target } of mutationAnalysis.mutationTargets(node)) {
        if (containsIdentifierFromSemantic(target, mutableAuthExportAliases, semanticReturns)) {
          violations.push(`allowed auth export cannot be augmented through ${primitive}`);
        }
      }
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      expressionRootName(node.operand) &&
      mutableAuthExportAliases.has(expressionRootName(node.operand) ?? "")
    ) {
      violations.push(`allowed auth export ${expressionRootName(node.operand)} cannot be mutated`);
    }
    if (
      ts.isDeleteExpression(node) &&
      expressionRootName(node.expression) &&
      mutableAuthExportAliases.has(expressionRootName(node.expression) ?? "")
    ) {
      violations.push(`allowed auth export ${expressionRootName(node.expression)} cannot be mutated`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function effectiveRuntimeModuleExports(path: string) {
  const source = productionProgram.getSourceFile(resolve(path));
  if (!source) throw new Error(`TypeScript program omitted production module ${path}`);
  const symbol = productionChecker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`TypeScript checker could not resolve production module ${path}`);
  return productionChecker.getExportsOfModule(symbol).flatMap((entry) => {
    const target = (entry.flags & ts.SymbolFlags.Alias) !== 0 ? productionChecker.getAliasedSymbol(entry) : entry;
    return (target.flags & ts.SymbolFlags.Value) !== 0 ? [{ exported: entry.name, local: target.name }] : [];
  });
}

type HttpExport = {
  declaration?: ts.VariableDeclaration;
  declarationList?: ts.VariableDeclarationList;
  kind: "assignment" | "commonjs" | "function" | "reexport" | "variable";
  method: HttpMethod;
};

function asHttpMethod(value: string | null | undefined): HttpMethod | null {
  return value && httpMethods.has(value) ? (value as HttpMethod) : null;
}

function commonJsPropertyMethod(node: ts.Expression): HttpMethod | null {
  if (ts.isPropertyAccessExpression(node)) {
    const direct = asHttpMethod(node.name.text);
    if (
      direct &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "exports") ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "module" &&
          node.expression.name.text === "exports"))
    ) {
      return direct;
    }
  }
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
    const direct = asHttpMethod(node.argumentExpression.text);
    if (
      direct &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "exports") ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "module" &&
          node.expression.name.text === "exports"))
    ) {
      return direct;
    }
  }
  return null;
}

function isCommonJsExportsObject(node: ts.Expression) {
  return (
    (ts.isIdentifier(node) && node.text === "exports") ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "module" &&
      node.name.text === "exports")
  );
}

function httpProperties(object: ts.ObjectLiteralExpression) {
  return object.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) return [];
    const method = asHttpMethod(propertyNameText(property.name));
    return method ? [method] : [];
  });
}

function exportedHttpBindings(source: ts.SourceFile): HttpExport[] {
  const exports: HttpExport[] = [];
  const exportedVariables = new Set<HttpMethod>();

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) {
      const method = asHttpMethod(statement.name.text);
      if (method) exports.push({ kind: "function", method });
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) {
          const method = asHttpMethod(name);
          if (!method) continue;
          exportedVariables.add(method);
          exports.push({ declaration, declarationList: statement.declarationList, kind: "variable", method });
        }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const method = asHttpMethod(element.name.text) ?? asHttpMethod(element.propertyName?.text);
        if (method) exports.push({ kind: "reexport", method });
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isIdentifier(node.left)) {
        const method = asHttpMethod(node.left.text);
        if (method && exportedVariables.has(method)) exports.push({ kind: "assignment", method });
      }
      const directCommonJs = commonJsPropertyMethod(node.left);
      if (directCommonJs) exports.push({ kind: "commonjs", method: directCommonJs });
      if (isCommonJsExportsObject(node.left) && ts.isObjectLiteralExpression(node.right)) {
        for (const method of httpProperties(node.right)) exports.push({ kind: "commonjs", method });
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" &&
      node.expression.name.text === "assign" &&
      node.arguments[0] &&
      isCommonJsExportsObject(node.arguments[0]) &&
      node.arguments[1] &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      for (const method of httpProperties(node.arguments[1])) exports.push({ kind: "commonjs", method });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return exports;
}

function wrapperAliases(source: ts.SourceFile, path: string, errors: string[]) {
  const aliases = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !resolvesToModule(statement.moduleSpecifier.text, path, adminRoutePath)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || statement.importClause?.name) {
      errors.push("admin route wrapper must use only a named import");
      continue;
    }
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "withAdminPermission") {
        aliases.add(element.name.text);
      }
    }
  }
  return aliases;
}

function analyzeProtectedRoute(
  path: string,
  sourceText = readFileSync(path, "utf8"),
  expectedPermissions: Partial<Record<HttpMethod, string>> = {},
) {
  const source = sourceFile(path, sourceText);
  const parseDiagnostics =
    (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const errors = parseDiagnostics.map((diagnostic) => `parse:${diagnostic.code}`);
  errors.push(...forbiddenRouteExportForms(source));
  errors.push(...unexpectedRouteRuntimeExports(source, Object.keys(expectedPermissions)));
  const aliases = wrapperAliases(source, path, errors);
  const handlers = exportedHttpBindings(source);
  const counts = new Map<HttpMethod, number>();

  for (const handler of handlers) {
    counts.set(handler.method, (counts.get(handler.method) ?? 0) + 1);
    const expectedPermission = expectedPermissions[handler.method];
    if (!expectedPermission) errors.push(`${handler.method} is not in the canonical route inventory`);
    if (handler.kind !== "variable" || !handler.declaration || !handler.declarationList) {
      errors.push(`${handler.method} must be one directly wrapped exported const`);
      continue;
    }
    if (!ts.isIdentifier(handler.declaration.name)) {
      errors.push(`${handler.method} must use a simple identifier binding`);
      continue;
    }
    if ((handler.declarationList.flags & ts.NodeFlags.Const) === 0) {
      errors.push(`${handler.method} must be immutable`);
    }
    const initializer = handler.declaration.initializer;
    if (
      !initializer ||
      !ts.isCallExpression(initializer) ||
      !ts.isIdentifier(initializer.expression) ||
      !aliases.has(initializer.expression.text)
    ) {
      errors.push(`${handler.method} must call the imported wrapper directly`);
      continue;
    }
    if (initializer.arguments.length !== 2) errors.push(`${handler.method} wrapper must have exactly two arguments`);
    const permission = initializer.arguments[0];
    if (!permission || !ts.isStringLiteral(permission) || permission.text !== expectedPermission) {
      errors.push(`${handler.method} must declare exact permission ${expectedPermission}`);
    }
    const callback = initializer.arguments[1];
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
      errors.push(`${handler.method} must supply an inline protected callback`);
    }
  }

  for (const [method, permission] of Object.entries(expectedPermissions)) {
    if (permission && counts.get(method as HttpMethod) !== 1) {
      errors.push(`${method} must occur exactly once`);
    }
  }
  if (handlers.length === 0) errors.push("route must export at least one HTTP handler");
  if (aliases.size !== 1) errors.push("route must import exactly one structural wrapper binding");
  return errors;
}

function analyzeLoginRoute(path: string, sourceText = readFileSync(path, "utf8")) {
  const source = sourceFile(path, sourceText);
  const parseDiagnostics =
    (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const errors = parseDiagnostics.map((diagnostic) => `parse:${diagnostic.code}`);
  errors.push(...forbiddenRouteExportForms(source));
  errors.push(...unexpectedRouteRuntimeExports(source, ["POST"]));
  const handlers = exportedHttpBindings(source);
  const postDeclaration = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "POST" && isExported(statement),
  );
  if (
    handlers.length !== 1 ||
    handlers[0]?.method !== "POST" ||
    handlers[0]?.kind !== "function" ||
    !postDeclaration ||
    isDefaultExported(postDeclaration)
  ) {
    errors.push("login route must export exactly one named non-default function-declaration POST handler");
  }
  return errors;
}

function callExpressionsNamed(node: ts.Node, name: string) {
  const calls: ts.CallExpression[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === name) {
      calls.push(child);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

function protectedSymbolAuthority(path: string, sourceText = readFileSync(path, "utf8")) {
  const source = sourceFile(path, sourceText);
  const constantBindings = constantStringBindings(source);
  const semanticReturns = semanticFunctionReturns(source, constantBindings);
  const importAliases = new Map<string, string>();
  const namespaceAliases = new Set<string>();
  const commonJsLoaderAliases = new Set(["require"]);
  const createRequireAliases = new Set<string>();
  const imports: string[] = [];
  const calls: string[] = [];
  const forbiddenAccesses: string[] = [];

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (statement.moduleSpecifier.text === "node:module" || statement.moduleSpecifier.text === "module")
    ) {
      forbiddenAccesses.push("node module loader import");
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName?.text ?? element.name.text) === "createRequire") {
            createRequireAliases.add(element.name.text);
          }
        }
      }
    }
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      resolvesToModule(statement.moduleSpecifier.text, path, adminAuthPath)
    ) {
      if (statement.importClause?.name) forbiddenAccesses.push("default import");
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceAliases.add(bindings.name.text);
        forbiddenAccesses.push("namespace import");
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (!protectedLoginSymbols.has(imported)) continue;
          imports.push(imported);
          importAliases.set(element.name.text, imported);
        }
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      resolvesToModule(statement.moduleSpecifier.text, path, adminAuthPath)
    ) {
      forbiddenAccesses.push("re-export");
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      (statement.moduleReference.expression.text === "node:module" ||
        statement.moduleReference.expression.text === "module")
    ) {
      forbiddenAccesses.push("node module import equals");
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      resolvesToModule(statement.moduleReference.expression.text, path, adminAuthPath)
    ) {
      forbiddenAccesses.push("import equals");
    }
  }

  const processAliases = new Set(["process"]);
  const moduleAliases = new Set(["module"]);
  const reflectAliases = new Set(["Reflect"]);
  const globalAliases = new Set(["globalThis"]);
  const reflectGetAliases = new Set<string>();
  const identifierAlias = (expression: ts.Expression, aliases: ReadonlySet<string>) => {
    const unwrapped = unwrapExpression(expression);
    return ts.isIdentifier(unwrapped) && aliases.has(unwrapped.text);
  };
  const memberAccess = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
    if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression) {
      return constantStringExpression(unwrapped.argumentExpression, constantBindings);
    }
    return null;
  };
  const globalMemberReference = (expression: ts.Expression, expectedMember: string) => {
    const unwrapped = unwrapExpression(expression);
    if (!ts.isPropertyAccessExpression(unwrapped) && !ts.isElementAccessExpression(unwrapped)) return false;
    return memberAccess(unwrapped) === expectedMember && identifierAlias(unwrapped.expression, globalAliases);
  };
  const reflectReference = (expression: ts.Expression) =>
    identifierAlias(expression, reflectAliases) || globalMemberReference(expression, "Reflect");
  const reflectGetReference = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) return reflectGetAliases.has(unwrapped.text);
    if (!ts.isPropertyAccessExpression(unwrapped) && !ts.isElementAccessExpression(unwrapped)) return false;
    return memberAccess(unwrapped) === "get" && reflectReference(unwrapped.expression);
  };
  let privilegedAliasChanged = true;
  while (privilegedAliasChanged) {
    privilegedAliasChanged = false;
    const addAlias = (aliases: Set<string>, name: string) => {
      if (aliases.has(name)) return;
      aliases.add(name);
      privilegedAliasChanged = true;
    };
    const visitPrivilegedAliases = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name)) {
          if (identifierAlias(node.initializer, processAliases) || globalMemberReference(node.initializer, "process")) {
            addAlias(processAliases, node.name.text);
          }
          if (identifierAlias(node.initializer, moduleAliases)) addAlias(moduleAliases, node.name.text);
          if (reflectReference(node.initializer)) addAlias(reflectAliases, node.name.text);
          if (identifierAlias(node.initializer, globalAliases)) addAlias(globalAliases, node.name.text);
          if (reflectGetReference(node.initializer)) addAlias(reflectGetAliases, node.name.text);
        } else if (ts.isObjectBindingPattern(node.name)) {
          const initializer = unwrapExpression(node.initializer);
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const member = propertyNameText(element.propertyName ?? element.name);
            if (ts.isIdentifier(initializer) && globalAliases.has(initializer.text)) {
              if (member === "process") addAlias(processAliases, element.name.text);
              if (member === "Reflect") addAlias(reflectAliases, element.name.text);
            }
            if (ts.isIdentifier(initializer) && reflectAliases.has(initializer.text) && member === "get") {
              addAlias(reflectGetAliases, element.name.text);
            }
            if (
              (ts.isIdentifier(initializer) && processAliases.has(initializer.text) && member === "getBuiltinModule") ||
              (ts.isIdentifier(initializer) && moduleAliases.has(initializer.text) && member === "require")
            ) {
              forbiddenAccesses.push(`destructured privileged loader:${member}`);
            }
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        if (identifierAlias(node.right, processAliases)) addAlias(processAliases, node.left.text);
        if (identifierAlias(node.right, moduleAliases)) addAlias(moduleAliases, node.left.text);
        if (identifierAlias(node.right, reflectAliases)) addAlias(reflectAliases, node.left.text);
        if (identifierAlias(node.right, globalAliases)) addAlias(globalAliases, node.left.text);
        if (reflectGetReference(node.right)) addAlias(reflectGetAliases, node.left.text);
      }
      ts.forEachChild(node, visitPrivilegedAliases);
    };
    visitPrivilegedAliases(source);
  }

  type PrivilegedIdentity =
    | "commonJsLoader"
    | "createRequire"
    | "global"
    | "module"
    | "moduleGetter"
    | "process"
    | "reflect"
    | "reflectGet";
  const semanticPrivilegedAliases = new Map<string, Set<PrivilegedIdentity>>([
    ["globalThis", new Set(["global"])],
    ["module", new Set(["module"])],
    ["process", new Set(["process"])],
    ["Reflect", new Set(["reflect"])],
    ["require", new Set(["commonJsLoader"])],
  ]);
  for (const name of createRequireAliases) semanticPrivilegedAliases.set(name, new Set(["createRequire"]));
  const mergePrivilegedIdentities = (
    target: Set<PrivilegedIdentity>,
    sourceIdentities: Iterable<PrivilegedIdentity>,
  ) => {
    let added = false;
    for (const identity of sourceIdentities) {
      if (target.has(identity)) continue;
      target.add(identity);
      added = true;
    }
    return added;
  };
  const memberPrivilegedIdentities = (identities: ReadonlySet<PrivilegedIdentity>, member: string | null) => {
    const result = new Set<PrivilegedIdentity>();
    if (!member) return result;
    for (const identity of identities) {
      if (identity === "global" && member === "process") result.add("process");
      else if (identity === "global" && member === "Reflect") result.add("reflect");
      else if (identity === "process" && member === "getBuiltinModule") result.add("moduleGetter");
      else if (identity === "module" && member === "require") result.add("commonJsLoader");
      else if (identity === "module" && member === "createRequire") result.add("createRequire");
      else if (identity === "reflect" && member === "get") result.add("reflectGet");
      else if (
        (member === "bind" || member === "call" || member === "apply") &&
        (identity === "commonJsLoader" || identity === "createRequire" || identity === "moduleGetter")
      ) {
        result.add(identity);
      } else if (/^(?:\d+|at)$/u.test(member) && identity === "module") {
        result.add("module");
      } else if (identity === "module" || identity === "process" || identity === "reflect") {
        result.add(identity);
      } else if (identity === "global") {
        result.add("global");
      }
    }
    return result;
  };
  const privilegedIdentitiesFor = (
    expression: ts.Expression,
    visited = new Set<ts.Expression>(),
  ): Set<PrivilegedIdentity> => {
    const unwrapped = unwrapExpression(expression);
    if (visited.has(unwrapped)) return new Set();
    const nextVisited = new Set(visited).add(unwrapped);
    if (ts.isIdentifier(unwrapped)) {
      return new Set(semanticPrivilegedAliases.get(unwrapped.text) ?? []);
    }
    if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
      const member = ts.isPropertyAccessExpression(unwrapped)
        ? unwrapped.name.text
        : unwrapped.argumentExpression
          ? constantStringExpression(unwrapped.argumentExpression, constantBindings)
          : null;
      const result = memberPrivilegedIdentities(privilegedIdentitiesFor(unwrapped.expression, nextVisited), member);
      for (const returned of semanticReturns.fromValue(unwrapped)) {
        mergePrivilegedIdentities(result, privilegedIdentitiesFor(returned, nextVisited));
      }
      return result;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      const result = new Set<PrivilegedIdentity>();
      for (const element of unwrapped.elements) {
        if (ts.isExpression(element)) mergePrivilegedIdentities(result, privilegedIdentitiesFor(element, nextVisited));
      }
      return result;
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
      const result = new Set<PrivilegedIdentity>();
      for (const property of unwrapped.properties) {
        if (ts.isPropertyAssignment(property)) {
          mergePrivilegedIdentities(result, privilegedIdentitiesFor(property.initializer, nextVisited));
        } else if (ts.isShorthandPropertyAssignment(property)) {
          mergePrivilegedIdentities(result, privilegedIdentitiesFor(property.name, nextVisited));
        } else if (ts.isSpreadAssignment(property)) {
          mergePrivilegedIdentities(result, privilegedIdentitiesFor(property.expression, nextVisited));
        }
      }
      return result;
    }
    if (ts.isBinaryExpression(unwrapped)) {
      const operator = unwrapped.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.CommaToken ||
        (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment)
      ) {
        const result = privilegedIdentitiesFor(unwrapped.left, nextVisited);
        mergePrivilegedIdentities(result, privilegedIdentitiesFor(unwrapped.right, nextVisited));
        return result;
      }
      return new Set();
    }
    if (ts.isCallExpression(unwrapped)) {
      const semanticReturnedValues = semanticReturns.fromCall(unwrapped);
      if (semanticReturnedValues.length > 0) {
        const returnedIdentities = new Set<PrivilegedIdentity>();
        for (const returned of semanticReturnedValues) {
          mergePrivilegedIdentities(returnedIdentities, privilegedIdentitiesFor(returned, nextVisited));
        }
        return returnedIdentities;
      }
      const calleeIdentities = privilegedIdentitiesFor(unwrapped.expression, nextVisited);
      if (calleeIdentities.has("reflectGet")) {
        const target = unwrapped.arguments[0]
          ? privilegedIdentitiesFor(unwrapped.arguments[0], nextVisited)
          : new Set<PrivilegedIdentity>();
        const member = unwrapped.arguments[1]
          ? constantStringExpression(unwrapped.arguments[1], constantBindings)
          : null;
        return memberPrivilegedIdentities(target, member);
      }
      if (calleeIdentities.has("moduleGetter")) return new Set(["module"]);
      if (calleeIdentities.has("createRequire")) return new Set(["commonJsLoader"]);
      const callee = unwrapExpression(unwrapped.expression);
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const member = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : callee.argumentExpression
            ? constantStringExpression(callee.argumentExpression, constantBindings)
            : null;
        if (member === "concat") {
          const result = privilegedIdentitiesFor(callee.expression, nextVisited);
          for (const argument of unwrapped.arguments) {
            mergePrivilegedIdentities(result, privilegedIdentitiesFor(argument, nextVisited));
          }
          return result;
        }
        if (
          member === "bind" &&
          (calleeIdentities.has("commonJsLoader") ||
            calleeIdentities.has("createRequire") ||
            calleeIdentities.has("moduleGetter"))
        ) {
          return calleeIdentities;
        }
      }
      return new Set(
        [...calleeIdentities].filter(
          (identity) =>
            identity !== "commonJsLoader" &&
            identity !== "createRequire" &&
            identity !== "moduleGetter" &&
            identity !== "reflectGet",
        ),
      );
    }
    return new Set();
  };
  let semanticPrivilegedChanged = true;
  while (semanticPrivilegedChanged) {
    semanticPrivilegedChanged = false;
    const recordName = (name: string, identities: ReadonlySet<PrivilegedIdentity>) => {
      if (identities.size === 0) return;
      const existing = semanticPrivilegedAliases.get(name) ?? new Set<PrivilegedIdentity>();
      if (mergePrivilegedIdentities(existing, identities)) semanticPrivilegedChanged = true;
      semanticPrivilegedAliases.set(name, existing);
    };
    const recordBinding = (name: ts.BindingName, identities: ReadonlySet<PrivilegedIdentity>) => {
      if (ts.isIdentifier(name)) {
        recordName(name.text, identities);
        return;
      }
      for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) continue;
        const member = ts.isObjectBindingPattern(name)
          ? propertyNameText(element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined))
          : null;
        recordBinding(element.name, member ? memberPrivilegedIdentities(identities, member) : identities);
      }
    };
    const recordAssignmentTarget = (target: ts.Expression, identities: ReadonlySet<PrivilegedIdentity>) => {
      const unwrapped = unwrapExpression(target);
      if (ts.isIdentifier(unwrapped)) {
        recordName(unwrapped.text, identities);
      } else if (ts.isObjectLiteralExpression(unwrapped)) {
        for (const property of unwrapped.properties) {
          if (ts.isPropertyAssignment(property)) {
            recordAssignmentTarget(
              property.initializer,
              memberPrivilegedIdentities(identities, propertyNameText(property.name)),
            );
          } else if (ts.isShorthandPropertyAssignment(property)) {
            recordAssignmentTarget(
              property.name,
              memberPrivilegedIdentities(identities, propertyNameText(property.name)),
            );
          }
        }
      } else if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) recordAssignmentTarget(element, identities);
        }
      } else {
        const root = expressionRootName(unwrapped);
        if (root) recordName(root, identities);
      }
    };
    const visitSemanticAliases = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        recordBinding(node.name, privilegedIdentitiesFor(node.initializer));
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        recordAssignmentTarget(node.left, privilegedIdentitiesFor(node.right));
      }
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const returned = new Set<PrivilegedIdentity>();
        for (const expression of returnedExpressions(node.body)) {
          mergePrivilegedIdentities(returned, privilegedIdentitiesFor(expression));
        }
        recordName(node.name.text, returned);
      }
      ts.forEachChild(node, visitSemanticAliases);
    };
    visitSemanticAliases(source);
  }

  const isModuleRequire = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(unwrapped)) {
      return (
        ts.isIdentifier(unwrapped.expression) &&
        unwrapped.expression.text === "module" &&
        unwrapped.name.text === "require"
      );
    }
    if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression) {
      return (
        ts.isIdentifier(unwrapped.expression) &&
        unwrapped.expression.text === "module" &&
        constantStringExpression(unwrapped.argumentExpression, constantBindings) === "require"
      );
    }
    return false;
  };
  const isCreateRequireCall = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    return (
      ts.isCallExpression(unwrapped) &&
      ts.isIdentifier(unwrapExpression(unwrapped.expression)) &&
      createRequireAliases.has((unwrapExpression(unwrapped.expression) as ts.Identifier).text)
    );
  };
  const isCommonJsLoader = (expression: ts.Expression) => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) return commonJsLoaderAliases.has(unwrapped.text);
    if (isModuleRequire(unwrapped) || isCreateRequireCall(unwrapped)) return true;
    if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
      const member = ts.isPropertyAccessExpression(unwrapped)
        ? unwrapped.name.text
        : unwrapped.argumentExpression
          ? constantStringExpression(unwrapped.argumentExpression, constantBindings)
          : null;
      if (member === "bind" || member === "call" || member === "apply") {
        return isCommonJsLoader(unwrapped.expression);
      }
    }
    return false;
  };
  let loaderChanged = true;
  while (loaderChanged) {
    loaderChanged = false;
    const visitAlias = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer && isCommonJsLoader(node.initializer)) {
        for (const name of bindingNames(node.name)) {
          if (!commonJsLoaderAliases.has(name)) {
            commonJsLoaderAliases.add(name);
            loaderChanged = true;
          }
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        ts.isIdentifier(unwrapExpression(node.initializer)) &&
        expressionRootName(node.initializer) === "module"
      ) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          if (propertyNameText(element.propertyName ?? element.name) !== "require") continue;
          if (!commonJsLoaderAliases.has(element.name.text)) {
            commonJsLoaderAliases.add(element.name.text);
            loaderChanged = true;
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        isCommonJsLoader(node.right) &&
        !commonJsLoaderAliases.has(node.left.text)
      ) {
        commonJsLoaderAliases.add(node.left.text);
        loaderChanged = true;
      }
      ts.forEachChild(node, visitAlias);
    };
    visitAlias(source);
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const semanticCallee = privilegedIdentitiesFor(node.expression);
      if (semanticCallee.has("commonJsLoader")) forbiddenAccesses.push("semantic CommonJS loader call");
      if (semanticCallee.has("moduleGetter")) forbiddenAccesses.push("semantic privileged module getter call");
      if (semanticCallee.has("createRequire")) forbiddenAccesses.push("semantic createRequire call");
      if (reflectGetReference(node.expression)) {
        const target = node.arguments[0] ? unwrapExpression(node.arguments[0]) : null;
        const reflectedMember = node.arguments[1]
          ? constantStringExpression(node.arguments[1], constantBindings)
          : null;
        if (
          target &&
          ts.isIdentifier(target) &&
          ((processAliases.has(target.text) && reflectedMember === "getBuiltinModule") ||
            (moduleAliases.has(target.text) && reflectedMember === "require"))
        ) {
          forbiddenAccesses.push(`reflected privileged loader:${reflectedMember}`);
        }
      }
      if (isCommonJsLoader(node.expression)) {
        const moduleName = node.arguments[0] ? constantStringExpression(node.arguments[0], constantBindings) : null;
        forbiddenAccesses.push(
          moduleName === null ? "unresolved CommonJS loader module" : `CommonJS loader:${moduleName}`,
        );
      } else if (isCreateRequireCall(node)) {
        forbiddenAccesses.push("createRequire");
      }
      if (ts.isIdentifier(node.expression)) {
        const imported = importAliases.get(node.expression.text);
        if (imported) calls.push(imported);
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
        const moduleName = constantStringExpression(node.arguments[0], constantBindings);
        if (
          moduleName === null ||
          moduleName === "node:module" ||
          moduleName === "module" ||
          resolvesToModule(moduleName, path, adminAuthPath)
        ) {
          forbiddenAccesses.push(moduleName === null ? "unresolved dynamic import module" : "dynamic import");
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const member = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression
          ? constantStringExpression(node.argumentExpression, constantBindings)
          : null;
      const receiver = unwrapExpression(node.expression);
      if (member === "getBuiltinModule" && privilegedIdentitiesFor(node.expression).has("moduleGetter")) {
        forbiddenAccesses.push("process.getBuiltinModule reference");
      }
      if (member === "require" && ts.isIdentifier(receiver) && moduleAliases.has(receiver.text)) {
        forbiddenAccesses.push("module.require reference");
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaceAliases.has(node.expression.text) &&
      protectedLoginSymbols.has(node.name.text)
    ) {
      forbiddenAccesses.push(node.name.text);
    }
    if (
      ts.isIdentifier(node) &&
      (commonJsLoaderAliases.has(node.text) || createRequireAliases.has(node.text)) &&
      !ts.isImportSpecifier(node.parent) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      !(
        (ts.isPropertyAssignment(node.parent) ||
          ts.isMethodDeclaration(node.parent) ||
          ts.isGetAccessorDeclaration(node.parent) ||
          ts.isSetAccessorDeclaration(node.parent)) &&
        node.parent.name === node
      ) &&
      !(ts.isBindingElement(node.parent) && node.parent.propertyName === node)
    ) {
      forbiddenAccesses.push("CommonJS loader reference");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { calls, forbiddenAccesses, imports };
}

function resolvedProtectedSymbolCalls(
  program = productionProgram,
  paths = productionPaths,
  protectedModulePath = adminAuthPath,
) {
  const checker = program.getTypeChecker();
  const calls: Array<{ path: string; symbol: string }> = [];
  const unalias = (symbol: ts.Symbol) =>
    (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  const rootsFromNode = (
    node: ts.Node,
    visitedSymbols = new Set<ts.Symbol>(),
    visitedNodes = new Set<ts.Node>(),
  ): Set<string> => {
    if (visitedNodes.has(node)) return new Set();
    visitedNodes.add(node);
    const roots = new Set<string>();
    const symbolNode = ts.isPropertyAccessExpression(node) ? node.name : node;
    const located = checker.getSymbolAtLocation(symbolNode);
    if (located) {
      const symbol = unalias(located);
      if (!visitedSymbols.has(symbol)) {
        visitedSymbols.add(symbol);
        if (
          protectedRuntimeSymbols.has(symbol.name) &&
          symbol.declarations?.some(
            (declaration) => resolve(declaration.getSourceFile().fileName) === protectedModulePath,
          )
        ) {
          roots.add(symbol.name);
        } else {
          for (const declaration of symbol.declarations ?? []) {
            if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
              for (const root of rootsFromNode(declaration.initializer, visitedSymbols, visitedNodes)) roots.add(root);
            } else if (ts.isPropertyAssignment(declaration)) {
              for (const root of rootsFromNode(declaration.initializer, visitedSymbols, visitedNodes)) roots.add(root);
            } else if (ts.isShorthandPropertyAssignment(declaration)) {
              const value = checker.getShorthandAssignmentValueSymbol(declaration);
              if (value) {
                for (const root of rootsFromNode(
                  value.valueDeclaration ?? declaration.name,
                  visitedSymbols,
                  visitedNodes,
                )) {
                  roots.add(root);
                }
              }
            } else if (
              (ts.isFunctionDeclaration(declaration) ||
                ts.isFunctionExpression(declaration) ||
                ts.isArrowFunction(declaration) ||
                ts.isMethodDeclaration(declaration) ||
                ts.isGetAccessorDeclaration(declaration) ||
                ts.isSetAccessorDeclaration(declaration)) &&
              declaration.body
            ) {
              for (const root of rootsFromNode(declaration.body, visitedSymbols, visitedNodes)) roots.add(root);
            }
          }
        }
      }
    }
    if (roots.size === 0) {
      ts.forEachChild(node, (child) => {
        for (const root of rootsFromNode(child, visitedSymbols, visitedNodes)) roots.add(root);
      });
    }
    return roots;
  };

  for (const path of paths) {
    const source = program.getSourceFile(resolve(path));
    if (!source) throw new Error(`TypeScript program omitted governed production source ${path}`);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        for (const symbol of rootsFromNode(node.expression)) calls.push({ path, symbol });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return calls;
}

describe("admin authentication production boundary", () => {
  it("gives the login route sole symbol-level authority to verify passwords and mint sessions", () => {
    const authority = productionPaths.map((path) => ({ path, ...protectedSymbolAuthority(path) }));
    const resolvedCalls = resolvedProtectedSymbolCalls();
    expect(
      authority.flatMap(({ path, forbiddenAccesses }) => forbiddenAccesses.map((kind) => `${path}:${kind}`)),
    ).toEqual([]);
    for (const symbol of protectedLoginSymbols) {
      expect(
        authority.flatMap(({ path, imports }) => imports.filter((imported) => imported === symbol).map(() => path)),
        `${symbol} import authority`,
      ).toEqual([adminLoginRoute]);
      expect(
        resolvedCalls.filter((call) => call.symbol === symbol).map((call) => call.path),
        `${symbol} checker-resolved call authority`,
      ).toEqual([adminLoginRoute]);
    }

    const authSource = readFileSync("lib/server/admin-auth.ts", "utf8");
    expect(authSource).not.toMatch(/export\s+(?:async\s+)?function\s+createAdminSessionCookie\b/);
  }, 60_000);

  it("resolves relative and aliased auth imports to one canonical module and rejects indirect access", () => {
    const relativePath = "app/api/admin/example/route.ts";
    const relative = protectedSymbolAuthority(
      relativePath,
      'import { createAdminLoginSession as mint } from "../../../../lib/server/admin-auth"; mint({} as never, 0);',
    );
    expect(relative.imports).toEqual(["createAdminLoginSession"]);
    expect(relative.calls).toEqual(["createAdminLoginSession"]);

    for (const sourceText of [
      'const auth = require("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const auth = require(("../../../../lib/server/admin-auth")); auth.createAdminLoginSession({} as never, 0);',
      'const auth = require("../../../../lib/server/admin-auth" as string); auth.createAdminLoginSession({} as never, 0);',
      "const auth = require(`../../../../lib/server/admin-auth`); auth.createAdminLoginSession({} as never, 0);",
      'const auth = require("../../" + "../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const authPath = "../../../../lib/server/admin-auth" as const; const auth = require(authPath); auth.createAdminLoginSession({} as never, 0);',
      "declare const authPath: string; const auth = require(authPath); auth.createAdminLoginSession({} as never, 0);",
      'void import("../../../../lib/server/admin-auth");',
      'void import(("../../../../lib/server/admin-auth" satisfies string));',
      "declare const authPath: string; void import(authPath);",
      'export { createAdminLoginSession } from "../../../../lib/server/admin-auth";',
      'import auth = require("../../../../lib/server/admin-auth");',
      'const authPath = "../../../../lib/server/admin-auth"; { const authPath = "./safe-module"; void authPath; } const auth = require(authPath); auth.createAdminLoginSession({} as never, 0);',
      'const req = require; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const authPath = "./safe-module"; function bridge(authPath: string) { const auth = require(authPath); return auth.createAdminLoginSession({} as never, 0); } bridge("../../../../lib/server/admin-auth");',
      'const auth = module.require("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'import { createRequire } from "node:module"; const req = createRequire(import.meta.url); const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'import * as nodeModule from "node:module"; const req = nodeModule.createRequire(import.meta.url); const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'import nodeModule from "node:module"; const req = nodeModule.createRequire(import.meta.url); const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'import nodeModule = require("node:module"); const req = nodeModule.createRequire(import.meta.url); const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const nodeModule = process.getBuiltinModule("module"); const req = nodeModule.createRequire(import.meta.url); const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'import * as nodeModule from "node:module"; const maker = nodeModule.createRequire.bind(nodeModule); const holder = { maker }; const req = holder.maker.call(holder, import.meta.url); const auth = req.apply(null, ["../../../../lib/server/admin-auth"]); auth.createAdminLoginSession({} as never, 0);',
      'const req = require.bind(null); const holder = { load: req }; const auth = holder.load("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const { require: req } = module; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'void import("node:module");',
      'const req = Reflect.get(module, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const P = globalThis.process; const { getBuiltinModule } = P as any; const nodeModule = getBuiltinModule("module"); const req = nodeModule.createRequire(import.meta.url); const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const M = module; const req = M.require; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const R = globalThis.Reflect; const req = R.get(module, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const { getBuiltinModule } = globalThis.process as any; const nodeModule = getBuiltinModule("module"); const req = nodeModule.createRequire(import.meta.url); const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const modules = [module]; const M = modules[0]!; const req = Reflect.get(M, "require").bind(M) as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'function moduleBridge() { return [module][0]!; } const M = moduleBridge(); const req = Reflect.get(M, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const moduleBridge = () => module; const M = moduleBridge(); const req = Reflect.get(M, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const moduleBridge = function () { return module; }; const M = moduleBridge(); const req = Reflect.get(M, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const moduleBridge = { get() { return module; } }; const M = moduleBridge.get(); const req = Reflect.get(M, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'class ModuleBridge { static get() { return module; } } const M = ModuleBridge.get(); const req = Reflect.get(M, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'class ModuleBridge { static get value() { return module; } } const M = ModuleBridge.value; const req = Reflect.get(M, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'class ModuleBridge { get() { return module; } } const bridge = new ModuleBridge(); const M = bridge.get(); const req = Reflect.get(M, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
      'const outerBridge = () => () => module; const M = outerBridge()(); const req = Reflect.get(M, "require") as NodeRequire; const auth = req("../../../../lib/server/admin-auth"); auth.createAdminLoginSession({} as never, 0);',
    ]) {
      expect(protectedSymbolAuthority(relativePath, sourceText).forbiddenAccesses, sourceText).not.toEqual([]);
    }
    expect(
      protectedSymbolAuthority(relativePath, 'import * as nodePath from "node:path"; void nodePath;').forbiddenAccesses,
    ).toEqual([]);
    expect(
      protectedSymbolAuthority(relativePath, 'const value = Reflect.get({ safe: true }, "safe"); void value;')
        .forbiddenAccesses,
    ).toEqual([]);
    expect(
      protectedSymbolAuthority(
        relativePath,
        "const { getBuiltinModule } = { getBuiltinModule: () => ({ safe: true }) }; void getBuiltinModule();",
      ).forbiddenAccesses,
    ).toEqual([]);
    expect(
      protectedSymbolAuthority(
        relativePath,
        'class ModuleBridge { static get() { return { require: () => ({ safe: true }) }; } } const M = ModuleBridge.get(); void Reflect.get(M, "require")();',
      ).forbiddenAccesses,
    ).toEqual([]);
    expect(
      protectedSymbolAuthority(
        relativePath,
        'const moduleBridge = () => ({ require: () => ({ safe: true }) }); const M = moduleBridge(); void Reflect.get(M, "require")();',
      ).forbiddenAccesses,
    ).toEqual([]);
    expect(
      protectedSymbolAuthority(
        relativePath,
        'function moduleBridge() { return module; } function safeScope() { function moduleBridge() { return { require: () => ({ safe: true }) }; } const M = moduleBridge(); void Reflect.get(M, "require")(); } safeScope();',
      ).forbiddenAccesses,
    ).toEqual([]);
  });

  it("discovers every filesystem route that can match the admin URL prefix", async () => {
    const root = mkdtempSync(join(tmpdir(), "oriental-admin-routes-"));
    const hostilePaths = [
      "app/(shadow)/api/admin/export/route.ts",
      "app/api/(shadow)/admin/export/route.ts",
      "app/api/[namespace]/export/route.ts",
      "app/api/[...slug]/route.ts",
      "app/api/[[...slug]]/route.ts",
      "app/(.)api/admin/export/route.ts",
      "pages/api/admin.ts",
      "pages/api/admin/index.ts",
      "pages/api/[namespace]/export.ts",
      "pages/api/[...slug].ts",
      "src/app/(shadow)/api/admin/export/route.ts",
      "src/pages/api/admin.ts",
      ...sourceExtensionList.map((extension) => `app/(extension-${extension})/api/admin/export/route.${extension}`),
    ].sort();
    try {
      for (const path of hostilePaths) {
        const absolute = join(root, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, "export const GET = () => new Response();\n", "utf8");
      }
      expect(discoverAdminRoutePaths(root)).toEqual(hostilePaths);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
    for (const safePath of [
      "app/api/public/route.ts",
      "pages/api/public.ts",
      "app/admin/page.tsx",
      "pages/admin.tsx",
    ]) {
      expect(routeCanMatchAdminPath(safePath), safePath).toBe(false);
    }
    expect(unsupportedNextPageExtensions(await effectiveNextPageExtensions())).toEqual([]);
  });

  it("loads computed and imported Next page extensions before validating route coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "oriental-next-config-"));
    try {
      writeFileSync(join(root, "route-extensions.mjs"), 'export const hiddenExtensions = ["adminroute"];\n', "utf8");
      writeFileSync(
        join(root, "next.config.mjs"),
        'import { hiddenExtensions } from "./route-extensions.mjs";\nexport default { pageExtensions: ["ts", ...hiddenExtensions.map((extension) => extension)] };\n',
        "utf8",
      );
      const pageExtensions = await effectiveNextPageExtensions(root);
      expect(pageExtensions).toEqual(["ts", "adminroute"]);
      expect(unsupportedNextPageExtensions(pageExtensions)).toEqual(["adminroute"]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("pins every exact admin path and method to its one permission", () => {
    expect(adminRoutePaths).toEqual(canonicalAdminRoutes);
    for (const [path, permissions] of Object.entries(canonicalAdminRoutePermissions)) {
      const effectiveExports = effectiveRuntimeModuleExports(path);
      expect(
        effectiveExports
          .map((entry) => entry.exported)
          .filter((name) => httpMethods.has(name))
          .sort(),
        `${path} effective HTTP exports`,
      ).toEqual(Object.keys(permissions).sort());
      expect(
        effectiveExports.filter((entry) => !httpMethods.has(entry.exported) && !routeConfigExports.has(entry.exported)),
        `${path} unexpected effective runtime exports`,
      ).toEqual([]);
      if (path === adminLoginRoute) {
        expect(analyzeLoginRoute(path), path).toEqual([]);
      } else {
        expect(
          analyzeProtectedRoute(path, readFileSync(path, "utf8"), permissions as Partial<Record<HttpMethod, string>>),
          path,
        ).toEqual([]);
      }
    }
  });

  it("rejects mutable, destructured, aliased, CommonJS, extra, and permission-substituted handlers", () => {
    const prelude = 'import { withAdminPermission as guard } from "@/lib/server/admin-route";\n';
    const expected = { GET: "dashboard.read" };
    expect(
      analyzeProtectedRoute(
        "fixture.ts",
        `${prelude}export const GET = guard("dashboard.read", async () => new Response());`,
        expected,
      ),
    ).toEqual([]);

    for (const fixture of [
      `${prelude}export async function GET() { return new Response(); }`,
      `${prelude}export let GET = guard("dashboard.read", async () => new Response()); GET = async () => new Response();`,
      `${prelude}const handlers = { GET: async () => new Response() }; export const { GET } = handlers;`,
      `${prelude}const hidden = guard("dashboard.read", async () => new Response()); export { hidden as GET };`,
      `${prelude}export const GET = guard("dashboard.aggregate", async () => new Response());`,
      `${prelude}export const GET = guard(variablePermission, async () => new Response());`,
      `${prelude}export const GET = guard("dashboard.read", namedHandler);`,
      `${prelude}export const GET = guard("dashboard.read", async () => new Response()); export const POST = guard("leads.update", async () => new Response());`,
      `${prelude}export const GET = guard("dashboard.read", async () => new Response()); export * from "./unguarded-handlers";`,
      `${prelude}module.exports.GET = async () => new Response();`,
      `${prelude}module.exports = { GET: async () => new Response() };`,
      `${prelude}Object.assign(exports, { GET: async () => new Response() });`,
      `${prelude}Object.defineProperty(module.exports, "DELETE", { value: async () => new Response() });`,
      `${prelude}exports.HEAD ??= async () => new Response();`,
      `${prelude}module["exports"].POST ||= async () => new Response();`,
      `${prelude}Reflect.set(exports, "OPTIONS", async () => new Response());`,
    ]) {
      expect(analyzeProtectedRoute("fixture.ts", fixture, expected), fixture).not.toEqual([]);
    }
  });

  it("applies the same fail-closed handler inventory to every supported route extension", () => {
    const prelude = 'import { withAdminPermission as guard } from "@/lib/server/admin-route";\n';
    const hostileSuffixes = [
      'export * from "./unguarded-handlers";',
      'Object.defineProperty(module.exports, "DELETE", { value: async () => new Response() });',
      "exports.HEAD ??= async () => new Response();",
      'module["exports"].POST ||= async () => new Response();',
      'Reflect.set(exports, "OPTIONS", async () => new Response());',
    ];
    for (const extension of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]) {
      const path = `fixture.${extension}`;
      const accepted = `${prelude}export const GET = guard("dashboard.read", async () => new Response());`;
      expect(analyzeProtectedRoute(path, accepted, { GET: "dashboard.read" }), path).toEqual([]);
      for (const hostileSuffix of hostileSuffixes) {
        expect(
          analyzeProtectedRoute(path, `${accepted}\n${hostileSuffix}`, { GET: "dashboard.read" }),
          `${path}:${hostileSuffix}`,
        ).not.toEqual([]);
      }
    }
  });

  it("includes formerly unlisted top-level runtime bridges in authority analysis", () => {
    const path = "runtime-helpers/auth-bridge.ts";
    expect(isProductionRootPath(path)).toBe(true);
    const bridge = protectedSymbolAuthority(
      path,
      'import { createAdminLoginSession as mint } from "../lib/server/admin-auth"; mint({} as never, 0);',
    );
    expect(bridge.imports).toEqual(["createAdminLoginSession"]);
    expect(bridge.calls).toEqual(["createAdminLoginSession"]);

    const javascriptBridge = protectedSymbolAuthority(
      "runtime-helpers/auth-bridge.js",
      'import { createAdminLoginSession as mint } from "../lib/server/admin-auth"; mint({}, 0);',
    );
    expect(javascriptBridge.imports).toEqual(["createAdminLoginSession"]);
    expect(javascriptBridge.calls).toEqual(["createAdminLoginSession"]);
  });

  it("governs every repository-local source reachable from a production root", () => {
    const root = mkdtempSync(join(tmpdir(), "oriental-admin-program-"));
    const authPath = join(root, "lib/server/admin-auth.ts");
    const publicRoute = join(root, "app/api/public/route.ts");
    const bridgePaths = [
      ".runtime/admin-mint.ts",
      "test/admin-mint.ts",
      "convex/_generated/admin-mint.ts",
      "vendor/admin-mint.ts",
    ];
    try {
      mkdirSync(dirname(authPath), { recursive: true });
      mkdirSync(dirname(publicRoute), { recursive: true });
      writeFileSync(
        authPath,
        "export function createAdminLoginSession() { return {}; }\nexport function verifyAdminLoginCredential() { return {}; }\n",
        "utf8",
      );
      for (const bridgePath of bridgePaths) {
        const absolute = join(root, bridgePath);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(
          absolute,
          'import { createAdminLoginSession } from "../lib/server/admin-auth";\nexport function mint() { return createAdminLoginSession(); }\n'.replace(
            '"../lib/server/admin-auth"',
            JSON.stringify(
              relative(dirname(absolute), authPath)
                .replaceAll("\\", "/")
                .replace(/^(?!\.)/u, "./"),
            ),
          ),
          "utf8",
        );
      }
      writeFileSync(
        publicRoute,
        bridgePaths
          .map((bridgePath, index) => {
            const specifier = relative(dirname(publicRoute), join(root, bridgePath))
              .replaceAll("\\", "/")
              .replace(/^(?!\.)/u, "./");
            return `import { mint as mint${index} } from ${JSON.stringify(specifier)};\nmint${index}();`;
          })
          .join("\n"),
        "utf8",
      );
      const program = ts.createProgram([publicRoute], {
        allowJs: true,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ESNext,
      });
      const governedRelativePaths = governedProgramPaths(program, root);
      expect(governedRelativePaths).toEqual(
        expect.arrayContaining(["app/api/public/route.ts", "lib/server/admin-auth.ts", ...bridgePaths]),
      );
      const calls = resolvedProtectedSymbolCalls(
        program,
        governedRelativePaths.map((path) => join(root, path)),
        authPath,
      );
      for (const bridgePath of bridgePaths) {
        expect(
          calls.some((call) => call.path === join(root, bridgePath) && call.symbol === "createAdminLoginSession"),
          bridgePath,
        ).toBe(true);
      }
      expect(
        calls.some((call) => call.path === publicRoute && call.symbol === "createAdminLoginSession"),
        "function-declaration bridge body",
      ).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("allows only the login function POST and rejects every additional export form", () => {
    const loginPost = "export async function POST() { return new Response(); }\n";
    const hostileForms = [
      `${loginPost}export const GET = async () => new Response();`,
      `${loginPost}const handlers = { DELETE: async () => new Response() }; export const { DELETE } = handlers;`,
      `${loginPost}module.exports = { OPTIONS: async () => new Response() };`,
      `${loginPost}exports["HEAD"] = async () => new Response();`,
      `${loginPost}export * from "./unguarded-handlers";`,
      "export default async function POST() { return new Response(); }",
      `${loginPost}export default async function shadowHandler() { return new Response(); }`,
      `${loginPost}const shadowHandler = async () => new Response(); export default shadowHandler;`,
      `${loginPost}export default class ShadowHandler {}`,
      `${loginPost}const shadowHandler = async () => new Response(); export = shadowHandler;`,
      `${loginPost}Object.defineProperty(module.exports, "DELETE", { value: async () => new Response() });`,
      `${loginPost}exports.HEAD ??= async () => new Response();`,
      `${loginPost}module["exports"].POST ||= async () => new Response();`,
      `${loginPost}Reflect.set(exports, "OPTIONS", async () => new Response());`,
    ];
    for (const extension of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]) {
      const path = `login-fixture.${extension}`;
      expect(analyzeLoginRoute(path, loginPost), path).toEqual([]);
      for (const fixture of hostileForms) {
        expect(analyzeLoginRoute(path, fixture), `${path}:${fixture}`).not.toEqual([]);
      }
    }
  });

  it("keeps bearer verification private to the central auth module", () => {
    expect(authRuntimeExportViolations()).toEqual([]);
    expect(
      effectiveRuntimeModuleExports("lib/server/admin-auth.ts")
        .map((entry) => [entry.exported, entry.local] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ).toEqual([...allowedAdminAuthRuntimeExports.keys()].sort().map((name) => [name, name]));
    const authSourceText = readFileSync("lib/server/admin-auth.ts", "utf8");
    for (const hostileSuffix of [
      "export const verifierAlias = verifyAdminLoginCredential;",
      "export const minterFacade = { mint: createAdminLoginSession };",
      "export const signerArray = [sign];",
      "export const bearerGetter = { get verifier() { return verifyAdminBearerToken; } };",
      "export function signerFactory() { return sign; }",
      "export const boundSigner = sign.bind(null);",
      "export default { verifyAdminLoginCredential, createAdminLoginSession, sign, verifyAdminBearerToken };",
      "const defaultFacade = { sign }; export default defaultFacade;",
      "export { sign as signerAlias };",
      "Object.assign(adminCookieHeader, { claims: verifiedAdminLoginClaims, mint: createAdminLoginSession, signer: sign, verifyBearer: verifyAdminBearerToken });",
      "Object['assign'](adminCookieHeader, { signer: sign, bearerVerifier: verifyAdminBearerToken, claims: verifiedAdminLoginClaims, signerArray: [sign], signerGetter: { get value() { return sign; } }, signerFactory: () => sign, boundSigner: sign.bind(null) });",
      "Reflect['set'](adminCookieHeader, 'signer', sign);",
      "const assign = Object['assign']; assign(adminCookieHeader, { signer: sign });",
      "const { assign: mutate } = Object; mutate(adminCookieHeader, { signer: sign });",
      "Object.assign(Object(adminCookieHeader), { signer: sign });",
      "Object.assign(new Proxy(adminCookieHeader, {}), { signer: sign });",
      "const { value: destructuredCookieAlias } = { value: adminCookieHeader }; Object.assign(destructuredCookieAlias, { signer: sign });",
      "Object.defineProperty(adminCookieHeader, 'signer', { get() { return sign; } });",
      "Reflect.set(adminCookieHeader, 'claims', verifiedAdminLoginClaims);",
      "(adminCookieHeader as typeof adminCookieHeader & { signer?: unknown }).signer = sign;",
      "(adminCookieHeader as typeof adminCookieHeader & { signers?: unknown[] }).signers = [sign];",
      "(adminCookieHeader as typeof adminCookieHeader & { factory?: unknown }).factory = () => sign;",
      "namespace adminCookieHeader { export const claims = verifiedAdminLoginClaims; }",
      "const cookieAlias = adminCookieHeader; Object.assign(cookieAlias, { signer: sign });",
      "let assignedCookieAlias: unknown; assignedCookieAlias = adminCookieHeader; Reflect.set(assignedCookieAlias as object, 'claims', verifiedAdminLoginClaims);",
      "const cookieHolder = { cookie: adminCookieHeader }; Object.defineProperty(cookieHolder, 'claims', { value: verifiedAdminLoginClaims });",
      "Reflect.apply(Object.assign, null, [adminCookieHeader, { signer: sign }]);",
      "const apply = Reflect.apply; apply(Object.assign, null, [adminCookieHeader, { signer: sign }]);",
      "globalThis.Object.assign(adminCookieHeader, { signer: sign });",
      "Object.assign.bind(null)(adminCookieHeader, { signer: sign });",
      "Function.prototype.call.call(Object.assign, null, adminCookieHeader, { signer: sign });",
      "const globalObject = globalThis.Object; const boundAssign = globalObject.assign.bind(globalObject); boundAssign.call(null, adminCookieHeader, { signer: sign });",
      "const mutationHolder = { mutate: Object.assign }; mutationHolder.mutate(adminCookieHeader, { signer: sign });",
      "const G = globalThis; G.Object.assign(adminCookieHeader, { signer: sign });",
      "const { Object: O } = globalThis; O.assign(adminCookieHeader, { signer: sign });",
      "const O = Reflect.get(globalThis, 'Object') as ObjectConstructor; O.defineProperty(adminCookieHeader, 'signer', { value: sign });",
      "const box: { target?: typeof adminCookieHeader } = {}; box.target = adminCookieHeader; Object.assign(box.target, { signer: sign });",
      "const targets: Array<typeof adminCookieHeader> = []; targets.push(adminCookieHeader); Object.defineProperty(targets[0], 'signer', { value: sign });",
      "const box: Record<string, unknown> = {}; Object.defineProperty(box, 'target', { value: adminCookieHeader }); Reflect.set(box.target as object, 'signer', sign);",
      "const args: any[] = []; args.push(adminCookieHeader, { signer: sign }); Reflect.apply(Object.assign, null, args);",
      "const G = globalThis; const R = G.Reflect; const O = R.get(G, 'Object') as ObjectConstructor; O.assign(adminCookieHeader, { signer: sign });",
      "const { Object: { assign: mutate } } = globalThis; mutate(adminCookieHeader, { signer: sign });",
      "let O: ObjectConstructor; ({ Object: O } = globalThis); O.assign(adminCookieHeader, { signer: sign });",
      "const box: any = {}; box.target ??= adminCookieHeader; Object.assign(box.target, { signer: sign });",
      "const box: any = {}; box.target ||= adminCookieHeader; Reflect.set(box.target, 'signer', sign);",
      "const receivers = [globalThis.Object]; const O = receivers[0]!; O.assign(adminCookieHeader, { signer: sign });",
      "const receiverBox: any = {}; receiverBox.value ??= Reflect.get(globalThis, 'Object'); const O = receiverBox.value; O.assign(adminCookieHeader, { signer: sign });",
      "function objectBridge() { return globalThis.Object; } const O = objectBridge(); O.assign(adminCookieHeader, { signer: sign });",
      "function cookieBridge() { return adminCookieHeader; } Object.assign(cookieBridge(), { signer: sign });",
      "const objectBridge = () => globalThis.Object; const O = objectBridge(); O.assign(adminCookieHeader, { signer: sign });",
      "const objectBridge = { get() { return globalThis.Object; } }; objectBridge.get().assign(adminCookieHeader, { signer: sign });",
      "class ObjectBridge { static get() { return globalThis.Object; } } ObjectBridge.get().assign(adminCookieHeader, { signer: sign });",
      "function cookieBridge() { return adminCookieHeader; } Object.assign(cookieBridge(), { signer: sign });",
      "const cookieBridge = () => adminCookieHeader; Object.assign(cookieBridge(), { signer: sign });",
      "const cookieBridge = function () { return adminCookieHeader; }; Object.assign(cookieBridge(), { signer: sign });",
      "const cookieBridge = { get() { return adminCookieHeader; } }; Object.assign(cookieBridge.get(), { signer: sign });",
      "class CookieBridge { static getCookie() { return adminCookieHeader; } } Object.assign(CookieBridge.getCookie(), { signer: sign });",
      "class CookieBridge { static get cookie() { return adminCookieHeader; } } Object.assign(CookieBridge.cookie, { signer: sign });",
      "class CookieBridge { getCookie() { return adminCookieHeader; } } const bridge = new CookieBridge(); Object.assign(bridge.getCookie(), { signer: sign });",
    ]) {
      expect(authRuntimeExportViolations(`${authSourceText}\n${hostileSuffix}`), hostileSuffix).not.toEqual([]);
    }
    expect(authRuntimeExportViolations(`${authSourceText}\nObject.assign({}, { harmless: true });`)).toEqual([]);
    expect(authRuntimeExportViolations(`${authSourceText}\nObject.assign({}, { cookie: adminCookieHeader });`)).toEqual(
      [],
    );
    expect(
      authRuntimeExportViolations(`${authSourceText}\nconst G = globalThis; G.Object.assign({}, { harmless: true });`),
    ).toEqual([]);
    expect(
      authRuntimeExportViolations(
        `${authSourceText}\nconst args: any[] = []; args.push({}, { harmless: true }); Reflect.apply(Object.assign, null, args);`,
      ),
    ).toEqual([]);
    const escapedCookieName = authSourceText.replace(
      'export const adminCookieName = "oriental_admin";',
      "export const adminCookieName = ({ claims: verifiedAdminLoginClaims } as unknown) as string;",
    );
    expect(authRuntimeExportViolations(escapedCookieName)).toContain(
      "allowed auth export adminCookieName cannot expose private authority or claims state",
    );
    const escapedWeakMapRead = authSourceText.replace(
      "export function clearAdminCookieHeader() {",
      "export function clearAdminCookieHeader() { return verifiedAdminLoginClaims.get({} as AdminLoginSuccess); }\nfunction originalClearAdminCookieHeader() {",
    );
    expect(authRuntimeExportViolations(escapedWeakMapRead)).toContain(
      "allowed auth export clearAdminCookieHeader cannot return private authority or claims state",
    );
    for (const hostileBody of [
      "const [leakedSigner] = [sign]; return leakedSigner as unknown as string;",
      "const { value: leakedClaims } = { value: verifiedAdminLoginClaims }; return leakedClaims as unknown as string;",
      "const holder = { signer: sign }; const leaked = holder.signer; return leaked as unknown as string;",
      "const leakedGetter = { get value() { return verifyAdminBearerToken; } }; return leakedGetter as unknown as string;",
      "const leakedFactory = () => sign; return leakedFactory as unknown as string;",
      "const leakedBound = sign.bind(null); return leakedBound as unknown as string;",
      "const holder: { signer?: unknown } = {}; Object.assign(holder, { signer: sign }); return holder as unknown as string;",
      "return (Date.now() > 0 && sign) as unknown as string;",
      "return (false || sign) as unknown as string;",
      "return (undefined ?? sign) as unknown as string;",
      "return (void 0, sign) as unknown as string;",
      "const result = { values: [] as unknown[] }; result.values.push(sign); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; const { values } = result; values.push(sign.bind(null)); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; const [values] = [result.values]; values.push(verifyAdminBearerToken); return result as unknown as string;",
      "const result = new Map<string, unknown>(); result.set('signer', sign); return result as unknown as string;",
      "const result = new Set<unknown>(); result.add(sign.bind(null)); return result as unknown as string;",
      "const result = {}; Object.defineProperty(result, 'signer', { get() { return sign; } }); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; Array.prototype.push.call(result.values, sign); return result as unknown as string;",
      "const result = new Map<string, unknown>(); Map.prototype.set.call(result, 'signer', sign); return result as unknown as string;",
      "const result = new Set<unknown>(); Set.prototype.add.apply(result, [verifyAdminBearerToken]); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; const args: any[] = []; args.push(result, 'signer', sign); Reflect.apply(Reflect.set, null, args); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; Function.prototype.call.call(Array.prototype.push, result.values, sign); return result as unknown as string;",
      "const result = new Map<string, unknown>(); Function.prototype.call.call(Map.prototype.set, result, 'signer', sign); return result as unknown as string;",
      "const result = new Set<unknown>(); Function.prototype.apply.call(Set.prototype.add, result, [sign]); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; Array.prototype.push.bind(result.values)(sign); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; const push = Array.prototype.push.bind(result.values); push(sign); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; Function.prototype.call.call(Function.prototype.call, Array.prototype.push, result.values, sign); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; Reflect.apply(Function.prototype.call, Array.prototype.push, [result.values, sign]); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; const args: any[] = []; args[0] = result; args[1] = 'signer'; args[2] = sign; Reflect.apply(Reflect.set, null, args); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; const args = ([] as any[]).concat(result, 'signer', sign); Reflect.apply(Reflect.set, null, args); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; const args = [result, 'signer', ...[sign]]; Reflect.apply(Reflect.set, null, args); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; function target() { return result.values; } Array.prototype.push.call(target(), sign); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; const target = () => result.values; Array.prototype.push.call(target(), sign); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; const target = { get() { return result.values; } }; Array.prototype.push.call(target.get(), sign); return result as unknown as string;",
      "const result = { values: [] as unknown[] }; class Target { static get() { return result.values; } } Array.prototype.push.call(Target.get(), sign); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; function args() { return [result, 'signer', sign]; } Reflect.apply(Reflect.set, null, args()); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; const args = () => [result, 'signer', sign]; Reflect.apply(Reflect.set, null, args()); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; const args = { get() { return [result, 'signer', sign]; } }; Reflect.apply(Reflect.set, null, args.get()); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; class Args { static get() { return [result, 'signer', sign]; } } Reflect.apply(Reflect.set, null, Args.get()); return result as unknown as string;",
    ]) {
      const escapedLocalAlias = authSourceText.replace(
        "export function clearAdminCookieHeader() {",
        `export function clearAdminCookieHeader() { ${hostileBody} }\nfunction originalClearAdminCookieHeader() {`,
      );
      expect(authRuntimeExportViolations(escapedLocalAlias), hostileBody).toContain(
        "allowed auth export clearAdminCookieHeader cannot return private authority or claims state",
      );
    }
    const safeScalarBody = authSourceText.replace(
      "export function clearAdminCookieHeader() {",
      "export function clearAdminCookieHeader() { return (true && 'safe') as string; }\nfunction originalClearAdminCookieHeader() {",
    );
    expect(authRuntimeExportViolations(safeScalarBody)).not.toContain(
      "allowed auth export clearAdminCookieHeader cannot return private authority or claims state",
    );
    const safePrototypeMutationBody = authSourceText.replace(
      "export function clearAdminCookieHeader() {",
      "export function clearAdminCookieHeader() { const result = { values: [] as string[] }; Array.prototype.push.call(result.values, 'safe'); return result as unknown as string; }\nfunction originalClearAdminCookieHeader() {",
    );
    expect(authRuntimeExportViolations(safePrototypeMutationBody)).not.toContain(
      "allowed auth export clearAdminCookieHeader cannot return private authority or claims state",
    );
    for (const safeBody of [
      "const result = { values: [] as string[] }; Function.prototype.call.call(Array.prototype.push, result.values, 'safe'); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; const args: any[] = []; args[0] = result; args[1] = 'value'; args[2] = 'safe'; Reflect.apply(Reflect.set, null, args); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; const args = ([] as any[]).concat(result, 'value', 'safe'); Reflect.apply(Reflect.set, null, args); return result as unknown as string;",
      "const result = { values: [] as string[] }; function target() { return result.values; } Array.prototype.push.call(target(), 'safe'); return result as unknown as string;",
      "const result = { values: [] as string[] }; const target = () => result.values; Array.prototype.push.call(target(), 'safe'); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; function args() { return [result, 'value', 'safe']; } Reflect.apply(Reflect.set, null, args()); return result as unknown as string;",
      "const result: Record<string, unknown> = {}; class Args { static get() { return [result, 'value', 'safe']; } } Reflect.apply(Reflect.set, null, Args.get()); return result as unknown as string;",
    ]) {
      const safeMutationBody = authSourceText.replace(
        "export function clearAdminCookieHeader() {",
        `export function clearAdminCookieHeader() { ${safeBody} }\nfunction originalClearAdminCookieHeader() {`,
      );
      expect(authRuntimeExportViolations(safeMutationBody), safeBody).not.toContain(
        "allowed auth export clearAdminCookieHeader cannot return private authority or claims state",
      );
    }
    const authSource = sourceFile("lib/server/admin-auth.ts", authSourceText);
    const bearerVerifier = authSource.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "verifyAdminBearerToken",
    );

    expect(bearerVerifier).toBeDefined();
    expect(bearerVerifier?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false).toBe(
      false,
    );
    for (const path of productionPaths.filter((candidate) => candidate !== "lib/server/admin-auth.ts")) {
      expect(callExpressionsNamed(sourceFile(path), "verifyAdminBearerToken"), path).toHaveLength(0);
    }
  }, 60_000);
});
