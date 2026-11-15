import path from 'node:path';

// Ship application sources, not the developer's home, credentials or runtime state.
export function isDeployFile(file: string): boolean {
  const parts = file.split('/');
  if (path.isAbsolute(file) || parts.some(p => p === '..' || p === '.')) return false;
  if (!['apps', 'packages', 'src', 'scripts'].includes(parts[0])) {
    return ['package.json', 'package-lock.json', 'tsconfig.json'].includes(file);
  }
  const excluded = new Set(['node_modules', 'data', '.data', 'sessions', '.wwebjs_auth', '.wwebjs_cache',
    'dist', 'coverage', '.next', '.git', '.daytona', 'logs', 'workspace']);
  if (file.startsWith('src/mastra/public/')) return false;
  if (parts.some(p => excluded.has(p))) return false;
  if (parts.some(p => p.startsWith('.') && !['.env.example', '.gitignore'].includes(p))) return false;
  const name = parts.at(-1)!;
  if (name.startsWith('.') && !['.env.example', '.gitignore'].includes(name)) return false;
  return !/\.(?:db|sqlite|sqlite3|duckdb)(?:[-.].*)?$|\.(?:pem|key|p12|pfx|log|tsbuildinfo)$/i.test(name);
}
