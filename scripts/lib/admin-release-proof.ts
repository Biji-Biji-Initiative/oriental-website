const canonicalAdminOrigins = new Set(["https://staging.oriental.mereka.io", "https://oriental.mereka.io"]);

export function validatedAdminReleaseOrigin(value: string) {
  const target = new URL(value);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    !canonicalAdminOrigins.has(target.origin)
  ) {
    throw new Error("Admin release proof target must be an exact canonical HTTPS Oriental origin");
  }
  return target.origin;
}
