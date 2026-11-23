import * as vscode from 'vscode';
import { findUsages, SearchResult } from './finder';
import { filterUsages, formatAsText, normalizeLevels, TreeNode } from './grouping';
import {
  Access,
  ACCESS_LABELS,
  ALL_KINDS,
  Filters,
  GroupLevel,
  GROUP_LEVELS,
  GROUP_LEVEL_LABELS,
  KIND_LABELS,
  Scope,
  SCOPES,
  SCOPE_LABELS,
  Usage,
  UsageKind,
} from './model';
import { UsagesTreeProvider } from './treeProvider';

const LEVELS_KEY = 'usagesFinder.groupBy';

/** Workspace settings are not validated against the schema: guard against 0, negatives, NaN and strings. */
function sanitizeMaxResults(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 5000;
}

interface FindPreset {
  kinds?: UsageKind[];
  access?: Access;
}

export class UsagesController implements vscode.Disposable {
  private readonly provider = new UsagesTreeProvider();
  private readonly view: vscode.TreeView<TreeNode>;
  private result: SearchResult | undefined;
  private levels: GroupLevel[];
  private kinds: Set<UsageKind>;
  private scope: Scope;
  private access: Access = 'all';
  private text = '';
  private current = -1;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.levels = this.initialLevels();
    this.kinds = this.defaultKinds();
    this.scope = this.defaultScope();

    this.view = vscode.window.createTreeView('usagesFinder.results', {
      treeDataProvider: this.provider,
      showCollapseAll: true,
    });
    this.disposables.push(
      this.view,
      this.view.onDidChangeSelection((e) => {
        const node = e.selection[0];
        if (node?.type === 'usage') {
          this.current = this.provider.usages.indexOf(node.usage);
        }
      })
    );
    this.render();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  private config() {
    return vscode.workspace.getConfiguration('usagesFinder');
  }

  private initialLevels(): GroupLevel[] {
    const stored = this.context.workspaceState.get<GroupLevel[]>(LEVELS_KEY);
    return normalizeLevels(stored ?? this.config().get<GroupLevel[]>('groupBy', ['project', 'file']));
  }

  private defaultKinds(): Set<UsageKind> {
    const configured = this.config().get<UsageKind[]>('visibleKinds', [...ALL_KINDS]);
    return new Set(configured.filter((k) => ALL_KINDS.includes(k)));
  }

  private defaultScope(): Scope {
    const scope = this.config().get<Scope>('scope', 'workspace');
    return SCOPES.includes(scope) ? scope : 'workspace';
  }

  // ----- searching -----

  async find(uri?: vscode.Uri, position?: vscode.Position, preset: FindPreset = {}): Promise<void> {
    if (!uri || !position) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a file and place the cursor on a symbol first.');
        return;
      }
      uri = editor.document.uri;
      position = editor.selection.active;
    }
    this.kinds = preset.kinds ? new Set(preset.kinds) : this.defaultKinds();
    this.access = preset.access ?? 'all';
    this.scope = this.defaultScope();
    this.text = '';
    await this.search(uri, position);
  }

  async refresh(): Promise<void> {
    if (this.result) {
      await this.search(this.result.uri, this.result.position);
    } else {
      await this.find();
    }
  }

  private async search(uri: vscode.Uri, position: vscode.Position): Promise<void> {
    const config = this.config();
    const outcome = await vscode.window.withProgress(
      { location: { viewId: 'usagesFinder.results' }, title: 'Finding usages...', cancellable: true },
      (_progress, token) =>
        findUsages(
          uri,
          position,
          {
            maxResults: sanitizeMaxResults(config.get<number>('maxResults', 5000)),
            includeDeclarations: config.get<boolean>('includeDeclarations', true),
            projectMarkers: config.get<string[]>('projectMarkers', []),
          },
          token
        )
    );
    if (!outcome) {
      vscode.window.showInformationMessage('No symbol found at the cursor, or the search was cancelled.');
      return;
    }
    this.result = outcome;
    this.current = -1;
    this.render();
    await vscode.commands.executeCommand('usagesFinder.results.focus');
    if (outcome.usages.length === 0) {
      vscode.window.showInformationMessage(
        `No usages of '${outcome.symbolName}' found. The language server may still be indexing.`
      );
    } else if (outcome.truncated) {
      vscode.window.showWarningMessage(
        `Only the first ${outcome.usages.length} usages are shown. Increase 'usagesFinder.maxResults' to see more.`
      );
    }
  }

  // ----- rendering -----

  private filters(): Filters {
    return { kinds: this.kinds, access: this.access, scope: this.scope, text: this.text };
  }

  private render(expanded = this.config().get<boolean>('expandResults', true)): void {
    const result = this.result;
    void vscode.commands.executeCommand('setContext', 'usagesFinder.hasResults', !!result);
    void vscode.commands.executeCommand('setContext', 'usagesFinder.access', this.access);
    if (!result) {
      this.provider.update([], this.levels, expanded);
      this.view.message = undefined;
      this.view.description = undefined;
      return;
    }
    const shown = filterUsages(result.usages, this.filters(), result.origin);
    this.provider.update(shown, this.levels, expanded);
    this.current = -1;

    const files = new Set(shown.map((u) => u.path)).size;
    const active: string[] = [];
    if (this.kinds.size !== ALL_KINDS.length || ALL_KINDS.some((k) => !this.kinds.has(k))) {
      active.push(`kinds: ${ALL_KINDS.filter((k) => this.kinds.has(k)).map((k) => KIND_LABELS[k]).join(', ') || 'none'}`);
    }
    if (this.access !== 'all') {
      active.push(`showing: ${ACCESS_LABELS[this.access]}`);
    }
    if (this.scope !== 'workspace') {
      active.push(`scope: ${SCOPE_LABELS[this.scope].toLowerCase()}`);
    }
    if (this.text.trim()) {
      active.push(`text: ${this.text.trim()}`);
    }
    this.view.description = `'${result.symbolName}'`;
    const summary = `${shown.length} usage${shown.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`;
    const filtered = shown.length !== result.usages.length ? ` (of ${result.usages.length})` : '';
    this.view.message = `${summary}${filtered}${active.length ? ' — ' + active.join('; ') : ''}`;
  }

  // ----- filters and grouping -----

  async pickGroupBy(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      GROUP_LEVELS.map((level) => ({
        label: GROUP_LEVEL_LABELS[level],
        level,
        picked: this.levels.includes(level),
      })),
      {
        canPickMany: true,
        title: 'Group usages by',
        placeHolder: 'Selected levels are nested in the order shown. Select none for a flat list.',
      }
    );
    if (picked) {
      this.levels = normalizeLevels(picked.map((p) => p.level));
      await this.context.workspaceState.update(LEVELS_KEY, this.levels);
      this.render();
    }
  }

  async pickKinds(): Promise<void> {
    const counts = new Map<UsageKind, number>();
    for (const u of this.result?.usages ?? []) {
      counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
    }
    const picked = await vscode.window.showQuickPick(
      ALL_KINDS.map((kind) => ({
        label: KIND_LABELS[kind],
        description: String(counts.get(kind) ?? 0),
        usageKind: kind,
        picked: this.kinds.has(kind),
      })),
      { canPickMany: true, title: 'Show usage kinds' }
    );
    if (picked) {
      this.kinds = new Set(picked.map((p) => p.usageKind));
      this.render();
    }
  }

  async pickScope(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      SCOPES.map((scope) => ({ label: SCOPE_LABELS[scope], scope, picked: scope === this.scope })),
      { title: 'Search scope' }
    );
    if (picked) {
      this.scope = picked.scope;
      this.render();
    }
  }

  async pickText(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: 'Filter usages by text',
      prompt: 'Matches code, path, namespace, type and member. Use /regex/ for a regular expression. Empty clears.',
      value: this.text,
    });
    if (value !== undefined) {
      this.text = value;
      this.render();
    }
  }

  toggleAccess(access: Exclude<Access, 'all'>): void {
    this.access = this.access === access ? 'all' : access;
    this.render();
  }

  resetFilters(): void {
    this.kinds = this.defaultKinds();
    this.access = 'all';
    this.scope = this.defaultScope();
    this.text = '';
    this.render();
  }

  expandAll(): void {
    this.provider.expandAll();
  }

  clear(): void {
    this.result = undefined;
    this.render();
  }

  // ----- navigation -----

  /** True when `usage` is one of the usages currently shown in the tree. */
  isKnownUsage(usage: Usage | undefined): usage is Usage {
    return !!usage && this.provider.usages.includes(usage);
  }

  async open(usage: Usage, options: { toSide?: boolean; preserveFocus?: boolean } = {}): Promise<void> {
    this.current = this.provider.usages.indexOf(usage);
    const range = new vscode.Range(usage.line, usage.startCol, usage.endLine, usage.endCol);
    await vscode.window.showTextDocument(vscode.Uri.parse(usage.uri), {
      selection: range,
      preview: true,
      preserveFocus: options.preserveFocus ?? true,
      viewColumn: options.toSide ? vscode.ViewColumn.Beside : undefined,
    });
  }

  async step(direction: 1 | -1): Promise<void> {
    const usages = this.provider.usages;
    if (usages.length === 0) {
      return;
    }
    const next =
      this.current < 0
        ? direction === 1
          ? 0
          : usages.length - 1
        : (this.current + direction + usages.length) % usages.length;
    const usage = usages[next];
    await this.open(usage, { preserveFocus: false });
    const node = this.provider.nodeFor(usage);
    if (node) {
      try {
        await this.view.reveal(node, { select: true, focus: false });
      } catch {
        // The tree may have been rebuilt in the meantime.
      }
      this.current = next;
    }
  }

  copyResults(): Thenable<void> {
    return vscode.env.clipboard.writeText(formatAsText(this.provider.tree));
  }

  copyUsage(usage: Usage): Thenable<void> {
    return vscode.env.clipboard.writeText(usage.preview);
  }
}
