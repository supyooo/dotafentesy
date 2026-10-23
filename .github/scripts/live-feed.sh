#!/usr/bin/env bash
# Опрос OpenDota на раннере GitHub Actions (workflow live-feed): раз в EVERY секунд — live-feed по турниру TOURNAMENT,
# изменились данные — коммит в ветку live-feed (выгрузка <slug>.json и кэш разобранных карт .cache-<slug>.json).
set -u
ROOT=$(pwd)
git config --global user.name "live-feed"
git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
if git ls-remote --exit-code origin live-feed >/dev/null 2>&1; then
  git fetch -q origin live-feed:live-feed && git worktree add -q "$ROOT/_feed" live-feed
else
  git worktree add -q --orphan -b live-feed "$ROOT/_feed"
fi
END=$(( $(date +%s) + ${DURATION:-20700} ))
while [ "$(date +%s)" -lt "$END" ]; do
  if pnpm -s --filter @df/worker live-feed "$TOURNAMENT" --out "$ROOT/_feed/$TOURNAMENT.json" --cache "$ROOT/_feed/.cache-$TOURNAMENT.json"; then
    if [ -n "$(git -C "$ROOT/_feed" status --porcelain)" ]; then
      (cd "$ROOT/_feed" && git add -A && git commit -qm "live $TOURNAMENT $(date -u +%FT%TZ)" && git push -q origin HEAD:live-feed) || echo "push не прошёл — повтор в следующий раз"
    fi
  else
    echo "сбор не прошёл — повтор через ${EVERY:-180} с"
  fi
  sleep "${EVERY:-180}"
done
