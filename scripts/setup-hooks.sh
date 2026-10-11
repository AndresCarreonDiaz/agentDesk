#!/usr/bin/env bash
# Enable the repo's tracked git hooks (secret scan before each commit).
set -euo pipefail
git config core.hooksPath .githooks
command -v gitleaks >/dev/null || echo "Install gitleaks: brew install gitleaks"
echo "Git hooks enabled (.githooks)."
