#!/usr/bin/env bash
# 启动带持久 profile + BiDi 远程调试的 Firefox
DIR="$HOME/.local/share/ykt-ff"
mkdir -p "$DIR"
if pgrep -f "profile $DIR/profile" >/dev/null; then
  echo "already running. log: $DIR/ff.log"
  exit 0
fi
nohup firefox -no-remote -profile "$DIR/profile" --remote-debugging-port 6000 >>"$DIR/ff.log" 2>&1 &
sleep 3
grep -o 'ws://[^ ]*' "$DIR/ff.log" | tail -1 || echo "started, log: $DIR/ff.log"
