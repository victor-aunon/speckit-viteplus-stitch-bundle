# Example 4: Zero-Framework Vanilla Web (`has_ui=true`)

Minimal reference workspace demonstrating how to run the `viteplus-stitch` workflow for modern, framework-free web components (HTML5 `<dialog>`, CSS Custom Properties, ES Modules).

## Key Architectural Points
- **Zero-Framework Web Standards**: Uses native browser primitives (`HTMLDialogElement`, Web Components, ES Modules) with zero client runtime dependencies.
- **Strict Ghost Classes Compliance**: Every CSS class referenced in scripts or markup is statically verified against project stylesheets using `check-ghost-classes.sh`.
- **Centralized Environment Isolation**: Environment variables are validated through `src/config/env.ts` without direct `process.env` leaks.
- **Hardware-Accelerated Accessible Motion**: Respects `@media (prefers-reduced-motion: reduce)` on all CSS transitions.

## Running the Workflow in this Folder

From this directory (`examples/4-vanilla-web/`):

```bash
# 1. Install the workflow bundle from the project root
bash ../../scripts/install.sh

# 2. Run the workflow with the high-leverage spec
specify workflow run viteplus-stitch \
  -i spec="$(cat spec.input.txt)" \
  -i scope="src/features/dialog" \
  -i has_ui=true \
  -i auto_continue=true
```
