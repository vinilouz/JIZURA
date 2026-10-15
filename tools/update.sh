#!/usr/bin/env bash
# Pull the official repo in, rebuild every edition, run the beat test.
# Local code lives in src/99_custom_*.js, so a merge should never conflict.
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch upstream
git merge --no-edit upstream/main

python3 build.py
python3 dev/beat_test.py

echo
echo "upstream/main: $(git log --oneline -1 upstream/main)"
echo "local HEAD:    $(git log --oneline -1 HEAD)"
