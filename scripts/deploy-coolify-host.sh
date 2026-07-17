#!/usr/bin/env bash
set -euo pipefail

target=""
sha=""
expected_current_sha=""
voice_model_cell="control"
allow_emergency_production=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      target="${2:-}"
      shift 2
      ;;
    --expected-current-sha)
      expected_current_sha="${2:-}"
      shift 2
      ;;
    --voice-model-cell)
      voice_model_cell="${2:-}"
      shift 2
      ;;
    --allow-emergency-production)
      allow_emergency_production=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 --target staging|production --expected-current-sha sha [--voice-model-cell control|candidate] [--allow-emergency-production] [git-sha]"
      exit 0
      ;;
    *)
      if [[ -n "$sha" ]]; then
        echo "Usage: $0 --target staging|production --expected-current-sha sha [--voice-model-cell control|candidate] [--allow-emergency-production] [git-sha]" >&2
        exit 2
      fi
      sha="$1"
      shift
      ;;
  esac
done

if [[ "$target" != "staging" && "$target" != "production" ]]; then
  echo "Usage: $0 --target staging|production --expected-current-sha sha [--voice-model-cell control|candidate] [--allow-emergency-production] [git-sha]" >&2
  exit 2
fi

if [[ -z "$sha" ]]; then
  git fetch origin main --quiet
  sha="$(git rev-parse origin/main)"
fi

if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 --target staging|production --expected-current-sha sha [--voice-model-cell control|candidate] [--allow-emergency-production] [git-sha]" >&2
  exit 2
fi

if ! [[ "$expected_current_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Host deploys require --expected-current-sha with the full currently deployed SHA." >&2
  exit 2
fi

if [[ "$voice_model_cell" != "control" && "$voice_model_cell" != "candidate" ]]; then
  echo "--voice-model-cell must be control or candidate." >&2
  exit 2
fi

if [[ "$target" == "production" && "$voice_model_cell" != "control" ]]; then
  echo "Production host deployment forbids the candidate model cell." >&2
  exit 2
fi

if [[ "$target" == "production" && "$allow_emergency_production" != "true" ]]; then
  echo "Production deploys must use the Coolify API. Host deployment is break-glass only; pass --allow-emergency-production." >&2
  exit 2
fi

remote_host="${COOLIFY_DEPLOY_HOST:-root@mereka-deploy-apps-01-sin}"
app_uuid="${COOLIFY_ORIENTAL_APPLICATION_UUID:-mtrl2z6a7zvoyevxvufpntij}"
repo_url="${ORIENTAL_REPO_URL:-https://github.com/Biji-Biji-Initiative/oriental-website.git}"
remote_cache_dir="${ORIENTAL_REMOTE_BUILD_CACHE:-/data/coolify/build-cache/oriental-website}"
prod_dir="/data/coolify/applications/${app_uuid}"
staging_dir="/data/coolify/applications/oriental-staging"
ga_measurement_id="${NEXT_PUBLIC_GA_MEASUREMENT_ID:-}"
google_site_verification="${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION:-}"

if [[ ! "$ga_measurement_id" =~ ^G-[A-Z0-9]+$ ]]; then
  echo "NEXT_PUBLIC_GA_MEASUREMENT_ID must be supplied by the managed application environment." >&2
  exit 1
fi
if [[ ! "$google_site_verification" =~ ^[A-Za-z0-9_-]{20,256}$ ]]; then
  echo "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION must be supplied by the managed application environment." >&2
  exit 1
fi

declare -a ssh_command
if [[ -n "${COOLIFY_SSH_COMMAND:-}" ]]; then
  # Preserve the established override for conventional command names/flags.
  read -r -a ssh_command <<<"$COOLIFY_SSH_COMMAND"
elif command -v tailscale >/dev/null 2>&1; then
  ssh_command=("$(command -v tailscale)" ssh)
elif command -v tailscale.exe >/dev/null 2>&1; then
  # Native WSL sessions commonly reach the fleet through the Windows client;
  # the array preserves spaces in Program Files paths.
  ssh_command=("$(command -v tailscale.exe)" ssh)
else
  echo "Tailscale CLI is required (tailscale or tailscale.exe)." >&2
  exit 1
fi

if [[ "$target" == "staging" ]]; then
  infisical_token="${INFISICAL_TOKEN:-}"
  infisical_domain="${INFISICAL_API_URL:-https://secrets.mereka.io/api}"
  infisical_project_id="${INFISICAL_PROJECT_ID:-}"
  if [[ -z "$infisical_token" && -n "${INFISICAL_UA_CLIENT_ID:-}" && -n "${INFISICAL_UA_CLIENT_SECRET:-}" ]]; then
    infisical_token="$(infisical login \
      --method universal-auth \
      --client-id "$INFISICAL_UA_CLIENT_ID" \
      --client-secret "$INFISICAL_UA_CLIENT_SECRET" \
      --domain "$infisical_domain" \
      --plain \
      --silent)"
  fi
  if [[ -z "$infisical_token" || -z "$infisical_project_id" ]]; then
    echo "Staging deployment requires the canonical Infisical machine identity and project." >&2
    exit 1
  fi

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  reconcile_program="$(<"$script_dir/reconcile-staging-env.py")"
  printf -v reconcile_command 'python3 -c %q %q %q' \
    "$reconcile_program" "$staging_dir" "$expected_current_sha"
  infisical export \
    --token "$infisical_token" \
    --domain "$infisical_domain" \
    --projectId "$infisical_project_id" \
    --env staging \
    --path /deploy/oriental-website \
    --format dotenv \
    --silent \
    | "${ssh_command[@]}" "$remote_host" "$reconcile_command"
fi

"${ssh_command[@]}" "$remote_host" "bash -s -- '$target' '$sha' '$app_uuid' '$repo_url' '$remote_cache_dir' '$prod_dir' '$staging_dir' '$expected_current_sha' '$voice_model_cell' '$ga_measurement_id' '$google_site_verification'" <<'REMOTE'
set -euo pipefail

target="$1"
sha="$2"
app_uuid="$3"
repo_url="$4"
remote_cache_dir="$5"
prod_dir="$6"
staging_dir="$7"
expected_current_sha="$8"
voice_model_cell="$9"
ga_measurement_id="${10}"
google_site_verification="${11}"
short="${sha:0:7}"
mirror="${remote_cache_dir}/repo.git"
worktrees="${remote_cache_dir}/worktrees"
workdir="${worktrees}/${short}-$(date -u +%Y%m%dT%H%M%SZ)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ "$target" == "staging" ]]; then
  target_dir="$staging_dir"
else
  target_dir="$prod_dir"
fi

mkdir -p "$target_dir"
exec 9>"$target_dir/.deploy.lock"
if ! flock -n 9; then
  echo "Another host deployment holds $target_dir/.deploy.lock." >&2
  exit 1
fi

current_sha="$(sed -n 's/^SOURCE_COMMIT=//p' "$target_dir/.env" | tail -1)"
if [[ "$current_sha" != "$expected_current_sha" ]]; then
  echo "${target^} moved: expected $expected_current_sha but host has ${current_sha:-unset}." >&2
  exit 1
fi

if [[ "$target" == "staging" ]]; then
  echo "Staging ownership confirmed at $current_sha."
else
  echo "BREAK-GLASS production ownership confirmed at $current_sha." >&2
fi

mkdir -p "$remote_cache_dir" "$worktrees"
if [[ ! -d "$mirror" ]]; then
  git clone --bare "$repo_url" "$mirror" >/dev/null 2>&1
fi

git --git-dir="$mirror" fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' >/dev/null
git --git-dir="$mirror" cat-file -e "${sha}^{commit}"
git --git-dir="$mirror" worktree add --detach "$workdir" "$sha" >/dev/null

cleanup() {
  git --git-dir="$mirror" worktree remove --force "$workdir" >/dev/null 2>&1 || rm -rf "$workdir"
}
trap cleanup EXIT

brand_motion_preview="false"
image="${app_uuid}:${sha}"
if [[ "$target" == "staging" ]]; then
  brand_motion_preview="true"
  # Staging bakes a different NEXT_PUBLIC flag. A distinct tag prevents a
  # later compose recreation from ever resolving to the production build cell.
  image="${app_uuid}:staging-${sha}"
fi

if [[ ! "$ga_measurement_id" =~ ^G-[A-Z0-9]+$ ]]; then
  echo "NEXT_PUBLIC_GA_MEASUREMENT_ID from the managed environment is malformed." >&2
  exit 1
fi
if [[ ! "$google_site_verification" =~ ^[A-Za-z0-9_-]{20,256}$ ]]; then
  echo "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION from the managed environment is malformed." >&2
  exit 1
fi

echo "building_image=${image} brand_motion_preview=${brand_motion_preview} voice_model_cell=${voice_model_cell} analytics_configured=$([[ -n "$ga_measurement_id" ]] && echo true || echo false) search_verification_configured=$([[ -n "$google_site_verification" ]] && echo true || echo false)"
DOCKER_BUILDKIT=1 docker build \
  --build-arg "NEXT_PUBLIC_BRAND_MOTION_PREVIEW=${brand_motion_preview}" \
  --build-arg "NEXT_PUBLIC_GA_MEASUREMENT_ID=${ga_measurement_id}" \
  --build-arg "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=${google_site_verification}" \
  --progress=plain \
  -t "$image" \
  "$workdir"

if [[ "$target" == "production" ]]; then
  target_dir="$prod_dir"
  compose_project=""
  container_filter="${app_uuid}-220859417413"
else
  target_dir="$staging_dir"
  compose_project="oriental-staging"
  container_filter="oriental-staging-1ff751c"
fi

cp -p "$target_dir/docker-compose.yaml" "$target_dir/docker-compose.yaml.deploy-backup-${timestamp}"
cp -p "$target_dir/.env" "$target_dir/.env.deploy-backup-${timestamp}"
python3 - "$target_dir" "$image" "$sha" "$target" "$voice_model_cell" "$ga_measurement_id" "$google_site_verification" <<'PY'
from pathlib import Path
import os
import sys
import tempfile

app_dir = Path(sys.argv[1])
image = sys.argv[2]
sha = sys.argv[3]
target = sys.argv[4]
voice_model_cell = sys.argv[5]
ga_measurement_id = sys.argv[6]
google_site_verification = sys.argv[7]

compose = app_dir / "docker-compose.yaml"
lines = []
for line in compose.read_text().splitlines():
    if line.strip().startswith("image:"):
        indent = line[: len(line) - len(line.lstrip())]
        lines.append(f"{indent}image: '{image}'")
    else:
        lines.append(line)
compose_text = "\n".join(lines) + "\n"

env_path = app_dir / ".env"
overrides = {
    "SOURCE_COMMIT": sha,
    "GIT_SHA": sha,
    "NEXT_PUBLIC_GA_MEASUREMENT_ID": ga_measurement_id,
    "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION": google_site_verification,
}
if target == "staging":
    # This is the non-secret governed release cell. Infisical's staging
    # environment remains canonical; the host deployment materializes the same
    # safe values atomically so stale experiment flags cannot survive a release.
    overrides.update({
        "VOICE_RUNTIME_PROFILE": "baseline",
        "VOICE_MODEL_CELL": voice_model_cell,
        "VOICE_REASONING_CELL": "low",
        "VOICE_EMAIL_CAPTURE_MODE": "adaptive",
        "VOICE_VARIANT_PICKER": "true" if voice_model_cell == "candidate" else "false",
    })
seen = set()
out = []
for line in env_path.read_text().splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        out.append(line)
        continue
    key = line.split("=", 1)[0]
    if key in overrides:
        out.append(f"{key}={overrides[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in overrides.items():
    if key not in seen:
        out.append(f"{key}={value}")
env_text = "\n".join(out) + "\n"

def atomic_write(path: Path, value: str) -> None:
    mode = path.stat().st_mode & 0o777
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(value)
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

# Render both files completely before replacing either one. Each replacement is
# atomic; if the process stops between them, no container has been recreated and
# the optimistic-SHA retry safely converges the pair.
atomic_write(compose, compose_text)
atomic_write(env_path, env_text)
PY

cd "$target_dir"
if [[ -n "$compose_project" ]]; then
  docker compose -p "$compose_project" up -d --no-deps --force-recreate
else
  docker compose up -d --no-deps --force-recreate
fi

sleep 8
docker ps \
  --filter name="$container_filter" \
  --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
REMOTE

if [[ "$target" == "production" ]]; then
  health_url="https://oriental.mereka.io/api/health"
else
  health_url="https://staging.oriental.mereka.io/api/health"
fi
curl -fsS "$health_url"
printf '\n'
