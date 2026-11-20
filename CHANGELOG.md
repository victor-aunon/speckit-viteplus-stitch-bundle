# Changelog

All notable changes to the `viteplus-stitch` Spec Kit bundle are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The installer resolves `bundle.version` from `bundle.yml`, so a release bump is a
one-file change plus this changelog.

## [Unreleased]

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
