#!/bin/sh
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${LAUNCHLY_PROCESS_ROLE:-api}" = "worker" ]; then
  exec node dist/main
fi

exec node dist/main
