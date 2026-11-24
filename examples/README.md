# Reference Architecture Examples

This directory contains 4 minimal, self-contained reference examples demonstrating how the **`viteplus-stitch`** workflow executes across different architectural archetypes:

| Archetype | Focus | UI Mode | Key Validation |
|---|---|:---:|---|
| [**1. API Service**](./1-api-service/) | Backend / REST API | `has_ui=false` | Clean Architecture vertical slices, typed env config, zero UI gates. |
| [**2. React + Vite+**](./2-react-vite/) | Client SPA | `has_ui=true` | Google Stitch design tokens (`tokens.css`), routes-manifest, Atomic Design. |
| [**3. Next.js App**](./3-nextjs-app/) | Fullstack App Router | `has_ui=true` | Scoped route pages, env isolation, component contracts. |
| [**4. Vanilla Web**](./4-vanilla-web/) | Raw HTML + CSS + JS | `has_ui=true` | Zero-framework modern web, CSS custom properties, Ghost Classes compliance. |

---

## How to Test Each Example

You can inspect the minimal files in each folder or run the workflow against any of them using the one-line commands in their respective `README.md`.

All 4 examples are continuously verified by the project test suite in `tests/examples-integrity.test.ts`.
