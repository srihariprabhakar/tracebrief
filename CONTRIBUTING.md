# Contributing

Thanks for helping make operational AI more inspectable.

## Local workflow

1. Use Node.js 24 or newer.
2. Run `npm test` before opening a change.
3. Start the app with `npm run dev` and exercise both the synthetic bundle and a small upload.

## Parser and rule changes

- Preserve original source names and line numbers.
- Never persist raw secrets in a test fixture or snapshot.
- Every emitted fact or hypothesis must have at least one resolving citation.
- Prefer a calculation or cross-source correlation over a broad keyword match.
- Add a synthetic fixture and a focused test for every new failure family.

## Commit style

Short, imperative commit subjects are easiest to scan. Explain security-boundary changes in the commit body.
