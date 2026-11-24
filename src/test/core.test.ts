import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, ClassifyInput } from '../classifier';
import { findContainer } from '../container';
import { buildTree, filterUsages, flatten, normalizeLevels } from '../grouping';
import { ALL_KINDS, Usage } from '../model';

function at(line: string, name: string, extra: Partial<ClassifyInput> = {}) {
  const startCol = line.indexOf(name);
  return classify({
    lineText: line,
    startCol,
    endCol: startCol + name.length,
    isDeclaration: false,
    isDefinition: false,
    target: 'value',
    ...extra,
  });
}

test('classifies writes', () => {
  assert.equal(at('  count = 5;', 'count'), 'write');
  assert.equal(at('  arr[i + 1] = 5;', 'arr'), 'write');
  assert.equal(at('  a.b->count = f(x);', 'count'), 'write');
  assert.equal(at('  swap(x, y);', 'x', { highlight: 'write' }), 'write');
});

test('classifies read/write', () => {
  assert.equal(at('  count += 2;', 'count'), 'readWrite');
  assert.equal(at('  count <<= 2;', 'count'), 'readWrite');
  assert.equal(at('  count++;', 'count'), 'readWrite');
  assert.equal(at('  --count;', 'count'), 'readWrite');
  assert.equal(at('  init(&count);', 'count'), 'readWrite');
  assert.equal(at('  v[0]++;', 'v'), 'readWrite');
});

test('classifies reads and ignores comparisons', () => {
  assert.equal(at('  if (count == 5)', 'count'), 'read');
  assert.equal(at('  if (count <= 5)', 'count'), 'read');
  assert.equal(at('  if (count != 5)', 'count'), 'read');
  assert.equal(at('  x = count;', 'count'), 'read');
  assert.equal(at('  if (a < b && b > (c))', 'a'), 'read');
  assert.equal(at('  ok = a && b;', 'a'), 'read');
});

test('classifies calls, types and declarations', () => {
  assert.equal(at('  run(1);', 'run', { target: 'function' }), 'call');
  assert.equal(at('  run<int>(1);', 'run', { target: 'function' }), 'call');
  assert.equal(at('  auto p = &run;', 'run', { target: 'function' }), 'other');
  assert.equal(at('  Widget w;', 'Widget', { target: 'type' }), 'type');
  assert.equal(at('  Widget(1);', 'Widget', { target: 'type' }), 'call');
  assert.equal(at('  int count = 0;', 'count', { isDefinition: true }), 'definition');
  assert.equal(at('  void run();', 'run', { isDeclaration: true, target: 'function' }), 'declaration');
  assert.equal(at('  ns::value', 'ns', { target: 'namespace' }), 'other');
});

test('finds enclosing namespace, type and member', () => {
  const sym = (name: string, kind: 'namespace' | 'type' | 'member', startLine: number, endLine: number) => ({
    name,
    kind,
    startLine,
    startCol: 0,
    endLine,
    endCol: 1,
    nameRange: { line: startLine, col: 2, endLine: startLine, endCol: 2 + name.length },
  });
  const nr = (line: number, name: string) => ({ line, col: 2, endLine: line, endCol: 2 + name.length });
  const symbols = [
    sym('outer', 'namespace', 0, 40),
    sym('inner', 'namespace', 1, 30),
    sym('Widget', 'type', 2, 20),
    sym('draw', 'member', 5, 10),
    sym('Other::run', 'member', 31, 35),
  ];
  assert.deepEqual(findContainer(symbols, 7, 4), {
    namespace: 'outer::inner',
    type: 'Widget',
    member: 'draw',
    ranges: { namespace: nr(1, 'inner'), type: nr(2, 'Widget'), member: nr(5, 'draw') },
  });
  assert.deepEqual(findContainer(symbols, 50, 0), { namespace: '', type: '', member: '', ranges: {} });
  // The type is only known by the name in `Other::run`, so there is no location to go to.
  assert.deepEqual(findContainer(symbols, 33, 2), {
    namespace: 'outer',
    type: 'Other',
    member: 'run',
    ranges: { namespace: nr(0, 'outer'), type: undefined, member: nr(31, 'Other::run') },
  });
});

let nextId = 0;
function usage(over: Partial<Usage>): Usage {
  return {
    id: nextId++,
    uri: 'file:///w/a.cpp',
    path: '/w/a.cpp',
    relPath: 'a.cpp',
    directory: '',
    project: 'w',
    namespace: '',
    type: '',
    member: '',
    kind: 'read',
    line: 0,
    startCol: 0,
    endLine: 0,
    endCol: 1,
    preview: 'x',
    previewStart: 0,
    previewEnd: 1,
    ...over,
  };
}

const sample = [
  usage({ path: '/w/src/b.cpp', relPath: 'src/b.cpp', directory: 'src', type: 'B', member: 'f', kind: 'write', line: 3 }),
  usage({ path: '/w/src/a.cpp', relPath: 'src/a.cpp', directory: 'src', type: 'A', member: 'g', kind: 'read', line: 9 }),
  usage({ path: '/w/src/a.cpp', relPath: 'src/a.cpp', directory: 'src', type: 'A', member: 'g', kind: 'read', line: 2 }),
  usage({ path: '/w/lib/c.cpp', relPath: 'lib/c.cpp', directory: 'lib', project: 'w/lib', kind: 'call', line: 1 }),
];

test('normalizes levels to canonical order', () => {
  assert.deepEqual(normalizeLevels(['member', 'project', 'file']), ['project', 'file', 'member']);
});

test('groups by nested levels with counts and sorted usages', () => {
  const tree = buildTree(sample, ['member', 'project', 'file']);
  assert.deepEqual(
    tree.map((n) => n.type === 'group' && [n.level, n.label, n.count]),
    [
      ['project', 'w', 3],
      ['project', 'w/lib', 1],
    ]
  );
  const w = tree[0];
  assert.ok(w.type === 'group');
  assert.deepEqual(w.children.map((c) => c.type === 'group' && c.label), ['a.cpp', 'b.cpp']);
  const a = w.children[0];
  assert.ok(a.type === 'group' && a.level === 'file');
  assert.equal(a.description, 'src');
  assert.deepEqual(flatten([a]).map((u) => u.line), [2, 9]);
});

test('flat list when no levels, kind groups use canonical order', () => {
  assert.equal(buildTree(sample, []).every((n) => n.type === 'usage'), true);
  const byKind = buildTree(sample, ['kind']);
  assert.deepEqual(byKind.map((n) => n.type === 'group' && n.label), ['Read', 'Write', 'Call']);
});

test('empty names are grouped and listed first', () => {
  const tree = buildTree([usage({ type: 'Z' }), usage({ type: '' })], ['type']);
  assert.deepEqual(tree.map((n) => n.type === 'group' && n.label), ['(no type)', 'Z']);
});

test('filters by kind, scope and text', () => {
  const origin = { path: '/w/src/a.cpp', directory: 'src', project: 'w' };
  const base = { kinds: new Set(ALL_KINDS), access: 'all' as const, scope: 'workspace' as const, text: '' };
  assert.equal(filterUsages(sample, base, origin).length, 4);
  assert.equal(filterUsages(sample, { ...base, kinds: new Set(['write' as const]) }, origin).length, 1);
  assert.equal(filterUsages(sample, { ...base, access: 'read' }, origin).length, 2);
  assert.equal(filterUsages(sample, { ...base, access: 'write' }, origin).length, 1);
  assert.equal(filterUsages(sample, { ...base, scope: 'file' }, origin).length, 2);
  assert.equal(filterUsages(sample, { ...base, scope: 'directory' }, origin).length, 3);
  assert.equal(filterUsages(sample, { ...base, scope: 'project' }, origin).length, 3);
  assert.equal(filterUsages(sample, { ...base, text: 'LIB/' }, origin).length, 1);
  assert.equal(filterUsages(sample, { ...base, text: '/src\\/[ab]\\.cpp/' }, origin).length, 3);
  assert.equal(filterUsages(sample, { ...base, text: '/(unclosed/' }, origin).length, 0);
});

test('group targets: file opens the file, symbols their name, others nothing', () => {
  const r = { line: 4, col: 6, endLine: 4, endCol: 9 };
  const u = usage({ type: 'Foo', member: 'bar', symbolRanges: { type: r } });
  const [file] = buildTree([u], ['file']);
  assert.deepEqual((file as { target: unknown }).target, { uri: u.uri });
  const [type] = buildTree([u], ['type']);
  assert.deepEqual((type as { target: unknown }).target, { uri: u.uri, range: r });
  const [member] = buildTree([u], ['member']);
  assert.equal((member as { target?: unknown }).target, undefined);
  const [kind] = buildTree([u], ['kind']);
  assert.equal((kind as { target?: unknown }).target, undefined);
});

test('findContainer reports the name range of enclosing symbols', () => {
  const nameRange = { line: 1, col: 6, endLine: 1, endCol: 9 };
  const symbols = [
    { name: 'Foo', kind: 'type' as const, startLine: 1, startCol: 0, endLine: 5, endCol: 1, nameRange },
  ];
  assert.deepEqual(findContainer(symbols, 3, 2).ranges, { type: nameRange });
});
