#!/usr/bin/env bash
# Codex 이미지 생성 (한 장씩). 결과는 art-src/<이름>_<시각>.png, 프롬프트는 art-src/프롬프트.md 에 남긴다.
#   bash scripts/codex-image.sh <이름> <크기 예: 1024x1024> "<프롬프트>"
# Codex 가 저장 단계에서 멈추면 ~/.codex/generated_images 의 새 그림을 회수하고 끝낸다 (bleh/tools/chargen 과 같은 방법).
# 여러 개를 동시에 돌리지 말 것 (다른 그림을 집어올 수 있음). 회수본은 꼭 눈으로 확인.
set -u
cd "$(dirname "$0")/.." || exit 1
NAME="${1:?이름}"; SIZE="${2:?크기}"; PROMPT="${3:?프롬프트}"
GEN="$HOME/.codex/generated_images"
STAMP=$(date +%Y%m%d-%H%M%S)
TMP="${TMPDIR:-/tmp}/wh-codex/$STAMP"; mkdir -p "$TMP"
OUT="art-src/${NAME}_${STAMP}.png"
LOG="art-src/프롬프트.md"
[ -f "$LOG" ] || printf '# Codex 이미지 생성 기록\n\n' > "$LOG"
printf '## %s (%s, %s)\n\n%s\n\n' "$NAME" "$STAMP" "$SIZE" "$PROMPT" >> "$LOG"
touch "$TMP/.start"
codex exec --sandbox workspace-write --skip-git-repo-check --ephemeral -C "$TMP" \
  "Use your image generation tool to generate ONE image (size $SIZE) and save it in the current working directory with the exact filename '$NAME.png'. Do not create any other file. When done, reply with only the saved absolute path. Image description: $PROMPT" > "$TMP/codex.log" 2>&1 &
pid=$!
found=""; t_found=0; start=$(date +%s)
while kill -0 $pid 2>/dev/null; do
  [ -f "$TMP/$NAME.png" ] && break
  if [ -z "$found" ]; then f=$(find "$GEN" -name '*.png' -newer "$TMP/.start" 2>/dev/null | head -1); [ -n "$f" ] && { found="$f"; t_found=$(date +%s); }; fi
  if [ -n "$found" ] && [ $(( $(date +%s) - t_found )) -gt 45 ]; then kill $pid 2>/dev/null; break; fi
  if [ $(( $(date +%s) - start )) -gt 900 ]; then kill $pid 2>/dev/null; echo "FAILED $NAME (15분 초과)"; exit 1; fi
  sleep 5
done
wait $pid 2>/dev/null
if [ -f "$TMP/$NAME.png" ]; then cp "$TMP/$NAME.png" "$OUT"; echo "OK: $OUT"
elif [ -z "$found" ]; then found=$(find "$GEN" -name '*.png' -newer "$TMP/.start" 2>/dev/null | head -1); [ -n "$found" ] && { cp "$found" "$OUT"; echo "RECOVERED: $OUT"; } || { echo "FAILED $NAME"; tail -5 "$TMP/codex.log"; exit 1; }
else cp "$found" "$OUT"; echo "RECOVERED: $OUT"; fi
printf -- '→ `%s`\n\n' "$OUT" >> "$LOG"
