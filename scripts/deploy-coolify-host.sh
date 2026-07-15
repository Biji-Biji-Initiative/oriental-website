#!/usr/bin/env bash
set -euo pipefail

sha="${1:-}"
if [[ -z "$sha" ]]; then
  git fetch origin main --quiet
  sha="$(git rev-parse origin/main)"
fi

if ! [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "Usage: $0 [git-sha]" >&2
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
$ssh_command "$remote_host" "bash -s -- '$sha' '$app_uuid' '$repo_url' '$remote_cache_dir' '$prod_dir' '$staging_dir'" <<'REMOTE'
set -euo pipefail

sha="$1"
app_uuid="$2"
repo_url="$3"
remote_cache_dir="$4"
prod_dir="$5"
staging_dir="$6"
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

echo "building_image=${image}"
DOCKER_BUILDKIT=1 docker build --progress=plain -t "$image" "$workdir"

for dir in "$prod_dir" "$staging_dir"; do
  cp -p "$dir/docker-compose.yaml" "$dir/docker-compose.yaml.deploy-backup-${timestamp}"
  cp -p "$dir/.env" "$dir/.env.deploy-backup-${timestamp}"
  python3 - "$dir" "$image" "$sha" <<'PY'
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
done

cd "$prod_dir"
docker compose up -d --no-deps --force-recreate

cd "$staging_dir"
docker compose -p oriental-staging up -d --no-deps --force-recreate

sleep 8
docker ps \
  --filter name="${app_uuid}-220859417413" \
  --filter name="oriental-staging-1ff751c" \
  --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
REMOTE

curl -fsS https://oriental.mereka.io/api/health
printf '\n'
curl -fsS https://staging.oriental.mereka.io/api/health
printf '\n'
