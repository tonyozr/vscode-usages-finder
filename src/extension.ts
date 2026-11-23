import * as vscode from 'vscode';
import { UsagesController } from './controller';
import { TreeNode } from './grouping';
import { Usage } from './model';

export function activate(context: vscode.ExtensionContext): void {
  const controller = new UsagesController(context);
  const reg = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  const usageOf = (node: TreeNode | undefined) => (node?.type === 'usage' ? node.usage : undefined);

  reg('usagesFinder.find', (uri?: vscode.Uri, position?: vscode.Position) => controller.find(uri, position));
  reg('usagesFinder.findReads', () => controller.find(undefined, undefined, { access: 'read' }));
  reg('usagesFinder.findWrites', () => controller.find(undefined, undefined, { access: 'write' }));
  // The "active" variants only differ by icon, so the toolbar button reflects the toggle state.
  for (const id of ['filterReads', 'filterReadsActive']) {
    reg(`usagesFinder.${id}`, () => controller.toggleAccess('read'));
  }
  for (const id of ['filterWrites', 'filterWritesActive']) {
    reg(`usagesFinder.${id}`, () => controller.toggleAccess('write'));
  }
  reg('usagesFinder.refresh', () => controller.refresh());
  reg('usagesFinder.groupBy', () => controller.pickGroupBy());
  reg('usagesFinder.filterKinds', () => controller.pickKinds());
  reg('usagesFinder.setScope', () => controller.pickScope());
  reg('usagesFinder.filterText', () => controller.pickText());
  reg('usagesFinder.resetFilters', () => controller.resetFilters());
  reg('usagesFinder.expandAll', () => controller.expandAll());
  reg('usagesFinder.next', () => controller.step(1));
  reg('usagesFinder.previous', () => controller.step(-1));
  reg('usagesFinder.copyResults', () => controller.copyResults());
  reg('usagesFinder.clear', () => controller.clear());
  // Internal command used by tree items; ignore calls without a usage from the current results.
  reg('usagesFinder.open', (usage?: Usage) => (controller.isKnownUsage(usage) ? controller.open(usage) : undefined));
  reg('usagesFinder.openToSide', (node: TreeNode) => {
    const usage = usageOf(node);
    return usage && controller.open(usage, { toSide: true, preserveFocus: false });
  });
  reg('usagesFinder.copyUsage', (node: TreeNode) => {
    const usage = usageOf(node);
    return usage && controller.copyUsage(usage);
  });

  context.subscriptions.push(controller);
}

export function deactivate(): void {}
