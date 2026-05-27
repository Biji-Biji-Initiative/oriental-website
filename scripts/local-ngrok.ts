import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_PROJECT_ID = "6bfac905-9bb1-449e-8be8-f25f9634802b";
const DEFAULT_SECRET_PATH = "/deploy/oriental-website";
const DEFAULT_ENV = "prod";
const DEFAULT_PORT = 3000;

type SecretRecord = {
  key?: string;
  secretKey?: string;
  value?: string;
  secretValue?: string;
};

type Options = {
  check: boolean;
  env: string;
  path: string;
  port: number;
  projectId: string;
  useDomain: boolean;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const infisical = getInfisicalEnv();
  const token = loginInfisical(infisical);
  const secrets = [
    ...exportSecrets(infisical, token, options.env, options.path, options.projectId),
    ...exportSecrets(infisical, token, options.env, "/", options.projectId, true),
  ];
  const authtoken = getSecret(secrets, ["NGROK_AUTH_TOKEN", "NGROK_AUTHTOKEN"]);
  const domain = options.useDomain ? getSecret(secrets, ["NGROK_DOMAIN"])?.value : undefined;

  if (!authtoken?.value) {
    throw new Error("Missing NGROK_AUTHTOKEN or NGROK_AUTH_TOKEN in Infisical.");
  }

  if (options.check) {
    console.log(
      [
        "ngrok_config=ok",
        `env=${options.env}`,
        `path=${options.path}`,
        `port=${options.port}`,
        `token=${authtoken.name}`,
        `domain=${domain ? normalizeUrl(domain) : "random"}`,
      ].join(" "),
    );
    return;
  }

  await warnIfLocalServerMissing(options.port);
  startNgrok({ authtoken: authtoken.value, domain, port: options.port });
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    check: false,
    env: process.env.INFISICAL_ENV ?? DEFAULT_ENV,
    path: process.env.INFISICAL_SECRET_PATH ?? DEFAULT_SECRET_PATH,
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    projectId: process.env.INFISICAL_PROJECT_ID ?? DEFAULT_PROJECT_ID,
    useDomain: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") options.check = true;
    if (arg === "--no-domain") options.useDomain = false;
    if (arg === "--env") options.env = readValue(args, ++index, arg);
    if (arg === "--path") options.path = readValue(args, ++index, arg);
    if (arg === "--port") options.port = Number(readValue(args, ++index, arg));
    if (arg === "--project-id") options.projectId = readValue(args, ++index, arg);
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid --port value: ${options.port}`);
  }

  return options;
}

function readValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function getInfisicalEnv() {
  const filePath = join(homedir(), ".config/infisical/universal-auth.env");
  const fileEnv = existsSync(filePath) ? parseDotenv(readFileSync(filePath, "utf8")) : {};
  return {
    apiUrl: process.env.INFISICAL_API_URL ?? fileEnv.INFISICAL_API_URL ?? "https://secrets.mereka.io/api",
    clientId: process.env.INFISICAL_UA_CLIENT_ID ?? fileEnv.INFISICAL_UA_CLIENT_ID,
    clientSecret: process.env.INFISICAL_UA_CLIENT_SECRET ?? fileEnv.INFISICAL_UA_CLIENT_SECRET,
  };
}

function parseDotenv(contents: string) {
  return Object.fromEntries(
    contents
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), stripQuotes(line.slice(index + 1))];
      }),
  );
}

function stripQuotes(value: string) {
  return value.replace(/^['"]|['"]$/g, "");
}

function loginInfisical(infisical: ReturnType<typeof getInfisicalEnv>) {
  if (!infisical.clientId || !infisical.clientSecret) {
    throw new Error("Missing Infisical Universal Auth credentials.");
  }
  const result = spawnSync(
    "infisical",
    [
      "login",
      "--method=universal-auth",
      `--client-id=${infisical.clientId}`,
      `--client-secret=${infisical.clientSecret}`,
      "--silent",
      "--plain",
    ],
    { encoding: "utf8", env: { ...process.env, INFISICAL_API_URL: infisical.apiUrl } },
  );
  if (result.status !== 0) {
    throw new Error(`Infisical login failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function exportSecrets(
  infisical: ReturnType<typeof getInfisicalEnv>,
  token: string,
  env: string,
  path: string,
  projectId: string,
  recursive = false,
) {
  const result = spawnSync(
    "infisical",
    [
      recursive ? "secrets" : "export",
      `--env=${env}`,
      `--path=${path}`,
      `--projectId=${projectId}`,
      `--domain=${infisical.apiUrl}`,
      `--token=${token}`,
      "--output=json",
      ...(recursive ? ["--recursive"] : ["--format=json"]),
    ],
    { encoding: "utf8", env: { ...process.env, INFISICAL_API_URL: infisical.apiUrl } },
  );

  if (result.status !== 0) {
    if (!recursive) return [];
    throw new Error(`Infisical export failed: ${result.stderr.trim()}`);
  }

  return JSON.parse(result.stdout) as SecretRecord[];
}

function getSecret(secrets: SecretRecord[], names: string[]) {
  for (const name of names) {
    const record = secrets.find((secret) => (secret.secretKey ?? secret.key) === name);
    const value = record?.secretValue ?? record?.value;
    if (value) return { name, value };
  }
  return undefined;
}

async function warnIfLocalServerMissing(port: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    if (!response.ok) console.warn(`local_server_warning=status_${response.status}`);
  } catch {
    console.warn(`local_server_warning=no_server_on_port_${port}`);
  } finally {
    clearTimeout(timeout);
  }
}

function startNgrok({ authtoken, domain, port }: { authtoken: string; domain?: string; port: number }) {
  const tempDir = mkdtempSync(join(tmpdir(), "oriental-ngrok-"));
  const configPath = join(tempDir, "ngrok.yml");
  writeFileSync(configPath, `version: "3"\nagent:\n  authtoken: ${JSON.stringify(authtoken)}\n`, { mode: 0o600 });
  const args = [
    "http",
    String(port),
    "--config",
    configPath,
    "--log=stdout",
    "--log-format=json",
    ...(domain ? ["--url", normalizeUrl(domain)] : []),
  ];
  const child = spawn("ngrok", args, { stdio: ["ignore", "pipe", "pipe"] });
  let printedUrl = false;

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const event = parseJson(line);
      const url = typeof event?.url === "string" ? event.url : undefined;
      if (url && !printedUrl) {
        printedUrl = true;
        console.log(`ngrok_url=${url}`);
      }
      if (event?.lvl === "eror" || event?.lvl === "crit") console.error(redactSecrets(line));
    }
  });
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(redactSecrets(chunk.toString("utf8"))));
  child.on("exit", (code) => {
    rmSync(tempDir, { force: true, recursive: true });
    process.exit(code ?? 0);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      child.kill(signal);
      rmSync(tempDir, { force: true, recursive: true });
    });
  }
}

function parseJson(line: string) {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeUrl(domain: string) {
  const trimmed = domain.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

function redactSecrets(value: string) {
  return value.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
