# Example 3: Next.js App Router Project (`has_ui=true`)

Minimal reference implementation of a Next.js App Router feature.

## Key Architectural Points
- **App Router Structure**: Follows Next.js conventions (`src/app/<route>/page.tsx`).
- **Centralized Environment Isolation**: Server and public environment variables are validated through `src/config/env.ts`. Direct `process.env` in pages or components is blocked by `check-env-config.sh`.
- **Scoped Execution**: Allows running Spec Kit with `--scope=src/app/pricing` to target only the pricing slice without triggering gates on the rest of the Next.js app.

## Running the Workflow for this Archetype

```bash
specify workflow run viteplus-stitch \
  -i spec="$(cat examples/3-nextjs-app/spec.input.txt)" \
  -i scope="src/app/pricing" \
  -i has_ui=true \
  -i auto_continue=true
```
