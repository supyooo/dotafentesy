#!/usr/bin/env bash
# Опрос Steam GetLiveLeagueGames на раннере GitHub Actions (спайк, Slam VIII). Данные — в ветку live-data,
# каждый запуск в свою папку live/<run_id>/, чтобы запуски не затирали друг друга.
set -u
ROOT=$(pwd)
git config --global user.name "live-poller"
git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
if git ls-remote --exit-code origin live-data >/dev/null 2>&1; then
  git fetch -q origin live-data:live-data && git worktree add -q "$ROOT/_live" live-data
else
  git worktree add -q --orphan -b live-data "$ROOT/_live"
fi
cd "$ROOT/spikes/live-source"
timeout "${DURATION:-21000}" npx tsx src/live.ts > poll.log 2>&1 &
PID=$!
sync_data() {
  local dst="$ROOT/_live/live/${GITHUB_RUN_ID:-local}"
  mkdir -p "$dst/raw"
  cp -r data/live/. "$dst/" 2>/dev/null || true
  cp -r data/raw/live/. "$dst/raw/" 2>/dev/null || true
  tail -n 3 poll.log
  (cd "$ROOT/_live" && git add -A && git commit -qm "live $(date -u +%FT%TZ)" && git push -q origin live-data) || true
}
while kill -0 "$PID" 2>/dev/null; do sleep 600; sync_data; done
sync_data
