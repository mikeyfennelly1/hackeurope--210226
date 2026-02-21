#!/usr/bin/env bash
set -euo pipefail

NATS_SERVER=$(command -v nats-server 2>/dev/null || echo "")

if [ -z "$NATS_SERVER" ]; then
  GOBIN_PATH="$HOME/go/bin/nats-server"
  if [ -x "$GOBIN_PATH" ]; then
    NATS_SERVER="$GOBIN_PATH"
  else
    echo "nats-server not found. Installing via go install..."
    go install github.com/nats-io/nats-server/v2@latest
    NATS_SERVER="$HOME/go/bin/nats-server"
  fi
fi

echo "Starting NATS server with JetStream enabled..."
echo "  Server:    nats://localhost:4222"
echo "  HTTP mon:  http://localhost:8222"
echo "  Store dir: /tmp/nats-jetstream"
echo ""

exec "$NATS_SERVER" \
  --jetstream \
  --store_dir /tmp/nats-jetstream \
  --port 4222 \
  --http_port 8222 \
  --name "hackeurope-nats" \
  "$@"
