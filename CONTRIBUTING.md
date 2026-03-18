# Contributing to Clawd Office

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/fwartner/clawd-office.git
cd clawd-office
npm install
npm run dev
```

The dev server starts at `http://localhost:4173`.

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

Use the [bug report template](https://github.com/fwartner/clawd-office/issues/new?template=bug_report.yml).

## Suggesting Features

Use the [feature request template](https://github.com/fwartner/clawd-office/issues/new?template=feature_request.yml).
