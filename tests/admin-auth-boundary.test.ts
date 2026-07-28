import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const adminAuthModule = "@/lib/server/admin-auth";
const adminLoginRoute = "app/api/admin/login/route.ts";
const adminRoutePaths = globSync("app/api/admin/**/route.ts").sort();
const productionPaths = globSync([
  "app/**/*.ts",
  "app/**/*.tsx",
  "components/**/*.ts",
  "components/**/*.tsx",
  "lib/**/*.ts",
  "lib/**/*.tsx",
]).sort();
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

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

function awaitExpressions(node: ts.Node) {
  const awaits: ts.AwaitExpression[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isAwaitExpression(child)) awaits.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return awaits;
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

describe("admin authentication production boundary", () => {
  it("has one exact production import and invocation of the login-only password verifier", () => {
    const importSites: string[] = [];
    const callSites: string[] = [];

    for (const path of productionPaths) {
      const source = sourceFile(path);
      const imports = importedNames(source, adminAuthModule).filter(
        ({ imported }) => imported === "verifyAdminLoginCredential",
      );
      importSites.push(...imports.map(() => path));
      callSites.push(...callExpressionsNamed(source, "verifyAdminLoginCredential").map(() => path));
    }

    expect(importSites).toEqual([adminLoginRoute]);
    expect(callSites).toEqual([adminLoginRoute]);
  });

  it("owns exactly twelve admin route modules and authorizes every non-login handler before async effects", () => {
    expect(adminRoutePaths).toHaveLength(12);
    expect(adminRoutePaths).toContain(adminLoginRoute);

    for (const path of adminRoutePaths.filter((candidate) => candidate !== adminLoginRoute)) {
      const source = sourceFile(path);
      const imports = importedNames(source, adminAuthModule);
      expect(
        imports.filter(({ imported, local }) => imported === "verifyAdminPermission" && local === imported),
        path,
      ).toHaveLength(1);
      expect(
        imports.every(({ imported }) =>
          ["adminAuthFailureStatus", "clearAdminCookieHeader", "verifyAdminPermission"].includes(imported),
        ),
        path,
      ).toBe(true);

      const handlers = exportedHttpHandlers(source);
      expect(handlers.length, path).toBeGreaterThan(0);
      for (const handler of handlers) {
        const body = handler.body;
        if (!body) throw new Error(`${path}:${handler.name?.text} has no handler body`);
        const authorizationCalls = callExpressionsNamed(body, "verifyAdminPermission");
        expect(authorizationCalls, `${path}:${handler.name?.text}`).toHaveLength(1);
        const authorizationCall = authorizationCalls[0];
        if (!authorizationCall) throw new Error(`${path}:${handler.name?.text} has no authorization call`);
        const firstAwait = awaitExpressions(body).sort((left, right) => left.pos - right.pos)[0];
        if (firstAwait) {
          expect(
            authorizationCall.getStart(source),
            `${path}:${handler.name?.text} must authorize before its first await`,
          ).toBeLessThan(firstAwait.getStart(source));
        }
      }
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
