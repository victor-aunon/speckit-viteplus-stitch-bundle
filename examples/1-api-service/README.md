# Example 1: Backend API Service (`has_ui=false`)

Minimal reference workspace demonstrating how to run the `viteplus-stitch` workflow for a backend service using Clean Architecture vertical slices.

## Key Architectural Points
- **No UI Overhead (`has_ui=false`)**: Completely skips Google Stitch, Playwright visual gates, route contracts, and ghost-class checks.
- **Clean Architecture Boundaries**: Enforces strict layer isolation under `src/features/auth/{domain,application,infrastructure}`.
- **Typed Environment Guard**: `src/config/env.ts` validates `JWT_SECRET` centrally. Direct `process.env` access in feature code is strictly blocked.

## Running the Workflow in this Folder

From this directory (`examples/1-api-service/`):

```bash
# 1. Install the workflow bundle from the project root
bash ../../scripts/install.sh

# 2. Run the workflow with the high-leverage spec
specify workflow run viteplus-stitch \
  -i spec="$(cat spec.input.txt)" \
  -i scope="src/features/auth" \
  -i has_ui=false \
  -i auto_continue=true
```
