# Example 3: Next.js App Router Project (`has_ui=true`)

Minimal reference workspace demonstrating how to run the `viteplus-stitch` workflow for a Next.js App Router project.

## Key Architectural Points
- **App Router Structure**: Follows Next.js conventions (`src/app/<route>/page.tsx`).
- **Centralized Environment Isolation**: Server and client environment variables are validated through `src/config/env.ts`. Direct `process.env` in pages or components is blocked by `check-env-config.sh`.
- **Scoped Execution**: Allows running Spec Kit with `--scope=src/app/pricing` to target only the pricing slice without triggering gates on the rest of the Next.js app.

## Running the Workflow in this Folder

From this directory (`examples/3-nextjs-app/`):

```bash
# 1. Install the workflow bundle from the project root
bash ../../scripts/install.sh

# 2. Run the workflow with the high-leverage spec
specify workflow run viteplus-stitch \
  -i spec="$(cat spec.input.txt)" \
  -i scope="src/app/pricing" \
  -i has_ui=true \
  -i auto_continue=true
```
