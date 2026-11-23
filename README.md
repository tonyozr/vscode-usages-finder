# Usages Finder

Find usages of a symbol with read/write classification, usage-kind filters, scopes and multi-level grouping. Built with C/C++ in mind (clangd), but works with any language whose extension provides references.

## Features

- **Find Usages** (`Usages: Find Usages`) shows results in a dedicated *Usages* panel view.
- **Read / write classification**: each usage is a declaration, definition, read, write, read/write, call, type reference or other.
- **Quick filters**: toolbar buttons to show only reads or only writes (read/write usages count as both). Also available as `Find Usages: Reads Only` / `Writes Only`.
- **Filter by usage kind**, **text** (plain or `/regex/`) and **scope** (workspace, project, directory, file).
- **Grouping** by project, directory, file, namespace, type, member and usage kind, nested in that order.
- Next/previous navigation, open to the side, copy results.

## Requirements

A language server that provides references, declarations and document symbols. For C/C++ use the [clangd](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd) extension with a `compile_commands.json`, and disable IntelliSense of the Microsoft C/C++ extension to avoid conflicts.

Read/write detection combines the language server's document highlights with text heuristics (assignments, `++`/`--`, `&x`), so it is a best-effort classification.

## Settings

All settings are under `usagesFinder.*` (group-by levels, visible kinds, default scope, max results, project markers, ...). See the *Settings* UI.

## Development

```sh
npm ci
npm test            # compile and run unit tests
npm run build       # package into dist/*.vsix
npm run install:local
```

Press F5 to run the extension in an Extension Development Host.

## Releasing

CI builds and tests every push and pull request and uploads the `.vsix` as a workflow artifact. To release, bump `version` in `package.json`, update `CHANGELOG.md`, commit, then push a tag `vX.Y.Z`. The release workflow checks the tag against `version`, builds, creates a GitHub release with the `.vsix` and, when the `VSCE_PAT` repository secret is set, publishes to the VS Code Marketplace.

## License

[MIT](LICENSE)