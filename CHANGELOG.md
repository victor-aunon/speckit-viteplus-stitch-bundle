# Changelog

All notable changes to the `viteplus-stitch` Spec Kit bundle are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The installer resolves `bundle.version` from `bundle.yml`, so a release bump is a
one-file change plus this changelog.

## [1.2.0] - 2026-11-20

### Added

- Blast radius gate with anti-loop circuit breaker (`check-blast-radius.sh`):
  protected tooling files and out-of-slice edits are rejected.
- Automated regression test execution inside `check-quality-gate.sh`, narrowed to
  the feature slice when one is active.
- Spec quality and completeness audit step, plus unattended gate flow.
- Application build/compilation gate, deferred to `after_implement`.
- End-to-end scope propagation through the lifecycle via `--scope` /
  `SPECIFY_SCOPE` (workflow input, hooks, gates, regression tests).
- Multi-stack style detection (Tailwind, UnoCSS, Panda CSS, Vanilla Extract, CSS
  Modules, CSS-in-JS) with closed-circuit Tailwind wiring validation.
- Brownfield bundle budgets: `.bundle-budget.json` config, `BUNDLE_*` environment
  variables, `--baseline-total-kb`, `--strict`, and legacy chunk exemptions.
- `--css-dir` in `check-ghost-classes.sh` (repeatable or comma-separated) to point
  the stylesheet declaration pool at custom roots.
- GitHub Actions CI running the full suite on every push, pull request and manual
  dispatch, on Node 20 and 22.
- `CHANGELOG.md`, and `bundle.yml` as the single source of truth for the version.

### Changed

- **Default strictness is now lower in two places** — pass `--strict`, or omit
  `--scope`, to get the previous behavior:
  - Gates run with `--scope` now audit only that slice, including the env-config
    guard, ghost-class scanning, and the `after_implement` final gate.
  - The total bundle budget is grandfathered when `dist/` already exceeds it and no
    baseline is recorded (a loud warning is printed instead of a failure).
- The ghost-class CSS declaration pool is project-wide by default, so narrowing
  `--src-dir` no longer turns globally declared classes into false positives.
- The installer resolves `bundle.version` from `bundle.yml` and reports it, so a
  release bump is a one-file change.
- Templates standardized on the native Vite+ `vp` toolchain.

### Fixed

- Scope leaks: the env-config gate and the ghost-class gate ignored `--scope` and
  scanned the whole `src/`, producing false positives in brownfield projects.
- `--css-dir` was documented in `check-ghost-classes.sh` but never parsed.
- `requires.mcp` no longer demands the Stitch MCP server, so `specify bundle
  install` succeeds on any machine; Stitch stays opt-in via `enable_stitch`.
- `@shadcn/lint` is wired as an oxlint `jsPlugins` string specifier, and test files
  are exempt from `max-lines-per-function`.

### Upgrading from 1.1.0

No consumer code changes are required. Review the two default relaxations above if
your pipelines relied on `--scope` auditing the whole repository or on the total
bundle budget failing unconditionally:

```bash
# previous strict behavior
bash .specify/scripts/bash/check-quality-gate.sh          # no --scope
bash .specify/scripts/bash/check-bundle-budget.sh --strict
```

## [1.1.0] - 2026-11-09

### Added

- Impeccable UI craft lifecycle integrated into the workflow: critique, harden,
  animate, and audit stages with design review gates.
- Guardrails step and constitution section forbidding agents from weakening gates,
  lint rules, or tests to make a failing check pass.
- Installer support for specific GitHub releases (`--release=<tag>`) and locally
  downloaded release archives (`--zip=<path>`), plus automatic asset download.

### Changed

- Lifecycle hooks reorganized into `after_task` and `after_implement`, with visual
  verification made deterministic and portable across platforms (Git Bash/WSL).

## [1.0.0] - 2026-10-20

### Added

- Initial public release: Vite+ (`vp`) unified quality gate, Clean Architecture
  boundary enforcement, typed environment config guard, Stitch token and visual
  verification, contract and ghost-class gates, and the phased SDD workflow.
