# Example 2: Client React + Vite+ SPA (`has_ui=true`)

Minimal reference workspace demonstrating how to run the `viteplus-stitch` workflow for a client-side React SPA with Google Stitch tokens and Atomic Design.

## Key Architectural Points
- **Full UI Governance (`has_ui=true`)**: Executes Stitch design token extraction, Impeccable accessibility critique, and Playwright verification.
- **Strict Design Token Consistency**: `tokens.css` defines the canonical design tokens consumed by UI components.
- **Atomic Design**: Enforces exactly one component per file.

## Running the Workflow in this Folder

From this directory (`examples/2-react-vite/`):

```bash
# 1. Install the workflow bundle from the project root
bash ../../scripts/install.sh

# 2. Run the workflow with the high-leverage spec
specify workflow run viteplus-stitch \
  -i spec="$(cat spec.input.txt)" \
  -i scope="src/features/habits" \
  -i has_ui=true \
  -i auto_continue=true
```
