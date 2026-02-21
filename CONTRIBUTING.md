# Contributing

## Development setup
1. Use Node.js 18+.
2. Run `npm ci`.
3. Run `npm run lint` and `npm run test`.

## Pull request expectations
1. Keep changes scoped and focused.
2. Add or update docs when behavior changes.
3. Preserve backwards compatibility for task and agent JSON formats when practical.
4. Do not commit secrets.

## Release checklist
1. Update `CHANGELOG.md`.
2. Bump version in `package.json`.
3. Ensure CI passes.
