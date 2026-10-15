#!/usr/bin/env bash
# Pull the official repo in, rebuild every edition, run every local test.
# Local code lives in src/99_custom_*.js, so a merge should never conflict.
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch upstream
git merge --no-edit upstream/main

python3 build.py
python3 build.py --dev

# every local test, first failure stops the script.
# Listed, not globbed: dev/build_test.py and dev/cep_test.py are upstream tools
# that take arguments and need a local server, not tests.
for t in beat audio onset bg video; do
  echo "--- dev/${t}_test.py"
  python3 "dev/${t}_test.py"
done

echo
echo "upstream/main: $(git log --oneline -1 upstream/main)"
echo "local HEAD:    $(git log --oneline -1 HEAD)"
