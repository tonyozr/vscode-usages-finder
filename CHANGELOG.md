# Changelog

## 0.1.1

- Fix packaging on a clean checkout (`dist/` is created before `vsce package`).
- Escape file paths and symbol names in usage tooltips.
- Ignore invalid arguments to the internal open command and invalid `usagesFinder.maxResults` values.
- Release workflow: expose the Marketplace token only to the publish step; do not persist checkout credentials.

## 0.1.0

- Initial release: find usages with read/write classification, usage-kind filters, scopes, text filter and multi-level grouping.
- Quick Reads / Writes toggle buttons in the view toolbar.
