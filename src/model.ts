export type UsageKind =
  | 'declaration'
  | 'definition'
  | 'read'
  | 'write'
  | 'readWrite'
  | 'call'
  | 'type'
  | 'other';

export const ALL_KINDS: readonly UsageKind[] = [
  'declaration',
  'definition',
  'read',
  'write',
  'readWrite',
  'call',
  'type',
  'other',
];

export const KIND_LABELS: Record<UsageKind, string> = {
  declaration: 'Declaration',
  definition: 'Definition',
  read: 'Read',
  write: 'Write',
  readWrite: 'Read/Write',
  call: 'Call',
  type: 'Type reference',
  other: 'Other',
};

/** Quick read/write filter: reads include read/write usages, writes include them too. */
export type Access = 'all' | 'read' | 'write';

export const ACCESS_KINDS: Record<Exclude<Access, 'all'>, readonly UsageKind[]> = {
  read: ['read', 'readWrite'],
  write: ['write', 'readWrite'],
};

export const ACCESS_LABELS: Record<Access, string> = {
  all: 'all usages',
  read: 'reads',
  write: 'writes',
};

export type GroupLevel = 'project' | 'directory' | 'file' | 'namespace' | 'type' | 'member' | 'kind';

// Levels are always nested in this order.
export const GROUP_LEVELS: readonly GroupLevel[] = [
  'project',
  'directory',
  'file',
  'namespace',
  'type',
  'member',
  'kind',
];

export const GROUP_LEVEL_LABELS: Record<GroupLevel, string> = {
  project: 'Project',
  directory: 'Directory',
  file: 'File',
  namespace: 'Namespace',
  type: 'Type',
  member: 'Member',
  kind: 'Usage kind',
};

export type Scope = 'workspace' | 'project' | 'directory' | 'file';

export const SCOPES: readonly Scope[] = ['workspace', 'project', 'directory', 'file'];

export const SCOPE_LABELS: Record<Scope, string> = {
  workspace: 'Entire workspace',
  project: 'Current project',
  directory: 'Current directory',
  file: 'Current file',
};

/** Zero-based range of a symbol name in a document. */
export interface SymbolRange {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

/** Where a group of usages leads to when clicked: a symbol, or just a file when `range` is absent. */
export interface GroupTarget {
  uri: string;
  range?: SymbolRange;
}

export interface Usage {
  id: number;
  /** Serialized `vscode.Uri` of the file. */
  uri: string;
  /** Absolute file system path. */
  path: string;
  /** Path relative to its workspace folder (or the absolute path when outside of one). */
  relPath: string;
  directory: string;
  project: string;
  namespace: string;
  type: string;
  member: string;
  /** Locations of the enclosing symbols, when the language server reports them. */
  symbolRanges?: { namespace?: SymbolRange; type?: SymbolRange; member?: SymbolRange };
  kind: UsageKind;
  /** Zero-based. */
  line: number;
  startCol: number;
  endLine: number;
  endCol: number;
  /** Trimmed source line shown in the tree. */
  preview: string;
  /** Offsets of the match inside `preview`. */
  previewStart: number;
  previewEnd: number;
}

export interface Origin {
  path: string;
  directory: string;
  project: string;
}

export interface Filters {
  kinds: ReadonlySet<UsageKind>;
  access: Access;
  scope: Scope;
  text: string;
}
