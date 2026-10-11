#!/usr/bin/env bash
# Frozen Loop oracle. Usage: verify/oracle.sh <workdir>
set -euo pipefail
if [ $# -ne 1 ]; then echo "usage: verify/oracle.sh <workdir>" >&2; exit 2; fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/loop/run.ts" "$1"
