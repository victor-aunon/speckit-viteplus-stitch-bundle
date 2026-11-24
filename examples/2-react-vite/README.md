# Example 2: Client React + Vite+ SPA (`has_ui=true`)

Minimal reference implementation of a client-side React SPA featuring Google Stitch design tokens and component contracts.

## Key Architectural Points
- **Full UI Governance**: Runs with `has_ui=true` and Stitch design tokens.
- **Strict Design Token Consistency**: `specs/habits/designs/tokens.css` defines the canonical design tokens consumed by UI components.
- **Route Contracts & Fixtures**: Declares routes in `routes-manifest.json` backed by JSON fixtures in `fixtures/habits.json`.
- **Atomic Design**: Exactly one component per file (`HabitCard.tsx`).

## Running the Workflow for this Archetype

```bash
specify workflow run viteplus-stitch \
  -i spec="$(cat examples/2-react-vite/spec.input.txt)" \
  -i scope="src/features/habits" \
  -i has_ui=true \
  -i auto_continue=true
```
