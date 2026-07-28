import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ADMIN_PERMISSIONS } from "@/lib/admin-permissions";

const adminAuthModule = "@/lib/server/admin-auth";
const adminRouteModule = "@/lib/server/admin-route";
const adminLoginRoute = "app/api/admin/login/route.ts";
const canonicalAdminRoutes = [
  "app/api/admin/evals/route.ts",
  "app/api/admin/leads/[leadId]/route.ts",
  "app/api/admin/leads/archive/route.ts",
  "app/api/admin/leads/bulk/route.ts",
  adminLoginRoute,
  "app/api/admin/logout/route.ts",
  "app/api/admin/metrics/route.ts",
  "app/api/admin/privacy/route.ts",
  "app/api/admin/retention/route.ts",
  "app/api/admin/review/route.ts",
  "app/api/admin/sla-check/route.ts",
  "app/api/admin/voice-sessions/[reviewId]/route.ts",
].sort();
const adminRoutePaths = globSync("app/api/admin/**/route.{ts,tsx,js,jsx,mjs,cjs,mts,cts}").sort();
const productionPaths = globSync([
  "app/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}",
  "components/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}",
  "lib/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}",
]).sort();
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const protectedLoginSymbols = new Set(["verifyAdminLoginCredential", "createAdminLoginSession"]);
const permissionNames = new Set<string>(ADMIN_PERMISSIONS);

function sourceFile(path: string) {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function importedNames(source: ts.SourceFile, moduleName: string) {
  return source.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      return [];
    }
    return statement.importClause.namedBindings.elements.map((element) => ({
      imported: element.propertyName?.text ?? element.name.text,
      local: element.name.text,
    }));
  });
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

function exportedHttpHandlers(source: ts.SourceFile) {
  return source.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      Boolean(statement.body) &&
      Boolean(statement.name && httpMethods.has(statement.name.text)) &&
      Boolean(statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)),
  );
}

function analyzeProtectedRoute(path: string, sourceText = readFileSync(path, "utf8")) {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseDiagnostics =
    (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const errors = parseDiagnostics.map((diagnostic) => `parse:${diagnostic.code}`);
  const wrapperAliases = new Set<string>();
  let handlerCount = 0;

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === adminRouteModule
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) {
        errors.push("admin route wrapper must use a named import");
        continue;
      }
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === "withAdminPermission") {
          wrapperAliases.add(element.name.text);
        }
      }
    }

    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      httpMethods.has(statement.name.text) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      handlerCount += 1;
      errors.push(`${statement.name.text} must be a directly wrapped exported const`);
    }

    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !httpMethods.has(declaration.name.text)) continue;
        handlerCount += 1;
        const method = declaration.name.text;
        const initializer = declaration.initializer;
        if (
          !initializer ||
          !ts.isCallExpression(initializer) ||
          !ts.isIdentifier(initializer.expression) ||
          !wrapperAliases.has(initializer.expression.text)
        ) {
          errors.push(`${method} must call the imported wrapper directly`);
          continue;
        }
        if (initializer.arguments.length !== 2) errors.push(`${method} wrapper must have exactly two arguments`);
        const permission = initializer.arguments[0];
        if (!permission || !ts.isStringLiteral(permission) || !permissionNames.has(permission.text)) {
          errors.push(`${method} must declare one canonical literal permission`);
        }
        const handler = initializer.arguments[1];
        if (!handler || (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler))) {
          errors.push(`${method} must supply an inline protected callback`);
        }
      }
    }

    if (ts.isExportDeclaration(statement)) {
      for (const element of statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements
        : []) {
        const exported = element.name.text;
        const local = element.propertyName?.text ?? exported;
        if (httpMethods.has(exported) || httpMethods.has(local)) {
          handlerCount += 1;
          errors.push(`${exported} must not be exported through an alias or re-export`);
        }
      }
    }
  }

  for (const method of httpMethods) {
    if (
      new RegExp(`(?:module\\.exports|exports)\\s*(?:\\.\\s*${method}|\\[\\s*["']${method}["']\\s*\\])`).test(
        sourceText,
      )
    ) {
      errors.push(`${method} must not use a CommonJS export`);
    }
  }
  if (handlerCount === 0) errors.push("route must export at least one HTTP handler");
  if (wrapperAliases.size !== 1) errors.push("route must import exactly one structural wrapper binding");
  return errors;
}

function protectedSymbolAuthority(path: string) {
  const source = sourceFile(path);
  const imports = importedNames(source, adminAuthModule).filter(({ imported }) => protectedLoginSymbols.has(imported));
  const importAliases = new Map(imports.map(({ imported, local }) => [local, imported]));
  const calls: string[] = [];
  const forbiddenAccesses: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const imported = importAliases.get(node.expression.text);
        if (imported) calls.push(imported);
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument) && argument.text === adminAuthModule) {
          forbiddenAccesses.push("dynamic import");
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) && protectedLoginSymbols.has(node.name.text)) {
      forbiddenAccesses.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === adminAuthModule &&
      (statement.importClause?.name ||
        (statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings)))
    ) {
      forbiddenAccesses.push("default or namespace import");
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === adminAuthModule
    ) {
      forbiddenAccesses.push("re-export");
    }
  }
  return { calls, forbiddenAccesses, imports };
}

describe("admin authentication production boundary", () => {
  it("gives the login route sole symbol-level authority to verify passwords and mint sessions", () => {
    const authority = productionPaths.map((path) => ({ path, ...protectedSymbolAuthority(path) }));
    expect(
      authority.flatMap(({ path, forbiddenAccesses }) => forbiddenAccesses.map((kind) => `${path}:${kind}`)),
    ).toEqual([]);
    for (const symbol of protectedLoginSymbols) {
      expect(
        authority.flatMap(({ path, imports }) => imports.filter(({ imported }) => imported === symbol).map(() => path)),
        `${symbol} import authority`,
      ).toEqual([adminLoginRoute]);
      expect(
        authority.flatMap(({ path, calls }) => calls.filter((called) => called === symbol).map(() => path)),
        `${symbol} call authority`,
      ).toEqual([adminLoginRoute]);
    }

    const authSource = readFileSync("lib/server/admin-auth.ts", "utf8");
    expect(authSource).not.toMatch(/export\s+(?:async\s+)?function\s+createAdminSessionCookie\b/);
  });

  it("pins every admin route and structurally wraps every non-login HTTP export", () => {
    expect(adminRoutePaths).toEqual(canonicalAdminRoutes);
    for (const path of canonicalAdminRoutes.filter((candidate) => candidate !== adminLoginRoute)) {
      expect(analyzeProtectedRoute(path), path).toEqual([]);
    }

    const loginSource = sourceFile(adminLoginRoute);
    expect(exportedHttpHandlers(loginSource).map((handler) => handler.name?.text)).toEqual(["POST"]);
  });

  it("rejects hostile handler shapes while accepting a direct wrapper alias", () => {
    const prelude = 'import { withAdminPermission as guard } from "@/lib/server/admin-route";\n';
    expect(
      analyzeProtectedRoute(
        "fixture.ts",
        `${prelude}export const GET = guard("dashboard.read", async () => new Response());`,
      ),
    ).toEqual([]);
    for (const fixture of [
      `${prelude}export async function GET() { return new Response(); }`,
      `${prelude}export const HEAD = async () => new Response();`,
      `${prelude}const hidden = guard("dashboard.read", async () => new Response()); export { hidden as GET };`,
      `${prelude}export const OPTIONS = verifyAdminPermission(new Request("https://x"), "dashboard.read");`,
      `${prelude}export const POST = guard(variablePermission, async () => new Response());`,
      `${prelude}export const PATCH = guard("leads.update", namedHandler);`,
      `${prelude}module.exports.GET = async () => new Response();`,
    ]) {
      expect(analyzeProtectedRoute("fixture.ts", fixture), fixture).not.toEqual([]);
    }
  });

  it("keeps bearer verification private to the central auth module", () => {
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
