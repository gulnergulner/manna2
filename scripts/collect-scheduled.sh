#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export TZ=Asia/Seoul
case "$(date +%u-%H)" in
  [1-5]-0[67]|[1-4]-2[23]|7-1[34])
    service_date=$(date +%F) ;;
  6-0[01])
    # At both Saturday checks (00:30 and 01:30 KST), UTC is still Friday.
    service_date=$(date -u +%F) ;;
  *) exit 0 ;;
esac
mkdir -p logs
exec >> logs/collector.log 2>&1
date '+%F %T %Z'
exec /usr/local/bin/docker compose -f compose.nas.yaml --profile collector \
  run --rm collector --date "$service_date" --retry-pending
