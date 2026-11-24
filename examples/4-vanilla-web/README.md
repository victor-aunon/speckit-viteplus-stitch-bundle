# Example 4: Zero-Framework Vanilla Web (`has_ui=true`)

Minimal reference implementation of modern, framework-free web components (HTML5 `<dialog>`, CSS Custom Properties, ES Modules).

## Key Architectural Points
- **Zero-Framework Web Standards**: Uses native browser primitives (`HTMLDialogElement`, Web Components, ES Modules) with zero client runtime dependencies.
- **Strict Ghost Classes Compliance**: Every CSS class referenced in scripts or markup is statically verified against `src/styles/dialog.css` using `check-ghost-classes.sh`.
- **Centralized Environment Isolation**: Environment variables are validated through `src/config/env.ts` without direct `process.env` leaks.
- **Hardware-Accelerated Accessible Motion**: Respects `@media (prefers-reduced-motion: reduce)` on all CSS transitions.

## Running the Workflow for this Archetype

```bash
specify workflow run viteplus-stitch \
  -i spec="$(cat examples/4-vanilla-web/spec.input.txt)" \
  -i scope="src/features/dialog" \
  -i has_ui=true \
  -i auto_continue=true
```
