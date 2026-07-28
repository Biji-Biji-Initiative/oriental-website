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
type CancellationSignal = "SIGHUP" | "SIGINT" | "SIGTERM";
type TerminationReason = "deadline" | CancellationSignal;

const cancellationExitCodes: Record<CancellationSignal, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};
const processGroupSettleMs = 1_000;
let child: ReturnType<typeof spawn> | null = null;
let childGroupPid: number | null = null;
let leaderExited = false;
let finished = false;
let terminationIssued = false;
let terminationReason: TerminationReason | null = null;
let deadline: ReturnType<typeof setTimeout> | null = null;

function processGroupExists() {
  if (!detached || childGroupPid === null) return false;
  try {
    process.kill(-childGroupPid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function terminateChildGroup() {
  if (terminationIssued || (!child && childGroupPid === null)) return;
  terminationIssued = true;
  if (childGroupPid !== null) {
    try {
      process.kill(-childGroupPid, "SIGKILL");
      return;
    } catch {
      // Fall through to the direct-child kill when no process group exists.
    }
  }
  if (child && !leaderExited) child.kill("SIGKILL");
}

const cancellationHandlers = new Map<CancellationSignal, () => void>();
for (const signal of Object.keys(cancellationExitCodes) as CancellationSignal[]) {
  const handler = () => {
    if (finished || terminationReason) return;
    terminationReason = signal;
    process.stderr.write(`Release command cancelled by ${signal}; terminating its process group.\n`);
    terminateChildGroup();
  };
  cancellationHandlers.set(signal, handler);
  process.on(signal, handler);
}

const supervisorExitHandler = () => terminateChildGroup();
process.once("exit", supervisorExitHandler);

function finish(exitCode: number) {
  if (finished) return;
  finished = true;
  if (deadline) clearTimeout(deadline);
  process.removeListener("exit", supervisorExitHandler);
  for (const [signal, handler] of cancellationHandlers) process.removeListener(signal, handler);
  process.exitCode = exitCode;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function settleProcessGroupAfterLeaderExit() {
  if (!processGroupExists()) return false;
  process.stderr.write("Release command leader exited while descendants remained; terminating its process group.\n");
  terminateChildGroup();
  const settleDeadline = Date.now() + processGroupSettleMs;
  while (processGroupExists() && Date.now() < settleDeadline) await delay(20);
  if (processGroupExists()) {
    process.stderr.write(
      `Release command process group remained after ${processGroupSettleMs} ms kill-settle interval.\n`,
    );
  }
  return true;
}

child = spawn(command, commandArgs, {
  detached,
  env: process.env,
  stdio: "inherit",
});
childGroupPid = detached && child.pid ? child.pid : null;
if (terminationReason) terminateChildGroup();

deadline = setTimeout(() => {
  if (finished || terminationReason) return;
  terminationReason = "deadline";
  process.stderr.write(`Command exceeded the ${timeoutMs} ms release deadline.\n`);
  terminateChildGroup();
}, timeoutMs);
deadline.unref();

child.once("error", (error) => {
  process.stderr.write(`Failed to start release command: ${error.message}\n`);
  finish(1);
});

child.once("exit", (code, signal) => {
  leaderExited = true;
  void (async () => {
    const descendantsSurvivedLeader = await settleProcessGroupAfterLeaderExit();
    if (terminationReason === "deadline") {
      finish(124);
      return;
    }
    if (terminationReason) {
      finish(cancellationExitCodes[terminationReason]);
      return;
    }
    if (descendantsSurvivedLeader) {
      finish(1);
      return;
    }
    if (signal) {
      process.stderr.write(`Release command ended from signal ${signal}.\n`);
      finish(1);
      return;
    }
    finish(code ?? 1);
  })();
});
