#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/environment.sh
./gradlew testDebugUnitTest lintRelease --console=plain --no-daemon
