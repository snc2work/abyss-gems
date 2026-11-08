import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function imports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
}

describe('layer boundaries', () => {
  it('lets other layers reach the rules only through the engine entry point', () => {
    for (const dir of ['src/game', 'src/render', 'src/players', 'src/logger', 'src/ui', 'src/dataset', 'src/model', 'scripts']) {
      for (const file of sourceFiles(dir)) {
        const internal = imports(file).filter((path) => /\/engine\/./.test(path));
        expect(internal, file).toEqual([]);
      }
    }
  });

  it('keeps the rules free of other layers and browser APIs', () => {
    for (const file of sourceFiles('src/engine')) {
      const outside = imports(file).filter((path) => path.startsWith('../') && path !== '../lib/prng');
      expect(outside, file).toEqual([]);
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\b(document|window|Math\.random|Date\.now)\b/);
    }
  });
});
