import { SymbolRange } from './model';

export interface FlatSymbol {
  name: string;
  /** Range of the symbol name itself. */
  nameRange?: SymbolRange;
  kind: SymbolCategory;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export type SymbolCategory = 'namespace' | 'type' | 'member' | 'other';

export interface Container {
  namespace: string;
  type: string;
  member: string;
  ranges: { namespace?: SymbolRange; type?: SymbolRange; member?: SymbolRange };
}

function contains(s: FlatSymbol, line: number, col: number): boolean {
  const afterStart = line > s.startLine || (line === s.startLine && col >= s.startCol);
  const beforeEnd = line < s.endLine || (line === s.endLine && col <= s.endCol);
  return afterStart && beforeEnd;
}

function size(s: FlatSymbol): number {
  return (s.endLine - s.startLine) * 100000 + (s.endCol - s.startCol);
}

/** Resolves namespace / type / member names enclosing a position from a flat list of symbols. */
export function findContainer(symbols: readonly FlatSymbol[], line: number, col: number): Container {
  const chain = symbols.filter((s) => contains(s, line, col)).sort((a, b) => size(b) - size(a));
  const namespaces: string[] = [];
  const types: string[] = [];
  let member = '';
  const ranges: Container['ranges'] = {};
  for (const s of chain) {
    if (s.kind === 'namespace') {
      namespaces.push(s.name);
      ranges.namespace = s.nameRange;
    } else if (s.kind === 'type') {
      types.push(s.name);
      ranges.type = s.nameRange;
    } else if (s.kind === 'member') {
      member = s.name;
      ranges.member = s.nameRange;
    }
  }

  // Out-of-line definitions such as `Foo::bar` may not be nested inside their type.
  if (types.length === 0 && member.includes('::')) {
    const idx = member.lastIndexOf('::');
    types.push(member.slice(0, idx));
    ranges.type = undefined;
    member = member.slice(idx + 2);
  }
  return { namespace: namespaces.join('::'), type: types.join('::'), member, ranges };
}
