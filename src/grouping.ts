import {
  ACCESS_KINDS,
  ALL_KINDS,
  Filters,
  GroupLevel,
  GROUP_LEVELS,
  KIND_LABELS,
  Origin,
  Usage,
} from './model';

export interface GroupNode {
  type: 'group';
  level: GroupLevel;
  key: string;
  label: string;
  description?: string;
  count: number;
  children: TreeNode[];
}

export interface UsageNode {
  type: 'usage';
  usage: Usage;
}

export type TreeNode = GroupNode | UsageNode;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Returns the requested levels in their canonical nesting order. */
export function normalizeLevels(levels: Iterable<GroupLevel>): GroupLevel[] {
  const wanted = new Set(levels);
  return GROUP_LEVELS.filter((l) => wanted.has(l));
}

interface GroupKey {
  key: string;
  label: string;
  description?: string;
}

function groupKey(usage: Usage, level: GroupLevel): GroupKey {
  switch (level) {
    case 'project':
      return { key: usage.project, label: usage.project || '(no project)' };
    case 'directory':
      return { key: usage.directory, label: usage.directory || '(root)' };
    case 'file': {
      const slash = usage.relPath.lastIndexOf('/');
      const name = slash >= 0 ? usage.relPath.slice(slash + 1) : usage.relPath;
      return { key: usage.path, label: name, description: slash >= 0 ? usage.relPath.slice(0, slash) : undefined };
    }
    case 'namespace':
      return { key: usage.namespace, label: usage.namespace || '(global namespace)' };
    case 'type':
      return { key: usage.type, label: usage.type || '(no type)' };
    case 'member':
      return { key: usage.member, label: usage.member || '(no member)' };
    case 'kind':
      return { key: usage.kind, label: KIND_LABELS[usage.kind] };
  }
}

function compareGroups(level: GroupLevel, a: GroupNode, b: GroupNode): number {
  if (level === 'kind') {
    return ALL_KINDS.indexOf(a.key as never) - ALL_KINDS.indexOf(b.key as never);
  }
  // Items without a value (global namespace, no type, ...) go first.
  if ((a.key === '') !== (b.key === '')) {
    return a.key === '' ? -1 : 1;
  }
  return collator.compare(a.label, b.label) || collator.compare(a.key, b.key);
}

export function compareUsages(a: Usage, b: Usage): number {
  return collator.compare(a.path, b.path) || a.line - b.line || a.startCol - b.startCol;
}

export function buildTree(usages: readonly Usage[], levels: readonly GroupLevel[]): TreeNode[] {
  const sorted = [...usages].sort(compareUsages);
  return build(sorted, normalizeLevels(levels));
}

function build(usages: Usage[], levels: GroupLevel[]): TreeNode[] {
  if (levels.length === 0) {
    return usages.map((usage) => ({ type: 'usage', usage }));
  }
  const [level, ...rest] = levels;
  const groups = new Map<string, { info: GroupKey; usages: Usage[] }>();
  for (const usage of usages) {
    const info = groupKey(usage, level);
    let group = groups.get(info.key);
    if (!group) {
      group = { info, usages: [] };
      groups.set(info.key, group);
    }
    group.usages.push(usage);
  }
  const nodes: GroupNode[] = [...groups.entries()].map(([key, g]) => ({
    type: 'group',
    level,
    key,
    label: g.info.label,
    description: g.info.description,
    count: g.usages.length,
    children: build(g.usages, rest),
  }));
  return nodes.sort((a, b) => compareGroups(level, a, b));
}

export function firstUsage(node: TreeNode): Usage | undefined {
  return node.type === 'usage' ? node.usage : flatten(node.children)[0];
}

export function flatten(nodes: readonly TreeNode[]): Usage[] {
  const out: Usage[] = [];
  const visit = (list: readonly TreeNode[]) => {
    for (const n of list) {
      if (n.type === 'usage') {
        out.push(n.usage);
      } else {
        visit(n.children);
      }
    }
  };
  visit(nodes);
  return out;
}

function textMatcher(text: string): ((s: string) => boolean) | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const regex = /^\/(.+)\/(i?)$/.exec(trimmed);
  if (regex) {
    try {
      const re = new RegExp(regex[1], regex[2] || 'i');
      return (s) => re.test(s);
    } catch {
      // Fall through to a plain substring match while the pattern is incomplete.
    }
  }
  const needle = trimmed.toLowerCase();
  return (s) => s.toLowerCase().includes(needle);
}

export function filterUsages(usages: readonly Usage[], filters: Filters, origin: Origin | undefined): Usage[] {
  const matches = textMatcher(filters.text);
  return usages.filter((u) => {
    if (!filters.kinds.has(u.kind)) {
      return false;
    }
    if (filters.access !== 'all' && !ACCESS_KINDS[filters.access].includes(u.kind)) {
      return false;
    }
    if (origin) {
      if (filters.scope === 'file' && u.path !== origin.path) {
        return false;
      }
      if (filters.scope === 'directory' && u.directory !== origin.directory) {
        return false;
      }
      if (filters.scope === 'project' && u.project !== origin.project) {
        return false;
      }
    }
    return !matches || matches([u.preview, u.relPath, u.namespace, u.type, u.member].join('\n'));
  });
}

export function formatAsText(nodes: readonly TreeNode[]): string {
  const lines: string[] = [];
  const visit = (list: readonly TreeNode[], depth: number) => {
    const indent = '  '.repeat(depth);
    for (const n of list) {
      if (n.type === 'group') {
        lines.push(`${indent}${n.label}${n.description ? ` (${n.description})` : ''} [${n.count}]`);
        visit(n.children, depth + 1);
      } else {
        const u = n.usage;
        lines.push(`${indent}${u.relPath}:${u.line + 1}:${u.startCol + 1} [${KIND_LABELS[u.kind]}] ${u.preview}`);
      }
    }
  };
  visit(nodes, 0);
  return lines.join('\n');
}
