import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const separator = args.indexOf("--");
const timeoutFlag = args.indexOf("--timeout-ms");
const timeoutValue = timeoutFlag >= 0 ? args[timeoutFlag + 1] : undefined;
const timeoutMs = Number(timeoutValue);
const command = separator >= 0 ? args[separator + 1] : undefined;
const commandArgs = separator >= 0 ? args.slice(separator + 2) : [];

if (
  timeoutFlag < 0 ||
  separator < 0 ||
  timeoutFlag >= separator ||
  !Number.isInteger(timeoutMs) ||
  timeoutMs < 50 ||
  timeoutMs > 10 * 60_000 ||
  !command
) {
  process.stderr.write("Usage: run-command-with-deadline --timeout-ms <50..600000> -- <command> [args...]\n");
  process.exit(2);
}

const detached = process.platform !== "win32";
const child = spawn(command, commandArgs, {
  detached,
  env: process.env,
  stdio: "inherit",
});
let timedOut = false;

const deadline = setTimeout(() => {
  timedOut = true;
  process.stderr.write(`Command exceeded the ${timeoutMs} ms release deadline.\n`);
  if (detached && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    child.kill("SIGKILL");
  }
}, timeoutMs);
deadline.unref();

child.once("error", (error) => {
  clearTimeout(deadline);
  process.stderr.write(`Failed to start release command: ${error.message}\n`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  clearTimeout(deadline);
  if (timedOut) {
    process.exitCode = 124;
    return;
  }
  if (signal) {
    process.stderr.write(`Release command ended from signal ${signal}.\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
