# Contributing to Agent Office

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/fwartner/agent-office.git
cd agent-office
npm install    # runs the setup wizard automatically
npm run dev
```

The setup wizard guides you through backend and configuration choices. The dev server starts at `http://localhost:4173`.

To re-run setup: `npm run setup:force`

## Making Changes

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run `npm test` and `npm run build` to verify
4. Open a pull request against `main`

## Code Style

- TypeScript strict mode — no `any` types
- Functional React components with hooks
- CSS in `src/styles.css` — no CSS-in-JS
- Pixel-art aesthetic — keep the retro theme consistent

## Testing

```bash
npm test            # run all tests
npm run test:watch  # watch mode
npm run typecheck   # type checking only
```

All new features should include tests. Tests live in `src/__tests__/` (component/unit) and `tests/` (API/integration).

## Commit Messages

Use concise, descriptive messages:

- `fix: correct agent presence after room change`
- `feat: add agent CRUD endpoints`
- `test: add accessibility assertions`

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Fill in the PR template
- Ensure CI passes before requesting review
- Include screenshots for UI changes

## Reporting Bugs

Use the [bug report template](https://github.com/fwartner/agent-office/issues/new?template=bug_report.yml).

## Suggesting Features

Use the [feature request template](https://github.com/fwartner/agent-office/issues/new?template=feature_request.yml).

## Maintainer

**Florian Wartner** — [Pixel & Process](https://pixelandprocess.de)
Email: [florian@wartner.io](mailto:florian@wartner.io)
