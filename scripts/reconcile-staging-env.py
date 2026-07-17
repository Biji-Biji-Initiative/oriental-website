"""Atomically merge an Infisical dotenv export into staging's host env.

The dotenv payload is read only from stdin so secret values never appear in a
remote process argument or deployment log. A sidecar records exactly which
keys Infisical owns, allowing later syncs to remove retired managed keys while
preserving Coolify/Compose-owned entries.
"""

from __future__ import annotations

import os
from pathlib import Path
import fcntl
import re
import sys
import tempfile


KEY_PATTERN = re.compile(r"^([A-Z][A-Z0-9_]*)=")
SIDECAR_NAME = ".infisical-managed-keys"


def atomic_write(path: Path, content: str, mode: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: reconcile-staging-env.py <staging-app-dir> [expected-current-sha]")

    target_dir = Path(sys.argv[1])
    expected_current_sha = sys.argv[2] if len(sys.argv) == 3 else None
    env_path = target_dir / ".env"
    sidecar_path = target_dir / SIDECAR_NAME
    if not env_path.is_file():
        raise SystemExit("staging .env is missing")

    managed_lines: dict[str, str] = {}
    for raw_line in sys.stdin.read().splitlines():
        match = KEY_PATTERN.match(raw_line)
        if not match:
            raise SystemExit("Infisical export contained a malformed dotenv line")
        key = match.group(1)
        if key in managed_lines:
            raise SystemExit(f"Infisical export contained duplicate key {key}")
        managed_lines[key] = raw_line
    if not managed_lines:
        raise SystemExit("Infisical export was empty")

    lock_path = target_dir / ".deploy.lock"
    with lock_path.open("a", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SystemExit("another staging deployment holds the host lock") from error

        existing_lines = env_path.read_text(encoding="utf-8").splitlines()
        if expected_current_sha is not None:
            current_sha = next(
                (line.split("=", 1)[1] for line in reversed(existing_lines) if line.startswith("SOURCE_COMMIT=")),
                "",
            )
            if current_sha != expected_current_sha:
                raise SystemExit("staging moved before Infisical reconciliation")

        previous_keys = set()
        if sidecar_path.is_file():
            previous_keys = {line for line in sidecar_path.read_text(encoding="utf-8").splitlines() if line}

        emitted = set()
        output_lines: list[str] = []
        for line in existing_lines:
            match = KEY_PATTERN.match(line)
            key = match.group(1) if match else None
            if key in managed_lines:
                if key not in emitted:
                    output_lines.append(managed_lines[key])
                    emitted.add(key)
            elif key not in previous_keys:
                output_lines.append(line)

        for key in sorted(managed_lines):
            if key not in emitted:
                output_lines.append(managed_lines[key])

        env_mode = env_path.stat().st_mode & 0o777
        atomic_write(env_path, "\n".join(output_lines) + "\n", env_mode)
        atomic_write(sidecar_path, "\n".join(sorted(managed_lines)) + "\n", 0o600)
    print(f"staging Infisical reconciliation: {len(managed_lines)} managed keys")


if __name__ == "__main__":
    main()
