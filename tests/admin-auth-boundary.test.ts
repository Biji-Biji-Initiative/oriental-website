import { globSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const adminLoginRoute = "app/api/admin/login/route.ts";
const adminAuthPath = resolve("lib/server/admin-auth.ts");
const adminRoutePath = resolve("lib/server/admin-route.ts");
const sourceExtensions = "{ts,tsx,js,jsx,mjs,cjs,mts,cts}";
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
const adminRoutePaths = globSync([
  `app/api/admin/**/route.${sourceExtensions}`,
  `pages/api/admin/**/*.${sourceExtensions}`,
]).sort();
const httpMethodNames = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type HttpMethod = (typeof httpMethodNames)[number];
const httpMethods = new Set<string>(httpMethodNames);
const protectedLoginSymbols = new Set(["verifyAdminLoginCredential", "createAdminLoginSession"]);
const parsedTsConfig = ts.parseJsonConfigFileContent(
  ts.readConfigFile("tsconfig.json", ts.sys.readFile).config,
  ts.sys,
  process.cwd(),
);
const productionProgram = ts.createProgram(parsedTsConfig.fileNames, parsedTsConfig.options);
const productionChecker = productionProgram.getTypeChecker();

function isProductionPath(path: string) {
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

const productionPaths = [
  ...new Set([
    ...parsedTsConfig.fileNames.map((path) => relative(process.cwd(), path)),
    ...globSync(`**/*.${sourceExtensions}`),
  ]),
]
  .filter(isProductionPath)
  .sort();

function sourceFile(path: string, sourceText = readFileSync(path, "utf8")) {
  const extension = path.slice(path.lastIndexOf("."));
  const scriptKind = extension === ".tsx" || extension === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
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
  let commonJs = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && (node.text === "exports" || node.text === "module")) commonJs = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (commonJs) errors.push("route modules cannot use CommonJS export mechanisms");
  return errors;
}

function effectiveModuleExports(path: string) {
  const source = productionProgram.getSourceFile(resolve(path));
  if (!source) throw new Error(`TypeScript program omitted production module ${path}`);
  const symbol = productionChecker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`TypeScript checker could not resolve production module ${path}`);
  return productionChecker.getExportsOfModule(symbol).map((entry) => entry.name);
}

function effectiveModuleExportTargets(path: string) {
  const source = productionProgram.getSourceFile(resolve(path));
  if (!source) throw new Error(`TypeScript program omitted production module ${path}`);
  const symbol = productionChecker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`TypeScript checker could not resolve production module ${path}`);
  return productionChecker.getExportsOfModule(symbol).map((entry) => {
    const target = (entry.flags & ts.SymbolFlags.Alias) !== 0 ? productionChecker.getAliasedSymbol(entry) : entry;
    return { exported: entry.name, local: target.name };
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
  const importAliases = new Map<string, string>();
  const namespaceAliases = new Set<string>();
  const imports: string[] = [];
  const calls: string[] = [];
  const forbiddenAccesses: string[] = [];

  for (const statement of source.statements) {
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
      resolvesToModule(statement.moduleReference.expression.text, path, adminAuthPath)
    ) {
      forbiddenAccesses.push("import equals");
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const imported = importAliases.get(node.expression.text);
        if (imported) calls.push(imported);
        if (
          node.expression.text === "require" &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0]) &&
          resolvesToModule(node.arguments[0].text, path, adminAuthPath)
        ) {
          forbiddenAccesses.push("require");
        }
      } else if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        resolvesToModule(node.arguments[0].text, path, adminAuthPath)
      ) {
        forbiddenAccesses.push("dynamic import");
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
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { calls, forbiddenAccesses, imports };
}

function resolvedProtectedSymbolCalls() {
  const calls: Array<{ path: string; symbol: string }> = [];
  for (const path of productionPaths) {
    const source = productionProgram.getSourceFile(resolve(path));
    if (!source) continue;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const symbolNode = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
        let symbol = productionChecker.getSymbolAtLocation(symbolNode);
        if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = productionChecker.getAliasedSymbol(symbol);
        if (
          symbol &&
          protectedLoginSymbols.has(symbol.name) &&
          symbol.declarations?.some((declaration) => resolve(declaration.getSourceFile().fileName) === adminAuthPath)
        ) {
          calls.push({ path, symbol: symbol.name });
        }
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
  }, 15_000);

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
      'void import("../../../../lib/server/admin-auth");',
      'export { createAdminLoginSession } from "../../../../lib/server/admin-auth";',
      'import auth = require("../../../../lib/server/admin-auth");',
    ]) {
      expect(protectedSymbolAuthority(relativePath, sourceText).forbiddenAccesses, sourceText).not.toEqual([]);
    }
  });

  it("pins every exact admin path and method to its one permission", () => {
    expect(adminRoutePaths).toEqual(canonicalAdminRoutes);
    for (const [path, permissions] of Object.entries(canonicalAdminRoutePermissions)) {
      expect(
        effectiveModuleExports(path)
          .filter((name) => httpMethods.has(name))
          .sort(),
        `${path} effective exports`,
      ).toEqual(Object.keys(permissions).sort());
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
    expect(isProductionPath(path)).toBe(true);
    const bridge = protectedSymbolAuthority(
      path,
      'import { createAdminLoginSession as mint } from "../lib/server/admin-auth"; mint({} as never, 0);',
    );
    expect(bridge.imports).toEqual(["createAdminLoginSession"]);
    expect(bridge.calls).toEqual(["createAdminLoginSession"]);
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
    const effectiveAuthExports = effectiveModuleExports("lib/server/admin-auth.ts");
    const effectiveAuthTargets = effectiveModuleExportTargets("lib/server/admin-auth.ts");
    expect(effectiveAuthExports).not.toContain("verifyAdminBearerToken");
    expect(effectiveAuthExports).not.toContain("sign");
    expect(effectiveAuthTargets.filter((entry) => ["verifyAdminBearerToken", "sign"].includes(entry.local))).toEqual(
      [],
    );
    const authSource = sourceFile("lib/server/admin-auth.ts");
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
