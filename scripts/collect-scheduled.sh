#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export TZ=Asia/Seoul
case "$(date +%u-%H)" in
  [1-5]-0[6-9]|[1-5]-10|[1-5]-2[0-3]|7-1[2-6])
    service_date=$(date +%F) ;;
  [2-6]-00)
    # At midnight in Seoul the UTC calendar date is still yesterday.
    service_date=$(date -u +%F) ;;
  *) exit 0 ;;
esac
mkdir -p logs
exec >> logs/collector.log 2>&1
date '+%F %T %Z'
exec /usr/local/bin/docker compose -f compose.nas.yaml --profile collector \
  run --rm collector --date "$service_date" --retry-pending
