# Changelog

All notable changes to the `viteplus-stitch` Spec Kit bundle are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The installer resolves `bundle.version` from `bundle.yml`, so a release bump is a
one-file change plus this changelog.

## [Unreleased]

### Fixed

- **A protected gate config that was merely unformatted was unrepairable.**
  `vite.config.ts` became a `PROTECTED_PATTERNS` entry, and `vp check` still
  formats it — so a config with a missing newline failed `code_quality` in about a
  second with no legal repair. A real run burned **13 gate attempts** and a
  30-minute repair window on exactly that, then died on `Prompt timed out after
  1800 seconds`. The offending files were `vite.config.ts` and a
  `vitest.config.ts` the agent had just created, both missing a trailing newline;
  the quality gate's own log was the only place that said so.

  `bootstrap-project-env.sh` now formats both configs with `vp fmt` (not bare
  `oxfmt`, which applies its own defaults and produces output `vp check` rejects),
  and the tooling baseline commit carries them — a formatted-but-dirty protected
  file would be the same dead end one step later. Protecting a file the tool itself
  rewrites only works if the tool is the one that leaves it clean.

- **The workflow's conditional template syntax was never rendered, so agents and
  gates were handed `{% if %}` as literal text.** The engine substitutes
  `{{ ... }}` and nothing else; `{% %}` blocks are not evaluated, which means the
  block is always included and **both** branches of an `{% else %}` are delivered.
  Three fields were affected, all captured from a real run:

  *Prompts.* The guardrails prompt — the one that forbids touching
  `vite.config.ts`, tests and gate scripts — arrived as `{% if inputs.scope %}`
  followed by "All work is restricted to slice ''". The instruction that confines
  the agent to a feature slice was empty and wrapped in noise. The designer prompt
  had `{% else %}` branches, so it shipped two contradictory protocols at once
  (Stitch and local wireframe). Both are now shell steps that print the clause and
  are interpolated with `{{ steps.<id>.output.stdout }}`.

  *`input.args` of `command` steps.* `/speckit.plan A dialog {% if inputs.scope
  %}--scope={% endif %} --with-viteplus {% if ... %}--with-stitch{% endif %}` was
  the literal argv of every slash command: `--with-stitch` was always passed, even
  with Stitch disabled.

  *`run:` of shell steps.* The quiet one: `bash check-quality-gate.sh {% if
  inputs.scope %}--scope={% endif %}` makes bash pass `{%`, `if`,
  `inputs.scope`, `%}--scope={%`, `endif`, `%}` as six arguments. The gate scripts
  ignore unknown arguments, the run continues **unscoped**, and the blast radius
  falls back to auto-detection from `git status` instead of the declared slice.

  The scope flag is now computed once (`flag_scope`) and shared by the six gate
  invocations and the four slash commands. `tests/workflow-prompts.test.ts` walks
  the YAML and fails if any `${%`-style tag reaches `prompt`, `run` or `args`.

  Conditional branching itself is supported — as a `type: if` step with
  `condition`/`then`/`else` — but that chooses between steps; it cannot wrap a
  paragraph inside one.

## [2.1.1] - 2026-11-27

### Fixed

- **Installing from a release no longer loses the version.** `BUNDLE_VERSION` was
  resolved while `BUNDLE_ROOT` still pointed at the directory the script was
  launched from — but on `--zip` and `--release` the real bundle root is a temp
  directory created after the flags are parsed. Every remote install therefore
  printed `⚠️ Could not resolve bundle.version` and nothing recorded which version
  had been installed, on exactly the path the README recommends. The version is
  now resolved once the bundle root is final, and the `--zip` e2e asserts the
  banner carries the version from the unpacked manifest.

## [2.1.0] - 2026-11-27

### Fixed

- **The gates could be satisfied by moving the things they measure.** Three
  holes, all of them an agent editing the apparatus instead of the code:

  *The design master was editable mid-run.* `verify-stitch-design.sh` re-renders
  the goldens from `designs/<screen>.html` on every run, so an agent that edits
  the master is compared against its own edit. A real run did exactly that: it
  added `min-height: 2.75rem` to a screen at 13:39, the visual gate re-ran at
  13:44 and passed. The auditor never saw it, because the audit protocol is
  explicitly "from-scratch, not a diff review". `check-design-artifacts.sh` now
  seals the master (new `design-seal.sh`) into `design-artifacts.json`, and the
  visual gate recomputes the seal and refuses to grade a reference that moved,
  naming `check-design-artifacts.sh` as the deliberate way to re-seal.

  *`vite.config.ts` and `tests/design/**` were editable.* The gate config is where
  the gate is configured, and the vendored audit spec is the audit. Both are now
  `PROTECTED_PATTERNS`. That only holds because the React and vanilla templates
  now ship the vitest `test` block (`jsdom`, and `exclude: ['tests/design/**']`)
  the run had to add by hand to make the suite execute at all — protecting a file
  the template does not provision is how a workflow becomes unrepairable.

  *The anti-tampering check only audited deletions.* It grepped `^-` lines for a
  deleted rule, so one added `ignorePatterns: ['src/**']` took every rule away
  from `src/` and the gate reported green. Additions are audited now: added
  `ignorePatterns`, `typeCheck`/`typeAware` set to `false`, and quality rules
  retuned to `off`/`warn` are all violations. The check still reads the working
  tree, so a committed decision stays audited history and an unrecorded edit does
  not.

  What none of this fixes: an agent can still re-run `check-design-artifacts.sh`
  to re-seal a moved master. That is deliberate — it is a logged, visible act,
  which is the difference between a decision and an accident — but it is a
  detector, not a lock.

### Changed

- **Reinstalling the bundle no longer downgrades a project's toolchain.** The
  reconciler compared `devDependencies.vite` with the template pin and rewrote it
  whenever the two differed — including when the project had deliberately moved
  ahead, in which case a reinstall pulled it **backwards** and said so in one line
  of `notes`. It now keeps a newer core, prints both versions, and names the
  command that reads the matching engine (`vp toolchain vite-plus-core`). It also
  aligns `overrides.vite` to the version it kept, because a kept bump whose
  override stayed behind is exactly npm's `EOVERRIDE` abort. Pass
  `--allow-toolchain-downgrade` to `install.sh` or `bootstrap-project-env.sh` to
  force the pin back.

  This is the third instance of the failure the rest of this release is about: a
  tool overwriting the operator's tree and reporting it as a line of noise. The
  README now separates what is the project's to bump from what is the bundle's,
  and makes the `vp toolchain` step explicit — keeping a newer core without moving
  `vite-plus` does not fail a gate with a readable message, it stops `vp` booting
  entirely.

### Fixed

- **The type environment was missing, so the gate graded code the agent never
  wrote.** With `lint.options.typeCheck: true` the gate type-checks the project,
  and nothing supplied the types it needs. `@types/node` was never declared, so
  `process.env` in `playwright.design.config.ts` and the design audit reported
  TS2591; and `import.meta.env` plus the `*.css` side-effect imports reported
  TS2339/TS2882 because `vite` is aliased to @voidzero-dev/vite-plus-core, whose
  package root ships no `client.d.ts` — so nothing referenced `vite/client`.
  Measured on a real project: 19 errors, 11 of them from the tooling's own files
  and 2 more from the config's own Vite+ blocks. The bundle now declares
  `@types/node` in the baseline devDependencies (template plus reconciler, so
  brownfield manifests get it too) and materializes `vite-env.d.ts`. On that
  project the count went 19 → 7 → 2, and both survivors live in `src/`, where the
  agent can actually work.

  The vendored `tests/design/design-audit.spec.ts` is also exempted from the
  application complexity and nesting budget. It is tooling the agent may not
  edit, so its only possible grading outcome was an error nobody could fix.

- **The quality gate could not pass: it failed on its own artifacts, and its own
  remedy made the tree untouchable.** Two mechanisms, both unrepairable from
  inside the loop, closed every exit.

  *The evidence it writes is not formatter-clean.* Every gate wrote its evidence
  with `JSON.stringify(data, null, 2)`, which does not terminate the file with a
  newline, and Oxfmt requires one. Concretely: `check-design-artifacts` wrote
  `design-artifacts.json` at 23:55, `check-quality-gate` ran `vp check` at 00:18
  and failed on that file, the agent is forbidden from editing evidence, and the
  gate rewrites it without the newline on the next run. A real run burned eleven
  hours and seven repair iterations on this and the abort message blamed the
  application code. All eight writers now terminate the payload with `\\n`, and
  `gate-integrity.test.ts` fails the suite if a new writer forgets.

  *The documented remedy is a trap.* `vp check --fix` — the flag
  `check-quality-gate.sh --fix` exists to run — reformats `.specify/**`, which
  `check-blast-radius.sh` treats as protected tooling. Fifteen protected files
  turned into a blast-radius violation the agent may not repair, tripping the
  circuit breaker. Without `--fix` the unformatted evidence failed
  `code_quality`; with it, the working tree became untouchable. Both directions
  are dead, so the formatter must read neither tree: the three `vite.config`
  templates now declare `lint.ignorePatterns` and `fmt.ignorePatterns` for
  `.specify/**`, `specs/**/evidence/**` and `specs/**/designs/**` — the last
  because it is the golden the visual gate compares the implementation against.

  `install.sh` must not rewrite an existing config, so it now names both config
  defects for brownfield projects: the missing `ignorePatterns`, and
  `defineConfig` imported from `vite`, whose `UserConfigExport` declares none of
  `lint`, `fmt`, `check`, `test` or `run` — with `lint.options.typeCheck` on,
  that config fails its own gate with TS2769. The React template imports from
  `vite-plus`, which does declare them.

- **The repair loop's own bookkeeping was committed into the project's history.**
  The managed `.specify/.gitignore` covers only `feature.json` and the extension
  overrides, so `.repair-loop/` and `.circuit-breaker-state` were fully
  committable — and `bootstrap-project-env.sh` runs `git add .specify` on every
  repair iteration. A real run (`4-vanilla-web`) left **six** identical
  `chore: baseline specify tooling snapshot` commits whose entire content was the
  guard's snapshot/window files. They are authored by `spec-kit bootstrap` and
  say nothing, so the project's `git log` became a log of this tooling. Closed at
  three levels: `repair-loop-guard.sh` now writes its own `.gitignore` inside
  `.specify/.repair-loop/`, so the state stays untracked even if nothing else
  ran; `install.sh` appends a managed block to `.specify/.gitignore` covering
  `.repair-loop/`, `.circuit-breaker-state`, `workflows/runs/` and
  `telemetry.jsonl`; and the bootstrap commit uses an explicit pathspec so state
  cannot be staged even when the ignore files are missing.

  The same mechanism could hide a real change: the baseline commit also stages
  pending edits to `.gitignore`, `AGENTS.md`, `playwright.design.config.ts` and
  `tests/design/`, so in that run a genuine behavioural edit
  (`reuseExistingServer: !process.env.CI` -> `false`) landed under a `chore:`
  message and became invisible to the diff-based gates. The README now documents
  both the repetition and that hazard.

- **The quality gate's evidence named the gate but not the violation.**
  `quality-gate.json` recorded `"failed_step": "code_quality"` and nothing else,
  while `abort_unrepaired` told the operator to "inspect the evidence below" — so
  the only way to learn what to fix was to re-run the gate by hand. The gate now
  tees `vp check` output to a log it owns and records a `failure` block in the
  evidence: `step`, `exit_code`, `output` (bounded tail) and `output_file`, which
  points at the untruncated `quality-gate.log` written alongside. `failure` is
  excluded from the `history.jsonl` state comparison on purpose — its content
  drifts on every run (paths, line numbers, counts) without the gate's state
  changing, so including it would append a history line per execution and
  destroy the append-only-on-change contract.

- **A commit was invisible to the stall detector, producing false "no progress"
  verdicts.** The progress fingerprint hashed `git status` plus `git diff HEAD`,
  and BOTH are empty once the agent commits its work. A window that ended in a
  commit therefore looked byte-identical to a window that did nothing: a real run
  reported `REPAIR LOOP STALLED` after a 13-minute window that had actually fixed
  the bundle and the contracts, and the loop stopped right after its most
  productive iteration. The fingerprint now includes the tip SHA
  (`git rev-parse HEAD`), so advancing history counts as progress while a window
  that only rewrote `specs/*/evidence/**` still does not. Reproduced before the
  fix with a repository, a snapshot, a real edit and a commit.

  The stall message now states exactly what is measured — tree change or new
  commit, evidence rewrites excluded — instead of asserting the agent "changed
  nothing", and the abort banner says the same.


- **An untagged checkbox is now written by a script, not by the agent.** "Tick
  only after the gate passes" was prose, so an agent that swept every box at the
  end was indistinguishable from one that verified each task — and in a real run
  that is exactly what happened, including a task asking for the final commit.
  `scripts/mark-task-done.sh --id=T001` is now the only legitimate writer of an
  untagged task: it requires `status: "passed"` in `quality-gate.json`, and it
  refuses a **stale** pass (`find -newer`: a green gate that predates your last
  edit proves nothing about your last edit). It records each tick in
  `evidence/task-ticks.jsonl`, so a hand-edited box has no audit record and is
  distinguishable from a verified one. It also refuses to touch a `[verify:*]`
  task, which belongs to `reconcile-task-ledger.sh`.

- **A missing script silently disabled gates.** `check-quality-gate.sh` skipped
  the environment check with a warning when `check-env-config.sh` was absent, and
  `check-contracts.sh` did the same for ghost classes — invisible inside a
  30-minute window and indistinguishable from a pass. The environment check is
  now a hard failure (exit 2, reinstall), and `scripts/check-bundle-preflight.sh`
  verifies the installed bundle is complete before any agent time is spent:
  every script the installer ships, executable where required, plus node. A
  broken install now fails in seconds with the exact remediation commands instead
  of burning repair windows on a problem no edit can fix. It degrades to a
  warning when the checker itself is absent, so a workflow newer than its scripts
  cannot deadlock.

- **`scripts/check-env-config.sh` was not executable** in the bundle source.
  `install.sh` chmods the installed copy, so no run was affected, but the source
  disagreed with its own installer.

- **The verdict gate now says what to do.** A rejecting audit listed its blocking
  reasons and stopped there; the missing/unparseable/invalid-verdict branches had
  no next step either. All four now name the file, the expected shape and the
  command to resume.


- **A finished feature could never be reported as finished.** The task-ledger rules
  formed a deadlock by construction. `check-tasks-complete.sh` fails on any
  unchecked box. Both the guardrails and the repair prompt forbade ticking a box
  unless `check-quality-gate.sh` exits 0. That gate runs formatting, types,
  complexity, architecture, env config, the **whole** test suite and the build, so
  mid-feature it cannot pass: later tasks are not written yet. A compliant agent
  therefore ticked **nothing**, and by the time the work was done nobody went back.
  The run ended with every task implemented and the ledger empty, which drove
  `gate_tasks` to fail, re-entered the repair loop, and spent windows on
  bookkeeping. Polish and verification tasks were the worst case: their content
  *is* the gates, so they were only markable after the gates passed — the exact
  opposite of the order the workflow demanded.

  The per-task rule stays (a red gate is still your progress signal, and ticking
  on a red gate is still a fatal violation), but it is now stated together with
  what it implies: mid-feature the gate is **expected** to be red, so on the first
  full-gate success the agent must reconcile the ledger in one pass, printing
  `task id -> justification` for each tick and leaving unjustifiable ones
  unchecked with a reason. Polish/verification tasks are ticked only when the gate
  they describe actually passed.

  The rule was duplicated across the workflow prompt and six templates, none of
  which said the crucial part; `tests/task-ledger-protocol.test.ts` now pins the
  whole protocol in all seven copies so one edit cannot desynchronize the rest.
  `check-tasks-complete.sh` also names the missing reconciliation in its failure
  output, which is where the agent actually reads it.

  `tasks.md` now has **two owners**, which is the actual fix. Untagged tasks are
  implementation work: the agent ticks them after the **scoped** gate
  (`check-quality-gate.sh --scope=<slice>`), which is the only form that can be
  green mid-feature. Tasks tagged `[verify:<gate>]` are not the agent's at all —
  `scripts/reconcile-task-ledger.sh` ticks and **un-ticks** them from the evidence
  that gate wrote (`status: "passed"`), so a checkbox cannot keep claiming a
  verification that has since regressed. It runs before `gate_tasks` and before
  `recheck_tasks`, because judging an unreconciled ledger is what made a finished
  feature report as incomplete. An unknown tag is a hard error: a typo would
  otherwise disable a check while looking like coverage. `skipped` evidence counts
  as not passed, and untagged tasks are never modified.

  `check-tasks-complete.sh` now reports pending work split by owner
  (`implementation: N, gate-derived: M`) and names the red gate when a `[verify:*]`
  task is unchecked, instead of sending the reader to write code that already
  exists. Unticking from a removed gate is a separate concern from the prompt-level
  reconciliation kept for untagged work: that path stays as the fallback for a
  finished feature whose ledger was never touched.

### Added

- **A documented recovery path for a failed run.** The README explained the
  self-healing loops but never what to do once one gave up, while
  `abort_unrepaired` printed commands (`check-blast-radius.sh --reset
  --source=human`, then `specify workflow resume`) that appeared nowhere in it.
  Two new sections cover it: *Reading a Failed Run* — including that
  `failure_recorded` is the circuit breaker counting a failure, **not** a failing
  gate, and that `regression_tests: unreached` with `tests_executed: 0` means the
  suite never ran — and *Recovering from an Aborted Run*, with the gate-to-
  evidence-to-re-run table and the stalled-loop caveat (the fingerprint excludes
  `.specify/**` and `specs/*/evidence/**` by design).

- **The visual gate actually compares the implementation against the design master.**
  It never did. The design phase forbids shipping binary screenshots and declares
  `designs/<screen-id>.html` the master — correctly, because that is what Stitch
  returns — but the audit spec required `designs/<screen-id>.png`, so every screen
  hit `if (!fs.existsSync(goldenImagePath)) continue;` and the "visual layout
  matches Stitch golden screenshot" test passed having asserted **nothing**. A
  green badge for a comparison that never ran.

  `scripts/render-design-goldens.mjs` now derives the golden from the HTML on
  every run: same browser, same viewport from the manifest, same
  `DETERMINISTIC_RENDER_CSS` as the spec, same target selector (degrading to the
  full page when a screen's `data-testid` only exists in the app), same masks,
  `scale: 'css'`. Verified byte-for-byte against Playwright's own expectation:
  a `toHaveScreenshot` run using the generated golden passes. The HTML stays the
  committed master; the PNGs land in `tests/design/__snapshots__/`, which is now
  git-ignored, because a generated artifact must not compete with the master for
  authority and a stale golden would hide the regression the gate exists for.

  `verify-stitch-design.sh --calibrate` renders the references, forces tolerance
  0 and prints the real per-screen ratio without failing, so the tolerance is
  chosen from measured data instead of an inherited `0.05`. The ratio is also
  overridable at runtime via `SPECIFY_DESIGN_TOLERANCE`. `updateSnapshots: 'none'`
  in the design config makes a missing golden a hard failure rather than silently
  adopting the implementation as the new baseline.

  Two honesty fixes fell out of it: calibration now distinguishes "no pixel diff"
  from "the comparison never ran" (a navigation error or missing snapshot used to
  read as a match), and the renderer's entrypoint guard realpaths both sides —
  invoked through the macOS `/tmp` symlink it exited 0 having done nothing while
  the gate printed "Rendering golden references..." and produced none.

- **Repair windows and breaker resets are now measurable.** A real run needed
  three hours of triage because the two numbers that mattered were never written
  down. First, no `repair_agent` step event was ever recorded, so a repair phase
  of nearly three hours had no attribution at all — the decision between "the
  window is too long" and "there are too many windows" could not be made.
  Second, a circuit-breaker reset was logged as a bare `status: "reset"` with no
  origin, and a workflow iteration, a human following the abort message and an
  agent retrying are all the same `check-blast-radius.sh --reset` in the same
  work tree. A run showing 31 resets against a budget of 5 could not be
  explained, and any explanation was guesswork.

  Now `repair-loop-guard.sh --snapshot` records when the window opened and
  `--assess` emits a `repair_window` event with the elapsed time, labelled
  `--step=repair_agent` or `--step=verdict_repair_agent` so the two loops stay
  distinct. It is measured inside the guard rather than read back from the
  engine, because the engine never emitted the step event. Emission is
  best-effort: it cannot change the stall verdict or the step's exit code, which
  the `do-while` condition reads. And `check-blast-radius.sh --reset` takes
  `--source=` (`workflow` | `human` | anything else, sanitized), recorded in the
  event's `details` and defaulting to `unspecified` — which is how an
  agent-driven reset becomes visible after the fact. The abort message now tells
  the operator to pass `--source=human`, so the three origins separate
  themselves. The guard's own state and telemetry are excluded from the progress
  fingerprint, otherwise a tracked `.specify/` would make the detector compare
  its own output and never fire.

  Behaviour is deliberately unchanged: nothing forbids a reset yet. Prohibiting
  it before measuring would remove the baseline this instrumentation exists to
  capture. Guarded by 6 new cases in `tests/repair-loop-guard.test.ts`, 2 in
  `tests/check-blast-radius.test.ts` and new assertions in
  `tests/workflow-schema.test.ts`.

- **The self-healing loops now stop when a repair window changes nothing.**
  `repair_gates` (3 × 30 min) and `repair_verdict` (2 × 45 min) could previously
  spend their full budget re-proving the same failure: a gate that is genuinely
  not repairable by the loop — the offending file sits inside the blast-radius
  protected set, the gate itself is buggy, or the agent stalls — reproduces the
  identical failure on every attempt. `scripts/repair-loop-guard.sh --snapshot`
  records a fingerprint of the working tree at the start of each iteration and
  `--assess` compares it at the end; a new `assess_repair_progress` /
  `assess_verdict_progress` shell step feeds that verdict into the `do-while`
  condition, so a no-op window ends the loop instead of consuming the remaining
  attempts. `specs/*/evidence/**` is excluded from the fingerprint because every
  gate run rewrites it with a fresh timestamp (counting it would make the guard
  dead code), while `specs/*/designs/**` is deliberately **not** excluded because
  generating the design artifacts is a legitimate repair. Outside a git work tree
  the guard always allows the loop to continue, so it can never be the reason a
  run is blocked. `abort_unrepaired` reports the stall and the resume
  instructions instead of claiming three attempts were exhausted.
  Guarded by `tests/repair-loop-guard.test.ts` (14 cases) and by new assertions in
  `tests/workflow-schema.test.ts`.

### Fixed

- **A profile-only gate failure lost its deterministic handling.** The Spec Kit
  expression engine (`specify_cli/workflows/expressions.py`) is a hand-rolled
  splitter, not a Python/Jinja parser: it splits on top-level ` or `, then ` and `,
  then comparisons, and it has **no grouping support whatsoever**. A bracketed
  sub-expression never reaches a comparison operator, so it falls through to
  identifier resolution and evaluates to `False` — silently. `repair_gates`,
  `repair_gates_loop` and `fail_after_repair` all wrapped their profile guards in
  `( )`, which made `(not inputs.has_ui and steps.gate_runtime_check…)` and
  `(inputs.has_ui and steps.gate_contracts_check…)` permanently false.

  Scope, precisely: because the always-on clauses (`quality`, `bundle`, `tasks`)
  are unparenthesised and still work, the repair window kept opening normally
  whenever any of them also failed — which is the usual mid-implementation state,
  and why the agent was still seen repairing design fidelity and contracts from
  inside the window. The defect only bit when the profile gate was the **only**
  failing one: `repair_gates` skipped the window, and `fail_after_repair` skipped
  the abort, so the run fell through to `verify`. That is an LLM auditor which
  re-runs `check-contracts.sh --require-ui` and `verify-stitch-design.sh
  --require-ui` and hard-fails without a `pass` verdict, so no red UI shipped —
  but the deterministic gate layer stopped aborting for exactly the two gates
  this bundle exists to guarantee, and its verdict was delegated to a
  probabilistic backstop. The conditions are now parenthesis-free and rely on the
  documented `and`-binds-tighter-than-`or` precedence, with a comment at each
  site explaining why brackets are forbidden.
  `tests/workflow-expressions.test.ts` now evaluates all three conditions against
  the real evaluator for every gate × profile × progress combination (and asserts
  no `condition` contains brackets), which is the check that would have caught
  this: `toContain`-style assertions on the raw YAML string cannot.
- **The Vite+ pins no longer install two Vite copies.** `templates/package.json.tmpl`
  aliased `vite` to `npm:@voidzero-dev/vite-plus-core@^1.3.0` while `vite-plus` floated
  on `^1.3.0`. Those two packages version independently: `vite-plus@^1.3.0` resolves to
  1.8.0 (which bundles core `8.3.8001`) while the core caret resolves to the legacy
  1.6.0, so `npm install` silently added **both**. `vp` then refuses to boot with
  `Expected @voidzero-dev/vite-plus-core@X, but found vite@Y`, and two Vite instances
  break runtime identity checks across plugins. Verified with `npm install --dry-run`:
  the old pins emit `add vite 8.3.8001` *and* `add vite 1.6.0`; the new pins emit one.
  The template now pins the exact core version, repeats the **identical** spec in
  `overrides.vite` (npm aborts with `EOVERRIDE` otherwise) and pins
  `overrides.vitest`, so dependencies and the bundled runner share one Vitest.
  `@vitejs/plugin-react` moves to `^6.3.0`, whose peer range (`vite ^8.0.0`) actually
  matches the bundled core. `tests/toolchain-pins.test.ts` guards every rule.
- **The `npx` fallback for `vp` could never work.** `check-quality-gate.sh` fell back
  to `npx vite-plus vp`, but `vite-plus` ships three bins (`vp`, `vpr`, `vpx`), so npx
  fails with `could not determine executable to run` — verified. Any machine without a
  global `vp` or `node_modules/.bin/vp` therefore aborted the gate with exit 2. It now
  uses `npx -p vite-plus vp`.
- **Provisioned `dev`/`build` scripts were wrong outside a Vite SPA.** Both
  `install.sh` and `bootstrap-project-env.sh` injected `dev: "vp dev"` and
  `build: "vp build"` whenever the scripts were missing, regardless of the runtime.
  `vp dev` always starts the built-in Vite dev server and `vp build` always runs the
  built-in Vite build, both ignoring `package.json`. For a Next/Nuxt/Astro/Remix/
  SvelteKit project that is a guaranteed failure. Framework detection is now resolved
  once (config file first, declared framework dependency as the fallback) and drives
  the scripts: `next dev`/`next build`, `nuxt dev`/`nuxt build`, and so on. The `api`
  profile gets `dev: "npm run dev:api"` plus `build: "vp pack src/main.ts"` (tsdown,
  the documented library/executable build) instead of the Vite app build. The previous
  `vp run dev:api || npm run dev:api` chain is gone: `||` re-runs the script after a
  real failure and masks the exit code.
- **The installer provisioned scripts without the packages they run.** Only the React
  starter manifest shipped dependencies, and the reconcile path never added any, so a
  project could end up with `dev: "vp dev"` and no `vite-plus` — the quality gate then
  died with `Neither Vite+ 'vp' command nor 'npx' was found`. `install.sh` and
  `bootstrap-project-env.sh` now add what the scripts need, reading every version from
  `templates/package.json.tmpl` (single source of truth): `vite-plus`, `typescript`,
  `tsx` on the `api` profile, `@shadcn/lint` + `@vitejs/plugin-react` wherever the
  provisioned `vite.config.ts` imports them, `vitest` (pinned) when the declared test
  script uses it, and a plain `vite` range is rewritten to the core alias in
  `devDependencies` (Vite is a build tool, not a runtime dependency). The reconcile is
  idempotent: a second run rewrites nothing.
- **The four reference examples were not installable.** `examples/*/package.json`
  declared only `"test": "vitest run"` with no dependencies, so `npm install` was a
  no-op and every gate failed at the first tool it needed. Each archetype now declares
  its own runtime and toolchain: React + `@vitejs/plugin-react` for the SPA, `next` for
  the full-stack example (which also makes framework detection correct from the
  manifest alone), `tsx` + `vp pack` for the API, and the shared Vite+ pins everywhere.
- **The manifest reconciler is no longer JavaScript embedded in bash.** Both
  `install.sh` and `bootstrap-project-env.sh` carried the same ~150-line Node
  program inside a single-quoted `NODE_PKG_SCRIPT='...'` heredoc, invoked with
  four positional arguments. A single apostrophe in a JS comment terminated the
  shell string (hit while writing this very change, caught by `bash -n`), the
  call sites were unreadable, and none of the logic could be unit-tested. It now
  lives in `scripts/reconcile-package-manifest.mjs`, with named flags, a pure
  exported `reconcile()` and a CLI, covered by
  `tests/reconcile-package-manifest.test.ts` (10 cases). The installer ships the
  module to `.specify/scripts/bash/` so the per-task bootstrap resolves it next
  to itself.
  Two silent failures were found and fixed while extracting it: the entrypoint
  guard compared `path.resolve(argv[1])` against `import.meta.url`, which does
  not follow symlinks, so any symlinked checkout or `/tmp` invocation skipped
  reconciliation without a word (now `realpathSync` on both sides, with a
  symlink regression test); and an unparseable `package.json` used to be
  swallowed, now it is reported as an explicit warning.
- **The bundler-agnostic `vite.config.ts` did not parse.** Its header comment
  documented the absent UI boundary as `` `src/**/ui` ``, and the `**/` inside a
  `/** ... */` block comment closed it early. Every `vp` command on the `api` and
  `fullstack` profiles therefore died with
  `failed to load config from vite.config.ts` — before lint, types or tests ran.
  Reworded, plus `tests/template-config-syntax.test.ts` now parses every
  `vite.config*.ts.tmpl` with the TypeScript compiler and rejects a glob inside a
  comment. Verified end to end on the API profile: `vp pack src/main.ts` emits
  `dist/main.mjs`, which Node imports.
- **Starting from scratch ignored `--profile`.** With no `package.json`, the
  installer copied `templates/package.json.tmpl` — a React manifest — and skipped
  reconciliation entirely, so `--profile=api` produced an agnostic `vite.config.ts`
  next to `dev: "vp dev"`, `build: "vp build"`, React dependencies, Playwright and
  no `tsx`. `vp dev` starts the Vite dev server (it looks for a nonexistent
  `index.html`) and `vp build` builds a web app. The seed is now passed to the
  reconciler in `--seed` mode, which may retarget the scripts and prune the React
  surface (`react`, `react-dom`, `@types/react*`, `@vitejs/plugin-react`,
  `@shadcn/lint`) for any non-`react` profile, plus Playwright when the profile has
  no visual gate. Verified: empty directory + `--profile=api` now yields
  `dev:api`, `npm run dev:api`, `vp pack src/main.ts`, `tsx` and zero React.
- **A React seed survived a later framework change.** The reconciler refused to
  touch any script that already existed, but `vp dev` there was written by the
  bundle, not by a human. A script still holding a bundle default (`vp dev`,
  `vp build`, `npm run dev:api`, `vp pack …`, `vp test`) is now retargeted when the
  detected technology changes, and reported as
  `~ script dev "vp dev" -> "next dev" (bundle default, technology changed)`.
  Anything else is still untouchable. This is the common path for this bundle:
  install first, agent scaffolds Next/Nuxt afterwards.
- **`bootstrap-project-env.sh` no longer reports a cheerful "Nothing to do" from
  the wrong directory.** `ROOT` defaults to `$PWD`, so launching it from outside
  the project silently bootstrapped nothing. It now warns when `ROOT` has neither a
  `package.json` nor a `.specify/` directory.
- **`--profile=fullstack` seeded a React config after pruning React.** With no
  framework detected yet, the config selection fell through to the React template
  while the seed had just removed `@vitejs/plugin-react` and `@shadcn/lint` — a
  config importing packages that no longer exist. `fullstack` now always receives
  the agnostic config, which is what the README already promised.
- **`--profile` is documented.** It existed only in `install.sh --help`; the README
  now has an installer-options table and a "Starting from scratch" matrix showing
  the scripts, React surface and config each profile receives.
- **The vanilla profile no longer gets a React configuration.** `install.sh`
  provisioned `vite.config.ts.tmpl` for every non-framework Vite project, so a plain
  HTML/CSS/JS project imported `@vitejs/plugin-react` and enabled the shadcn component
  contract — two dependencies and a lint contract it never uses. The new
  `templates/vite.config.vanilla.ts.tmpl` keeps `typeCheck`, the complexity limits and
  the Clean Architecture boundaries, and is exported as a plain object so `vp check`
  still loads when `node_modules/` is absent. The reconcile step now adds
  `@vitejs/plugin-react` / `@shadcn/lint` only to the `react` profile. Verified end to
  end on `examples/4-vanilla-web`: 81 packages instead of 97, `vp v1.8.0`, `vp check`
  green after `--fix`.
- **The installer no longer plants `.npmrc` with `legacy-peer-deps=true`.** That flag
  is not a Vite+ requirement. It was compensating for `@vitejs/plugin-react@4`, whose
  peer range (`vite ^4 || ^5 || ^6`) could not match a core aliased to 8.x. With the
  aligned alias, `plugin-react@6` and the `vitest` pin, a freshly provisioned manifest
  resolves with **zero ERESOLVE** without it — verified by a real `npm install`
  (97 packages, `vp v1.8.0`, a single `@voidzero-dev/vite-plus-core@8.3.8001`).
  Writing that flag into every project also silenced genuine conflicts that deserve a
  human's attention; a brownfield tree that really conflicts should fail loudly and
  opt in per run with `npm install --legacy-peer-deps`.
- **Bootstrap and installer now guarantee baseline `package.json` scripts.**
  When running in a project with an existing `package.json` that lacked standard
  scripts (`dev`, `build`, `test`, `check-quality`, `verify-design`), the quality
  gates previously failed with missing script errors (e.g. Playwright failing to launch
  local dev server, or bundle check failing to build). `bootstrap-project-env.sh` and
  `install.sh` now safely inject missing baseline scripts and required UI devDependencies
  (`@playwright/test`, `@axe-core/playwright`) without overwriting user-defined scripts.
- **Untracked `.specify/` tooling files no longer trip blast radius violations.**
  When the bundle was installed into a repository that already had commits, untracked
  tooling assets (`.specify/scripts/**`, `extensions.yml`, `memory/`, `templates/`) were
  reported as unauthorized scope modifications by `check-blast-radius.sh`.
  `bootstrap-project-env.sh` now commits untracked tooling into a baseline snapshot
  commit (`chore: baseline specify tooling snapshot`) so diff-based gates start clean.
- **Repair loop resiliency and sandbox safety for telemetry logs.**
  `workflows/viteplus-stitch/workflow.yml` now runs `bootstrap-project-env.sh` during
  the `reset_breaker` phase of `repair_gates_loop`. The `repair_agent` prompt was hardened
  to direct agents to inspect telemetry via terminal (`emit-telemetry.sh --summary`) rather
  than attempting `read_file` on git-ignored `.specify/telemetry.jsonl` or run logs.
- **Reference example `examples/2-react-vite` now ships full starter dependencies.**
  `examples/2-react-vite/package.json` was upgraded from a bare skeleton to declare its
  full React, Vite+, and Playwright dependency tree and scripts.

- **The Regression Gate no longer misreads colourised or progress-aware test
  reports.** `count_executed_tests` matched `^[[:space:]]*Tests` against the raw
  log, so a colourised summary (`\033[2m      Tests \033[22m 15 passed (15)`) or a
  line glued to the previous one by a bare `\r` produced no match and the gate
  failed with *"could not determine how many tests were executed"* even though
  the suite ran and passed. The log is now ANSI-stripped and `\r`-normalised
  before counting, with an unanchored fallback and `node --test` (`# pass N`)
  support. The fail-closed contract is unchanged: an unparseable report still
  fails, it just stops failing for reports that were perfectly parseable.
- **The Regression Gate picks the right runner for API-only profiles.**
  `vite-plus` in `package.json` is now the criterion for using the built-in
  `vp test --run`, superseding the 2.0.0 heuristic that keyed the built-in on the
  absence of a framework config. A declared `test` script wins otherwise
  (`vp run test`, or `npm test --` without vp), and `vite.config.ts` is only a
  last-resort fallback.
  Previously the installer-provisioned `vite.config.ts` made every project look
  like a Vite app, so a plain `vite`/`vitest` API (the `has_ui=false` profile)
  was graded with `vp test`, which warns *"This project does not use vite-plus"*
  and is not the project's contract. Test runs also export `CI=1`, so a `"test":
  "vp test"` script (watch mode) can no longer hang the gate.

## [2.0.0] - 2026-11-24

### Changed — BREAKING

- **Non-UI features must declare a runtime contract.** With `has_ui=false`,
  `gate_runtime` runs `check-dev-entrypoint.sh --require-contract` and the run
  fails when `specs/<feature>/runtime.json` is missing. Domain/CLI features keep
  working by declaring `{"kind":"none","reason":"..."}`; they are not silently
  skipped anymore, they are recorded as `skipped` with their reason.
- **`templates/env.config.ts.tmpl` is now dual-runtime.** It used to read only
  `import.meta.env` (Vite/browser), which is `undefined` under Node, so a non-UI
  feature booting with `tsx src/main.ts` crashed on its first env read. It now
  reads the Vite surface and the Node surface behind explicit guards and
  normalises both into one typed object. Projects that copied the old template
  into an API must merge the Node branch (`globalThis.process?.env`).
- **The quality gates delegate to the declared scripts.** `vp build`, `vp test`
  and `vp dev` are Vite+ built-ins: they run the built-in Vite/Vitest commands and
  ignore `package.json`. Following the Vite+ rule (*check `package.json` and
  `vite.config.ts`, use `vp run <name>` when the project defines a script*), the
  Build Gate and the bundle-budget gate now use `vp run build` when a `build`
  script exists, and the Regression Gate uses `vp run test` when the project is not
  a Vite app. Previously a Next/Nuxt/Astro project was graded with `vite build`.

### Added

- `check-dev-entrypoint.sh` + `gate_runtime`: a non-UI feature must now prove its
  runtime actually starts and serves HTTP. The gate reads the feature's
  `specs/<feature>/runtime.json`, starts the declared command itself, probes the
  declared port and readiness path, and fails unless it gets a 2xx. A manual
  `tsx src/main.ts` that no contract declares is a red gate, not a workaround.
  Template: `.specify/templates/runtime.json.tmpl`.
- `gate_runtime` is wired into `repair_gates` (3 attempts) and `recheck_runtime`,
  and re-executed by the independent auditor (`AUDITOR.md`).
- `templates/vite.config.agnostic.ts.tmpl`: the installer now detects
  `next`/`nuxt`/`astro`/`remix`/`svelte` config files and provisions a Vite+ config
  without the React plugin, shadcn rules or UI layer boundaries. It is a plain
  object export so it loads without a local `vite-plus` install.
- Full-stack framework dev servers are valid runtimes: `next dev`, `nuxt dev`,
  `astro dev`, `remix dev`, `svelte-kit dev` and `vp run dev` are accepted when the
  readiness path is specific (`/api/health`), because those frameworks serve their
  own endpoints from the same dev server.

### Fixed

- `has_ui=false` no longer silently inherits the frontend `dev` script. Before
  this change a backend feature could pass every gate while `npm run dev` still
  booted Vite on 5173 and the API only lived behind a manual `tsx src/main.ts`.
  The workflow now instructs the agent to declare the API entrypoint as a NEW
  script (`dev:api`, `start:api`) and to record the contract in `runtime.json`,
  because `has_ui` describes the FEATURE, not the project: React, Vite and the
  project's own `dev` script stay untouched.
- The runtime gate requires an explicit `port` in `runtime.json` and never
  regex-guesses it from the typed env module: parsing `PORT` lines out of source
  code matched the `65535` of a validation message and probed the wrong port.
  Drift between `runtime.json` and `src/config/env.ts` now surfaces as a failed
  probe instead of a silent wrong-port success.
- `templates/playwright.design.config.ts.tmpl` hardcoded `localhost:5173` and
  `vp dev || npm run dev`. It now derives the port from `PLAYWRIGHT_TEST_BASE_URL`,
  then `PLAYWRIGHT_PORT`, then `PORT`, and launches `vp run dev || npm run dev`, so
  a Next/Nuxt/Astro app is audited on its real port.
- A project that merely *owns* a `vite.config.ts` is no longer assumed to run
  Vitest: the installer provisions that file for non-Vite frameworks too, so the
  Regression Gate keys the built-in `vp test` on the absence of a framework config
  instead. Otherwise a Next + Jest project would have run Vitest after installing.
- `bootstrap_env_early` now runs first, right after `guardrails`, instead of
  before `tasks`: until the project owns its repository every diff-based gate
  audits an ancestor repository, so waiting until mid-run left spec/plan/design
  exposed. The baseline commit uses `--allow-empty`, guaranteeing a `HEAD` for
  `git diff HEAD` even when nothing is staged.
- Each repair iteration now resets the circuit breaker before the agent runs, so
  attempt 3 is not consumed by `CIRCUIT BREAKER TRIPPED` and a resumed run does not
  start blocked. The breaker still stops runaway loops inside a task.
- The baseline commit no longer includes `.specify/workflows/runs/` or
  `.specify/telemetry.jsonl`: `state.json` stores the stdout/stderr of every
  prompt/command step, so the snapshot could commit agent transcripts.
- `has_ui=true` with `enable_stitch=false` skipped `generate-designs` entirely
  (its condition was `has_ui and enable_stitch`), so `critique-design` ran on
  nothing and the `--require-ui` gates failed with no artifacts. The step now
  runs for every UI feature and, without Stitch, generates local wireframes +
  `tokens.css` + `routes-manifest.json` + fixtures, which the workflow already
  allowed as fallback but never requested.
- The starter `package.json` did not declare `@axe-core/playwright`, so the WCAG
  test silently degraded to a DOM scan that does not check contrast. It now ships
  (`^4.14.0`) alongside `@playwright/test`.
- The starter `package.json` did not declare `@playwright/test`, so the visual gate
  could only run by letting `npx` fetch it. The dependency now ships with the
  template (`^1.65.1`); existing projects need `npm i -D @playwright/test` plus
  `npx playwright install --with-deps chromium`.
- The visual audit compared raw `tokens.css` declarations against DOM computed
  values, so any token alias (`--layout-gutter: var(--space-6)` -> `2rem`) could
  never match and the only way to pass was de-referencing the design source.
  `parseDesignTokens` now resolves `var()` chains (including fallbacks and cyclic
  guards) exactly like the browser.
- Telemetry provenance lied twice: `state.json` stores `step_config.model`
  verbatim when the resolved value is empty, so `"{{ inputs.model }}"` was
  recorded as a model name (now reported as `integration-default`, or `none` for
  shell steps), and roles were invisible because the run snapshot is written by
  `yaml.safe_dump` (`prompt: 'ROLE: ...'` / escaped newlines), which a
  line-oriented parser cannot read. Roles are now matched by character offset.
- `--summary` shows a `ROLE` column; `--state=<path>` implies `--import-state`.
- Scoped runs rejected the canonical env module: `check-env-config.sh` mandates
  `src/config/env.ts`, while `check-blast-radius.sh --scope` only exempted
  `src/shared` and `src/common`. Shared app-shell paths (`src/config`, `src/styles`,
  `src/main.*`, `src/App.*`, `src/index.*`) are now exempt, so the two gates no
  longer contradict each other.
- Untracked directories were reported by `git status` as a single collapsed entry
  (`?? src/features/`) and flagged as out-of-slice; both gates now scan with
  `--untracked-files=all`.
- The `vite.config.ts` template shipped `@vitejs/plugin-react` as a dependency but
  never registered it, so React Fast Refresh was dead. The plugin is now wired
  (`plugins: [react()]`) and the installer provisions `vite.config.ts` when the
  project has none (never overwriting an existing one).
- `bootstrap_env` only ran after `implement`, so per-task hooks could audit an
  ancestor repository during implementation. A new `bootstrap_env_early` step runs
  it before `tasks`.
- `install.sh` only injected hooks into an `extensions.yml` that had no gate
  hooks at all, so upgraded projects silently missed newly introduced hooks
  (`project-bootstrap`, `tasks-completion-gate`). Missing hooks are now inserted
  under their existing section, without duplicating YAML keys.
- `generate-designs` crashed mid-run with `unknown filter 'replace'` for features
  importing an existing Stitch project. The workflow expression engine only
  registers `default`, `join`, `map`, `contains` and `from_json`; project-ID
  normalization is now an instruction to the agent instead of a non-existent
  filter. A new suite (`tests/workflow-expressions.test.ts`) rejects unsupported
  filters statically and renders every workflow template with the real Spec Kit
  evaluator.

### Changed

- Telemetry provenance schema: `agent` is the integration process (`pi`, `claude`,
  `antigravity`), `model` is the AI model, and `subagent` is now the **assigned
  role/persona** (previously it held the integration). The `role` field is gone,
  `--agent` was added and `--role` is an alias of `--subagent`. Update any consumer
  that read `subagent` as the integration.
- **Gate integrity: a green signal is no longer accepted as proof.** A workflow
  previously completed with zero tests, a scaffold-only implementation and ghost
  UI selectors, because several gates were green by construction.
- `check-quality-gate.sh` now counts executed tests. Zero tests (or an
  unparseable report) fail the gate; `--allow-no-tests` is an explicit human
  opt-in that records `regression_tests: skipped`. `--passWithNoTests` is gone.
- `check-quality-gate.sh` and `check-blast-radius.sh` resolve the project root and
  refuse to run when `git rev-parse --show-toplevel` points at an ancestor
  repository (the `$HOME` trap). All git scans are scoped to the project root.
- `check-contracts.sh`: `--require-ui` implies `--check-orphans` and cross-checks
  every manifest selector against `src/`; ghost selectors fail the gate.
- `verify-stitch-design.sh`: `--tokens-only` is rejected together with
  `--require-ui`, writes `stitch-design-tokens.json` (never `stitch-design.json`)
  and marks `full_visual_verification: false`. The Playwright config/spec
  templates are resolved with their `.tmpl` suffix and fail with an actionable
  error instead of a confusing "no tests found".
- Evidence is append-only on state changes: each gate writes `<gate>.json` with
  the latest snapshot and appends to `<gate>.history.jsonl` only when the
  outcome changes (timestamp/`previous_status` excluded), so repeated identical
  runs no longer duplicate entries. Run frequency stays in `.specify/telemetry.jsonl`.
- The previous `auto_repair` loop only looked at quality/bundle, ran once, and its
  recheck steps swallowed exit codes with `|| true`, so its condition could never
  be true. Replaced by the loops above, whose rechecks propagate real exit codes.

### Added

- Shell gate events inherit the project default provenance instead of a bare
  `none`: the integration chosen at initialization (`.specify/integration.json`)
  and the concrete model recorded by the active run, falling back to
  `integration-default`. Explicit flags still win, and imported `step_execution`
  rows keep their exact values (shell/if steps remain `none`).
- `check-design-artifacts.sh` + `design_artifacts` step: a deterministic gate right
  after `generate-designs`. A prompt could "complete" without writing screens,
  `tokens.css` or the manifest, and the failure only appeared after implementation.
  It now fails in seconds with the exact missing list (`tokens.css`, `no_tokens`,
  `screens_html`, `routes-manifest.json:invalid`, missing fixtures).
- Telemetry provenance: every `.specify/telemetry.jsonl` record now carries the
  workflow `step`, the AI `model`, and the `subagent` (integration process) that
  executed it, with an explicit `none` when a field does not apply.
- `emit-telemetry.sh --import-state[=<path>]` folds every workflow step from the
  active run's `state.json` into the telemetry log as `step_execution` events,
  enriched with the step's `ROLE:` line (from the run's `workflow.yml` snapshot)
  and per-step durations from `log.jsonl`. Imports are idempotent (upsert).
- `telemetry_sync` workflow step imports the full run and prints the summary at
  the end of the lifecycle; gate-failure summaries import as well.
- `check-tasks-complete.sh`: completion gate for the `tasks.md` ledger, wired as
  the `gate_tasks` workflow step.
- `check-verification-verdict.sh`: machine verdict gate. The `verify` prompt must
  now write `evidence/verification.json`, and the `gate_verdict` step fails the
  workflow on `reject`, malformed or missing verdicts.
- Installer materializes `playwright.design.config.ts` and
  `design-audit.spec.ts` from their `.tmpl` sources and warns when the project is
  not its own git repository.
- `bootstrap-project-env.sh` + `bootstrap_env` workflow step: deterministic
  `git init` with an ignored-dependency baseline commit, and idempotent
  Playwright/design-audit template materialization. Several gate failures were
  never application bugs.
- **Bounded self-healing loops**: `repair_gates` (`do-while`, 3 attempts) covers
  every deterministic gate (quality, bundle, contracts, visual, tasks) and
  re-runs them after the repair agent; `abort_unrepaired` stops the run when the
  loop is exhausted. `repair_verdict` (2 attempts) handles a rejecting audit by
  repairing the reported reasons and triggering a full re-audit.
- `gate_verdict_final` is a hard shell step (no `continue_on_error`) so the
  workflow can no longer report success with a rejecting verdict.
- `templates/auditor.md` (installed as `.specify/workflows/viteplus-stitch/AUDITOR.md`)
  holds the audit checklist and verdict contract; the `verify` prompt references
  it, so the retry audit cannot drift from the first one.

### Changed

- `emit-telemetry.sh --summary` now prints `TIMESTAMP | STEP | MODEL | SUBAGENT |
  STATUS | DURATION | EXIT` and lists every imported workflow step, not only the
  gates that emitted an event. `--step`, `--role`, `--model` and `--subagent`
  flags (plus `SPECIFY_*` env fallbacks) attribute ad-hoc events.

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
- The release artifact no longer ships the development workspace. `specify bundle
  build` only excludes `.git`, `__pycache__` and `.DS_Store`, so building in place
  produced a 17 MB ZIP with 1261 `node_modules` files; `scripts/build-release.sh`
  now stages the shipped allow-list first (22 files, ~55 KB) and CI guards it.
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
