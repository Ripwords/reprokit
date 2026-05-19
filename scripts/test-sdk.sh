#!/usr/bin/env bash
# Run EACH SDK test file in its own `bun test` process so globalThis state
# cannot leak across files.
#
# Why: several SDK tests assign happy-dom Window/document/navigator (and
# patch prototypes such as HTMLCanvasElement) onto globalThis. In a shared
# `bun test` process that state leaks into sibling files, and the leak is
# execution-order sensitive — a suite green on macOS fails on Linux CI
# purely because bun enumerates the files in a different order (and vice
# versa). Symptom seen: every file passes alone, the combined run fails.
#
# This was previously mitigated PER PACKAGE, on the assumption each package
# had at most one globalThis-mutating file. packages/core broke that
# assumption (display-media + screenshot both install DOM globals), so the
# pollution recurred *within* the package. Per-FILE isolation is the only
# robust remedy and is the correct conclusion of the original intent. The
# extra process-startup overhead is the accepted cost of deterministic,
# order-independent runs.

set -euo pipefail

PACKAGES=(sdk-utils shared recorder ui core expo integrations)

for pkg in "${PACKAGES[@]}"; do
  echo "=== packages/$pkg"
  # Deterministic order; one fresh `bun test` process per file so no file
  # can observe globals another left behind.
  while IFS= read -r f; do
    echo "--- $f"
    bun test "$f"
  done < <(find "packages/$pkg" -type f -name '*.test.ts' | sort)
done
