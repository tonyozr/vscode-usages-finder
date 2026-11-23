import * as fs from 'fs';
import * as path from 'path';

/** Finds the nearest ancestor directory (inside the workspace folder) containing a project marker file. */
export class ProjectResolver {
  private readonly dirCache = new Map<string, boolean>();

  constructor(private readonly markers: readonly string[]) {}

  private isProjectDir(dir: string): boolean {
    let cached = this.dirCache.get(dir);
    if (cached === undefined) {
      cached = this.scan(dir);
      this.dirCache.set(dir, cached);
    }
    return cached;
  }

  private scan(dir: string): boolean {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return false;
    }
    return this.markers.some((marker) =>
      marker.startsWith('*') ? entries.some((e) => e.endsWith(marker.slice(1))) : entries.includes(marker)
    );
  }

  /** Returns the project root directory, or `workspaceRoot` when no marker is found. */
  resolve(filePath: string, workspaceRoot: string | undefined): string {
    const root = workspaceRoot ?? path.dirname(filePath);
    let dir = path.dirname(filePath);
    while (isInside(dir, root)) {
      if (this.isProjectDir(dir)) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    return root;
  }
}

function isInside(dir: string, root: string): boolean {
  const rel = path.relative(root, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
