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
  bindings: ReadonlyMap<string, ts.Expression>,
): AuthBuiltinReceiver | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return receiverAliases.get(unwrapped.text) ?? null;
  if (!ts.isPropertyAccessExpression(unwrapped) && !ts.isElementAccessExpression(unwrapped)) return null;
  const receiver = unwrapExpression(unwrapped.expression);
  const member = ts.isPropertyAccessExpression(unwrapped)
    ? unwrapped.name.text
    : unwrapped.argumentExpression
      ? constantStringExpression(unwrapped.argumentExpression, bindings)
      : null;
  return ts.isIdentifier(receiver) && receiver.text === "globalThis" && (member === "Object" || member === "Reflect")
    ? member
    : null;
}

function directAuthMutationPrimitive(
  expression: ts.Expression,
  receiverAliases: ReadonlyMap<string, AuthBuiltinReceiver>,
  bindings: ReadonlyMap<string, ts.Expression>,
): AuthMutationPrimitive | null {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(unwrapped) && !ts.isElementAccessExpression(unwrapped)) return null;
  const builtin = authBuiltinReceiver(unwrapped.expression, receiverAliases, bindings);
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

function mutationPrimitiveAliases(source: ts.SourceFile, bindings: ReadonlyMap<string, ts.Expression>) {
  const receiverAliases = new Map<string, AuthBuiltinReceiver>([
    ["Object", "Object"],
    ["Reflect", "Reflect"],
  ]);
  const aliases = new Map<string, AuthMutationPrimitive>();
  const receiverFor = (expression: ts.Expression): AuthBuiltinReceiver | null =>
    authBuiltinReceiver(expression, receiverAliases, bindings);
  const primitiveFor = (expression: ts.Expression): AuthMutationPrimitive | null => {
    const direct = directAuthMutationPrimitive(expression, receiverAliases, bindings);
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
        if (ts.isIdentifier(node.name)) {
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
          if (ts.isObjectBindingPattern(node.name) && receiver) {
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
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
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
): PrivateAuthTaint | null {
  const unwrapped = unwrapExpression(expression);
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
      protectedAuthTaint(unwrapped.left, privateAliases, taintedFactories) ??
      protectedAuthTaint(unwrapped.right, privateAliases, taintedFactories)
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
    return expressions.some((candidate) => protectedAuthTaint(candidate, privateAliases, taintedFactories))
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
          .map((argument) => protectedAuthTaint(argument, privateAliases, taintedFactories))
          .find((taint): taint is PrivateAuthTaint => Boolean(taint)) ?? null
      );
    }
    return (
      unwrapped.arguments
        .map((argument) => protectedAuthTaint(argument, privateAliases, taintedFactories))
        .find((taint): taint is PrivateAuthTaint => Boolean(taint)) ?? null
    );
  }
  if (ts.isNewExpression(unwrapped) && ts.isIdentifier(unwrapped.expression) && unwrapped.expression.text === "Proxy") {
    const target = unwrapped.arguments?.[0];
    return target ? protectedAuthTaint(target, privateAliases, taintedFactories) : null;
  }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.some(
      (element) => ts.isExpression(element) && protectedAuthTaint(element, privateAliases, taintedFactories),
    )
      ? "container"
      : null;
  }
  if (ts.isObjectLiteralExpression(unwrapped)) {
    for (const property of unwrapped.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        protectedAuthTaint(property.initializer, privateAliases, taintedFactories)
      ) {
        return "container";
      }
      if (
        ts.isShorthandPropertyAssignment(property) &&
        protectedAuthTaint(property.name, privateAliases, taintedFactories)
      ) {
        return "container";
      }
      if (
        ts.isSpreadAssignment(property) &&
        protectedAuthTaint(property.expression, privateAliases, taintedFactories)
      ) {
        return "container";
      }
      if (
        (ts.isMethodDeclaration(property) ||
          ts.isGetAccessorDeclaration(property) ||
          ts.isSetAccessorDeclaration(property)) &&
        property.body &&
        nodeContainsProtectedAuthTaint(property.body, privateAliases, taintedFactories)
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
      taint = protectedAuthTaint(child, privateAliases, taintedFactories);
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
) {
  let tainted = false;
  const visit = (child: ts.Node) => {
    if (tainted) return;
    if (ts.isExpression(child) && protectedAuthTaint(child, privateAliases, taintedFactories)) {
      tainted = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return tainted;
}

function containerReferenceRoots(expression: ts.Expression): Set<string> {
  const unwrapped = unwrapExpression(expression);
  const root = expressionRootName(unwrapped);
  if (root) return new Set([root]);
  const roots = new Set<string>();
  const collect = (candidate: ts.Expression) => {
    for (const name of containerReferenceRoots(candidate)) roots.add(name);
  };
  if (ts.isArrayLiteralExpression(unwrapped)) {
    for (const element of unwrapped.elements) if (ts.isExpression(element)) collect(element);
  } else if (ts.isObjectLiteralExpression(unwrapped)) {
    for (const property of unwrapped.properties) {
      if (ts.isPropertyAssignment(property)) collect(property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) roots.add(property.name.text);
      else if (ts.isSpreadAssignment(property)) collect(property.expression);
    }
  }
  return roots;
}

function expressionEscapesProtectedAuthValue(
  expression: ts.Expression,
  privateAliases: ReadonlyMap<string, PrivateAuthTaint>,
  taintedFactories: ReadonlySet<string>,
) {
  return protectedAuthTaint(expression, privateAliases, taintedFactories) !== null;
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
  const mutationAnalysis = mutationPrimitiveAliases(source, constantBindings);
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
  const visitTaintAliases = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const roots = containerReferenceRoots(node.initializer);
      for (const name of bindingNames(node.name)) {
        for (const root of roots) linkTaintAliases(name, root);
      }
    }
    ts.forEachChild(node, visitTaintAliases);
  };
  visitTaintAliases(source);
  let changed = true;
  while (changed) {
    changed = false;
    const taintOf = (expression: ts.Expression) => protectedAuthTaint(expression, privateAliases, taintedFactories);
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
          const callee = unwrapExpression(node.expression);
          const member =
            ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
              ? ts.isPropertyAccessExpression(callee)
                ? callee.name.text
                : callee.argumentExpression
                  ? constantStringExpression(callee.argumentExpression, constantBindings)
                  : null
              : null;
          const receiverRoot =
            ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
              ? expressionRootName(callee.expression)
              : null;
          const receiverMutationMethods = new Set(["add", "copyWithin", "fill", "push", "set", "splice", "unshift"]);
          if (
            member &&
            receiverMutationMethods.has(member) &&
            receiverRoot &&
            !privateAliases.has(receiverRoot) &&
            receiverRoot !== "Object" &&
            receiverRoot !== "Reflect" &&
            receiverRoot !== "globalThis"
          ) {
            recordTaint(receiverRoot, "container");
          }
          for (const { target } of mutationAnalysis.mutationTargets(node)) {
            for (const root of containerReferenceRoots(target)) {
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
    const visitAlias = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        containsIdentifierFrom(node.initializer, mutableAuthExportAliases)
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
        ts.isIdentifier(node.left) &&
        containsIdentifierFrom(node.right, mutableAuthExportAliases) &&
        !mutableAuthExportAliases.has(node.left.text)
      ) {
        mutableAuthExportAliases.add(node.left.text);
        changed = true;
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
          expressionEscapesProtectedAuthValue(expression, privateAliases, taintedFactories),
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
          expressionEscapesProtectedAuthValue(declaration.initializer, privateAliases, taintedFactories)
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
        if (containsIdentifierFrom(target, mutableAuthExportAliases)) {
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
      if (member === "getBuiltinModule") forbiddenAccesses.push("process.getBuiltinModule reference");
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
      !ts.isImportSpecifier(node.parent)
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
    ]) {
      expect(protectedSymbolAuthority(relativePath, sourceText).forbiddenAccesses, sourceText).not.toEqual([]);
    }
    expect(
      protectedSymbolAuthority(relativePath, 'import * as nodePath from "node:path"; void nodePath;').forbiddenAccesses,
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
    ]) {
      expect(authRuntimeExportViolations(`${authSourceText}\n${hostileSuffix}`), hostileSuffix).not.toEqual([]);
    }
    expect(authRuntimeExportViolations(`${authSourceText}\nObject.assign({}, { harmless: true });`)).toEqual([]);
    expect(authRuntimeExportViolations(`${authSourceText}\nObject.assign({}, { cookie: adminCookieHeader });`)).toEqual(
      [],
    );
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
  });
});
