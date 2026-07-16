#!/usr/bin/env bash
set -euo pipefail

target=""
sha=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      target="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --target staging|production [git-sha]"
      exit 0
      ;;
    *)
      if [[ -n "$sha" ]]; then
        echo "Usage: $0 --target staging|production [git-sha]" >&2
        exit 2
      fi
      sha="$1"
      shift
      ;;
  esac
done

if [[ "$target" != "staging" && "$target" != "production" ]]; then
  echo "Usage: $0 --target staging|production [git-sha]" >&2
  exit 2
fi

if [[ -z "$sha" ]]; then
  git fetch origin main --quiet
  sha="$(git rev-parse origin/main)"
fi

if ! [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "Usage: $0 --target staging|production [git-sha]" >&2
  exit 2
fi

remote_host="${COOLIFY_DEPLOY_HOST:-root@mereka-deploy-apps-01-sin}"
ssh_command="${COOLIFY_SSH_COMMAND:-tailscale ssh}"
app_uuid="${COOLIFY_ORIENTAL_APPLICATION_UUID:-mtrl2z6a7zvoyevxvufpntij}"
repo_url="${ORIENTAL_REPO_URL:-https://github.com/Biji-Biji-Initiative/oriental-website.git}"
remote_cache_dir="${ORIENTAL_REMOTE_BUILD_CACHE:-/data/coolify/build-cache/oriental-website}"
prod_dir="/data/coolify/applications/${app_uuid}"
staging_dir="/data/coolify/applications/oriental-staging"

# shellcheck disable=SC2086 # COOLIFY_SSH_COMMAND may intentionally include flags.
$ssh_command "$remote_host" "bash -s -- '$target' '$sha' '$app_uuid' '$repo_url' '$remote_cache_dir' '$prod_dir' '$staging_dir'" <<'REMOTE'
set -euo pipefail

target="$1"
sha="$2"
app_uuid="$3"
repo_url="$4"
remote_cache_dir="$5"
prod_dir="$6"
staging_dir="$7"
short="${sha:0:7}"
image="${app_uuid}:${sha}"
mirror="${remote_cache_dir}/repo.git"
worktrees="${remote_cache_dir}/worktrees"
workdir="${worktrees}/${short}-$(date -u +%Y%m%dT%H%M%SZ)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

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
if [[ "$target" == "staging" ]]; then
  brand_motion_preview="true"
fi

echo "building_image=${image} brand_motion_preview=${brand_motion_preview}"
DOCKER_BUILDKIT=1 docker build \
  --build-arg "NEXT_PUBLIC_BRAND_MOTION_PREVIEW=${brand_motion_preview}" \
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
python3 - "$target_dir" "$image" "$sha" <<'PY'
from pathlib import Path
import sys

app_dir = Path(sys.argv[1])
image = sys.argv[2]
sha = sys.argv[3]

compose = app_dir / "docker-compose.yaml"
lines = []
for line in compose.read_text().splitlines():
    if line.strip().startswith("image:"):
        indent = line[: len(line) - len(line.lstrip())]
        lines.append(f"{indent}image: '{image}'")
    else:
        lines.append(line)
compose.write_text("\n".join(lines) + "\n")

env_path = app_dir / ".env"
overrides = {"SOURCE_COMMIT": sha, "GIT_SHA": sha}
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
env_path.write_text("\n".join(out) + "\n")
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
