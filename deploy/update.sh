#!/bin/sh
# Builds this folder's code and restarts the site with it:
#   sudo deploy/update.sh
# The database is brought up to date by the "migrate" step on the way.
set -eu
cd "$(dirname "$0")/.."

before=$(docker image inspect -f '{{.Id}}' seedcode 2>/dev/null || true)

docker compose build --pull
docker compose up -d --remove-orphans

# The image the site ran before, now unused, and the leftovers of building
# it. The disk is shared with other sites, so nothing is kept that is not
# needed. Other projects' images are never touched.
after=$(docker image inspect -f '{{.Id}}' seedcode)
if [ -n "$before" ] && [ "$before" != "$after" ]; then
  docker image rm "$before" >/dev/null 2>&1 || true
fi
docker builder prune -f >/dev/null

docker compose ps
# The app takes a few seconds to start; give it up to a minute.
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT:-8010}/api/health" >/dev/null 2>&1; then
    echo "Health: answering"
    exit 0
  fi
  sleep 2
done
echo "Health: not answering after a minute. See: docker compose logs app" >&2
exit 1
