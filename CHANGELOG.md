# Changelog

## 0.1.4

- Clicking a group now goes to the symbol it stands for: a file group opens the file, namespace / type / member groups jump to that symbol's declaration. Groups without a location (project, directory, usage kind, or symbols the language server did not report) do nothing.

## 0.1.3

- Clicking a file / type / any group opens its first usage instead of expanding or collapsing it; expanding happens only via the arrow (the extension sets `workbench.tree.expandMode` to `doubleClick` by default).

## 0.1.2

- Results appear as soon as references are found: namespace / type / member are resolved in the background, without blocking the list (opening every file in the language server made the search much slower than Find References).
- Reference, definition and declaration lookups run in parallel.
- Fix namespace / type / member missing for usages inside namespaces (nested document symbols were ignored).

## 0.1.1

- Fix packaging on a clean checkout (`dist/` is created before `vsce package`).
- Escape file paths and symbol names in usage tooltips.
- Ignore invalid arguments to the internal open command and invalid `usagesFinder.maxResults` values.
- Release workflow: expose the Marketplace token only to the publish step; do not persist checkout credentials.

## 0.1.0

- Initial release: find usages with read/write classification, usage-kind filters, scopes, text filter and multi-level grouping.
- Quick Reads / Writes toggle buttons in the view toolbar.
