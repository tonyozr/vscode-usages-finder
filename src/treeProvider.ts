import * as vscode from 'vscode';
import { buildTree, flatten, GroupNode, TreeNode, UsageNode } from './grouping';
import { GroupLevel, KIND_LABELS, Usage, UsageKind } from './model';

const KIND_ICONS: Record<UsageKind, string> = {
  declaration: 'symbol-interface',
  definition: 'symbol-class',
  read: 'eye',
  write: 'edit',
  readWrite: 'arrow-swap',
  call: 'symbol-method',
  type: 'symbol-struct',
  other: 'circle-small',
};

const LEVEL_ICONS: Record<string, string> = {
  project: 'package',
  directory: 'folder',
  namespace: 'symbol-namespace',
  type: 'symbol-class',
  member: 'symbol-method',
  kind: 'symbol-event',
};

export class UsagesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  private roots: TreeNode[] = [];
  private parents = new Map<TreeNode, TreeNode | undefined>();
  private usageNodes = new Map<number, UsageNode>();
  private ids = new Map<TreeNode, string>();
  private ordered: Usage[] = [];
  private generation = 0;
  private shownUsages: readonly Usage[] = [];
  private levels: readonly GroupLevel[] = [];
  private expanded = true;

  get usages(): readonly Usage[] {
    return this.ordered;
  }

  get tree(): readonly TreeNode[] {
    return this.roots;
  }

  nodeFor(usage: Usage): UsageNode | undefined {
    return this.usageNodes.get(usage.id);
  }

  /** Replaces the displayed usages. A new generation resets the expansion state of all items. */
  update(usages: readonly Usage[], levels: readonly GroupLevel[], expanded: boolean): void {
    this.shownUsages = usages;
    this.levels = levels;
    this.expanded = expanded;
    this.generation++;
    this.roots = buildTree(usages, levels);
    this.parents.clear();
    this.usageNodes.clear();
    this.ids.clear();
    const visit = (nodes: TreeNode[], parent: TreeNode | undefined, prefix: string) => {
      nodes.forEach((n) => {
        this.parents.set(n, parent);
        const id = n.type === 'usage' ? `u${n.usage.id}` : `${prefix}/${n.level}:${n.key}`;
        this.ids.set(n, `${this.generation}|${id}`);
        if (n.type === 'usage') {
          this.usageNodes.set(n.usage.id, n);
        } else {
          visit(n.children, n, id);
        }
      });
    };
    visit(this.roots, undefined, '');
    this.ordered = flatten(this.roots);
    this.changed.fire();
  }

  expandAll(): void {
    this.update(this.shownUsages, this.levels, true);
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.roots;
    }
    return element.type === 'group' ? element.children : [];
  }

  getParent(element: TreeNode): TreeNode | undefined {
    return this.parents.get(element);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    return node.type === 'group' ? this.groupItem(node) : this.usageItem(node);
  }

  private groupItem(node: GroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    item.id = this.ids.get(node);
    item.description = `${node.description ? node.description + '  ' : ''}(${node.count})`;
    item.contextValue = 'group';
    if (node.level === 'file') {
      item.resourceUri = vscode.Uri.parse(this.firstUsage(node)?.uri ?? '');
      item.iconPath = vscode.ThemeIcon.File;
      item.label = node.label;
    } else {
      item.iconPath = new vscode.ThemeIcon(LEVEL_ICONS[node.level]);
    }
    return item;
  }

  private firstUsage(node: GroupNode): Usage | undefined {
    return flatten(node.children)[0];
  }

  private usageItem(node: UsageNode): vscode.TreeItem {
    const u = node.usage;
    const item = new vscode.TreeItem(
      { label: u.preview, highlights: [[u.previewStart, u.previewEnd]] },
      vscode.TreeItemCollapsibleState.None
    );
    item.id = this.ids.get(node);
    item.description = `${KIND_LABELS[u.kind]} · ${u.line + 1}:${u.startCol + 1}`;
    item.iconPath = new vscode.ThemeIcon(KIND_ICONS[u.kind]);
    item.contextValue = 'usage';
    const container = [u.namespace, u.type, u.member].filter(Boolean).join(' › ');
    // File paths and symbol names come from the workspace: append them as escaped text, never as markdown.
    const tooltip = new vscode.MarkdownString()
      .appendMarkdown(`**${KIND_LABELS[u.kind]}**  \n`)
      .appendText(`${u.relPath}:${u.line + 1}:${u.startCol + 1}`);
    if (container) {
      tooltip.appendMarkdown('  \n').appendText(container);
    }
    item.tooltip = tooltip;
    item.command = { command: 'usagesFinder.open', title: 'Open Usage', arguments: [u] };
    return item;
  }
}
