import * as path from 'path';
import * as vscode from 'vscode';
import { classify, ClassifyInput, HighlightKind, TargetKind } from './classifier';
import { findContainer, FlatSymbol, SymbolCategory } from './container';
import { Origin, Usage } from './model';
import { ProjectResolver } from './projectResolver';

export interface SearchOptions {
  maxResults: number;
  includeDeclarations: boolean;
  projectMarkers: readonly string[];
}

interface Loc {
  uri: vscode.Uri;
  range: vscode.Range;
}

interface RawSymbol extends FlatSymbol {
  symbolKind: vscode.SymbolKind;
  selLine: number;
  selCol: number;
  selEndLine: number;
  selEndCol: number;
}

const CONCURRENCY = 8;
const MAX_PREVIEW = 240;

function toLoc(item: vscode.Location | vscode.LocationLink): Loc {
  if ('targetUri' in item) {
    return { uri: item.targetUri, range: item.targetSelectionRange ?? item.targetRange };
  }
  return { uri: item.uri, range: item.range };
}

const keyOf = (uri: vscode.Uri, pos: vscode.Position) => `${uri.toString()}#${pos.line}:${pos.character}`;

async function run<T>(command: string, ...args: unknown[]): Promise<T | undefined> {
  try {
    return await vscode.commands.executeCommand<T>(command, ...args);
  } catch {
    return undefined;
  }
}

function categoryOf(kind: vscode.SymbolKind): SymbolCategory {
  const K = vscode.SymbolKind;
  switch (kind) {
    case K.Namespace:
    case K.Module:
    case K.Package:
      return 'namespace';
    case K.Class:
    case K.Struct:
    case K.Interface:
    case K.Enum:
      return 'type';
    case K.Function:
    case K.Method:
    case K.Constructor:
    case K.Operator:
    case K.Property:
    case K.Field:
    case K.Variable:
    case K.Constant:
    case K.Event:
      return 'member';
    default:
      return 'other';
  }
}

function targetOf(kind: vscode.SymbolKind): TargetKind {
  const K = vscode.SymbolKind;
  switch (kind) {
    case K.Function:
    case K.Method:
    case K.Constructor:
    case K.Operator:
      return 'function';
    case K.Class:
    case K.Struct:
    case K.Interface:
    case K.Enum:
    case K.TypeParameter:
      return 'type';
    case K.Namespace:
    case K.Module:
    case K.Package:
      return 'namespace';
    case K.Variable:
    case K.Constant:
    case K.Field:
    case K.Property:
    case K.EnumMember:
      return 'value';
    default:
      return 'unknown';
  }
}

async function loadSymbols(uri: vscode.Uri): Promise<RawSymbol[]> {
  const result = await run<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
    'vscode.executeDocumentSymbolProvider',
    uri
  );
  const out: RawSymbol[] = [];
  const add = (name: string, kind: vscode.SymbolKind, range: vscode.Range, sel: vscode.Range) =>
    out.push({
      name,
      kind: categoryOf(kind),
      symbolKind: kind,
      startLine: range.start.line,
      startCol: range.start.character,
      endLine: range.end.line,
      endCol: range.end.character,
      selLine: sel.start.line,
      selCol: sel.start.character,
      selEndLine: sel.end.line,
      selEndCol: sel.end.character,
    });
  const visit = (list: ReadonlyArray<vscode.DocumentSymbol | vscode.SymbolInformation>) => {
    for (const s of list) {
      // The command returns objects that are both SymbolInformation and DocumentSymbol,
      // so check for the hierarchical shape first or nested symbols are lost.
      if ('children' in s && 'selectionRange' in s) {
        add(s.name, s.kind, s.range, s.selectionRange);
        visit(s.children ?? []);
      } else if ('location' in s) {
        add(s.name, s.kind, s.location.range, s.location.range);
      }
    }
  };
  visit(result ?? []);
  return out;
}

function findTargetSymbol(symbols: readonly RawSymbol[], loc: Loc, word: string): RawSymbol | undefined {
  const { line, character } = loc.range.start;
  let best: RawSymbol | undefined;
  for (const s of symbols) {
    const afterStart = line > s.selLine || (line === s.selLine && character >= s.selCol);
    const beforeEnd = line < s.selEndLine || (line === s.selEndLine && character <= s.selEndCol);
    if (afterStart && beforeEnd && s.name.includes(word)) {
      const bestSize = best ? (best.selEndLine - best.selLine) * 100000 + best.selEndCol - best.selCol : Infinity;
      const size = (s.selEndLine - s.selLine) * 100000 + s.selEndCol - s.selCol;
      if (size <= bestSize) {
        best = s;
      }
    }
  }
  return best;
}

function makePreview(text: string, start: number, end: number) {
  const indent = text.length - text.trimStart().length;
  let preview = text.trim();
  let ps = Math.max(0, start - indent);
  let pe = Math.max(ps, end - indent);
  if (preview.length > MAX_PREVIEW) {
    const from = Math.max(0, ps - 80);
    const prefix = from > 0 ? '…' : '';
    preview = prefix + preview.slice(from, from + MAX_PREVIEW);
    ps = ps - from + prefix.length;
    pe = Math.min(pe - from + prefix.length, preview.length);
  }
  return { preview, previewStart: ps, previewEnd: pe };
}

export interface SearchResult {
  symbolName: string;
  uri: vscode.Uri;
  position: vscode.Position;
  origin: Origin;
  usages: Usage[];
  truncated: boolean;
  /**
   * Fills in namespace / type / member and refines read/write kinds using the language server.
   * Mutates `usages` in place and calls `onProgress` after each file. Opening files in the language
   * server is what makes this slow (clangd parses every file), so it runs after results are shown.
   */
  resolveDetails(token: vscode.CancellationToken, onProgress: (done: number, total: number) => void): Promise<void>;
}

const READ_CONCURRENCY = 32;

async function mapConcurrent<T>(
  items: readonly T[],
  limit: number,
  token: vscode.CancellationToken,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length && !token.isCancellationRequested) {
      await fn(items[cursor++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const decoder = new TextDecoder();

/**
 * Returns the lines of a file without opening it as a text document: `openTextDocument` makes the
 * language server open (and, for clangd, fully parse) the file. Already open documents are reused.
 */
async function readLines(uri: vscode.Uri): Promise<string[] | undefined> {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
  if (open) {
    return Array.from({ length: open.lineCount }, (_, i) => open.lineAt(i).text);
  }
  try {
    return decoder.decode(await vscode.workspace.fs.readFile(uri)).split(/\r\n|\r|\n/);
  } catch {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      return Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
    } catch {
      return undefined;
    }
  }
}

interface Pending {
  usage: Usage;
  input: Omit<ClassifyInput, 'highlight'>;
}

export async function findUsages(
  uri: vscode.Uri,
  position: vscode.Position,
  options: SearchOptions,
  token: vscode.CancellationToken
): Promise<SearchResult | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) {
    return undefined;
  }
  const symbolName = document.getText(wordRange);

  // Independent requests: run them together instead of one after another.
  const [refs, defs, decls] = await Promise.all([
    run<Array<vscode.Location | vscode.LocationLink>>('vscode.executeReferenceProvider', uri, position),
    run<Array<vscode.Location | vscode.LocationLink>>('vscode.executeDefinitionProvider', uri, position),
    run<Array<vscode.Location | vscode.LocationLink>>('vscode.executeDeclarationProvider', uri, position),
  ]);
  if (token.isCancellationRequested || !refs) {
    return undefined;
  }
  const defLocs = (defs ?? []).map(toLoc);
  const declLocs = (decls ?? []).map(toLoc);
  const defKeys = new Set(defLocs.map((l) => keyOf(l.uri, l.range.start)));
  const declKeys = new Set(declLocs.map((l) => keyOf(l.uri, l.range.start)));

  // The provider may report the same location more than once.
  const seen = new Set<string>();
  let locs = refs.map(toLoc).filter((l) => {
    const key = keyOf(l.uri, l.range.start);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return options.includeDeclarations || (!defKeys.has(key) && !declKeys.has(key));
  });

  const truncated = locs.length > options.maxResults;
  if (truncated) {
    locs = locs.slice(0, options.maxResults);
  }

  const byFile = new Map<string, Loc[]>();
  for (const l of locs) {
    const k = l.uri.toString();
    const list = byFile.get(k);
    if (list) {
      list.push(l);
    } else {
      byFile.set(k, [l]);
    }
  }

  const targetLoc = defLocs[0] ?? declLocs[0] ?? { uri, range: wordRange };
  const targetPromise = loadSymbols(targetLoc.uri).then((symbols) => {
    const sym = findTargetSymbol(symbols, targetLoc, symbolName);
    return sym ? targetOf(sym.symbolKind) : 'unknown';
  });

  const resolver = new ProjectResolver(options.projectMarkers);
  const describePath = (u: vscode.Uri) => {
    const folder = vscode.workspace.getWorkspaceFolder(u);
    const root = folder?.uri.fsPath;
    const rel = root ? path.relative(root, u.fsPath).split(path.sep).join('/') : u.fsPath;
    const dir = path.posix.dirname(rel);
    const projectDir = resolver.resolve(u.fsPath, root);
    let project: string;
    if (!root) {
      project = path.dirname(u.fsPath);
    } else if (projectDir === root) {
      project = folder!.name;
    } else {
      project = `${folder!.name}/${path.relative(root, projectDir).split(path.sep).join('/')}`;
    }
    return { relPath: rel, directory: dir === '.' ? '' : dir, project };
  };

  const [target, fileLines] = await Promise.all([
    targetPromise,
    (async () => {
      const lines = new Map<string, string[]>();
      await mapConcurrent([...byFile.keys()], READ_CONCURRENCY, token, async (k) => {
        const content = await readLines(byFile.get(k)![0].uri);
        if (content) {
          lines.set(k, content);
        }
      });
      return lines;
    })(),
  ]);
  if (token.isCancellationRequested) {
    return undefined;
  }

  const usages: Usage[] = [];
  const pendingByFile = new Map<string, Pending[]>();
  let nextId = 0;
  for (const [k, fileLocs] of byFile) {
    const lines = fileLines.get(k);
    if (!lines) {
      continue;
    }
    const fileUri = fileLocs[0].uri;
    const info = describePath(fileUri);
    const pending: Pending[] = [];
    for (const loc of fileLocs) {
      const { start, end } = loc.range;
      const lineText = lines[Math.min(start.line, lines.length - 1)] ?? '';
      const endCol = end.line === start.line ? end.character : lineText.length;
      const key = keyOf(loc.uri, start);
      const input = {
        lineText,
        startCol: start.character,
        endCol,
        isDefinition: defKeys.has(key),
        isDeclaration: declKeys.has(key),
        target,
      };
      const usage: Usage = {
        id: nextId++,
        uri: k,
        path: fileUri.fsPath,
        ...info,
        namespace: '',
        type: '',
        member: '',
        kind: classify(input),
        line: start.line,
        startCol: start.character,
        endLine: end.line,
        endCol: end.character,
        ...makePreview(lineText, start.character, endCol),
      };
      usages.push(usage);
      pending.push({ usage, input });
    }
    pendingByFile.set(k, pending);
  }

  // Highlights only refine the read/write guess for values.
  const wantHighlights = target === 'value' || target === 'unknown';

  const resolveDetails = async (
    detailsToken: vscode.CancellationToken,
    onProgress: (done: number, total: number) => void
  ) => {
    // Files that are already open are parsed already and resolve quickly: do them first.
    const openUris = new Set(vscode.workspace.textDocuments.map((d) => d.uri.toString()));
    const keys = [...pendingByFile.keys()].sort((a, b) => Number(openUris.has(b)) - Number(openUris.has(a)));
    let done = 0;
    await mapConcurrent(keys, CONCURRENCY, detailsToken, async (k) => {
      const pending = pendingByFile.get(k)!;
      const fileUri = vscode.Uri.parse(k);
      const first = pending[0].usage;
      const [symbols, highlights] = await Promise.all([
        loadSymbols(fileUri),
        wantHighlights
          ? run<vscode.DocumentHighlight[]>(
              'vscode.executeDocumentHighlights',
              fileUri,
              new vscode.Position(first.line, first.startCol)
            )
          : Promise.resolve(undefined),
      ]);
      if (detailsToken.isCancellationRequested) {
        return;
      }
      const highlightKinds = new Map<string, HighlightKind>();
      for (const h of highlights ?? []) {
        highlightKinds.set(
          `${h.range.start.line}:${h.range.start.character}`,
          h.kind === vscode.DocumentHighlightKind.Write
            ? 'write'
            : h.kind === vscode.DocumentHighlightKind.Read
              ? 'read'
              : 'text'
        );
      }
      for (const { usage, input } of pending) {
        Object.assign(usage, findContainer(symbols, usage.line, usage.startCol));
        usage.kind = classify({ ...input, highlight: highlightKinds.get(`${usage.line}:${usage.startCol}`) });
      }
      onProgress(++done, keys.length);
    });
  };

  const originInfo = describePath(uri);
  return {
    symbolName,
    uri,
    position,
    origin: { path: uri.fsPath, directory: originInfo.directory, project: originInfo.project },
    usages,
    truncated,
    resolveDetails,
  };
}
