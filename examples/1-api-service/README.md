# Example 1: Backend API Service (`has_ui=false`)

Minimal reference implementation of a backend service using Clean Architecture vertical slices.

## Key Architectural Points
- **No UI Overhead**: Runs with `-i has_ui=false` to completely skip Stitch, Playwright visual gates, and ghost-class checks.
- **Clean Architecture Boundaries**: The domain layer (`src/features/auth/domain/`) has zero dependencies on application, infrastructure, or external libraries.
- **Typed Environment Guard**: `src/config/env.ts` validates `JWT_SECRET` centrally. Direct `process.env` access in feature code is strictly blocked.

## Running the Workflow for this Archetype

```bash
specify workflow run viteplus-stitch \
  -i spec="$(cat examples/1-api-service/spec.input.txt)" \
  -i scope="src/features/auth" \
  -i has_ui=false \
  -i auto_continue=true
```
