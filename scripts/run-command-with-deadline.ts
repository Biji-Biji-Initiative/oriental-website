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
let childExited = false;
let terminationIssued = false;
type CancellationSignal = "SIGHUP" | "SIGINT" | "SIGTERM";
let terminationReason: "deadline" | CancellationSignal | null = null;

function terminateChildGroup() {
  if (childExited || terminationIssued) return;
  terminationIssued = true;
  if (detached && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall through to the direct-child kill when no process group exists.
    }
  }
  child.kill("SIGKILL");
}

const cancellationExitCodes: Record<CancellationSignal, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};
const cancellationHandlers = new Map<CancellationSignal, () => void>();
for (const signal of Object.keys(cancellationExitCodes) as CancellationSignal[]) {
  const handler = () => {
    if (childExited || terminationReason) return;
    terminationReason = signal;
    process.stderr.write(`Release command cancelled by ${signal}; terminating its process group.\n`);
    terminateChildGroup();
  };
  cancellationHandlers.set(signal, handler);
  process.on(signal, handler);
}

const supervisorExitHandler = () => terminateChildGroup();
process.once("exit", supervisorExitHandler);

const deadline = setTimeout(() => {
  if (childExited || terminationReason) return;
  terminationReason = "deadline";
  process.stderr.write(`Command exceeded the ${timeoutMs} ms release deadline.\n`);
  terminateChildGroup();
}, timeoutMs);
deadline.unref();

function finish(exitCode: number) {
  if (childExited) return;
  childExited = true;
  clearTimeout(deadline);
  process.removeListener("exit", supervisorExitHandler);
  for (const [signal, handler] of cancellationHandlers) process.removeListener(signal, handler);
  process.exitCode = exitCode;
}

child.once("error", (error) => {
  process.stderr.write(`Failed to start release command: ${error.message}\n`);
  finish(1);
});

child.once("exit", (code, signal) => {
  if (terminationReason === "deadline") {
    finish(124);
    return;
  }
  if (terminationReason) {
    finish(cancellationExitCodes[terminationReason]);
    return;
  }
  if (signal) {
    process.stderr.write(`Release command ended from signal ${signal}.\n`);
    finish(1);
    return;
  }
  finish(code ?? 1);
});
