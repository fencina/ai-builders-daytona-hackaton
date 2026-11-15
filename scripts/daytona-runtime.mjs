import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(path.join(root, '.daytona/runtime.json'), 'utf8'));
const links = JSON.parse(readFileSync(path.join(root, '.daytona/links.json'), 'utf8'));
const env = { ...process.env, ...config, NODE_ENV: 'production', APP_ORIGIN: links.webOrigin };
mkdirSync(path.join(root, '.daytona/logs'), { recursive: true, mode: 0o700 });
const children = [];
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
  }
  setTimeout(() => {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    process.exit(code);
  }, 75000).unref();
  process.exitCode = code;
}
for (const [name, cwd, args, extra] of [
  ['mastra', root, ['run', 'start'], { PORT: '4111', MASTRA_HOST: '127.0.0.1' }],
  ['openwa', path.join(root, 'apps/openwa'), ['run', 'start:prod'], {
    PORT: '2785', SERVE_DASHBOARD: 'true', DATABASE_TYPE: 'sqlite',
    REDIS_ENABLED: 'false', REDIS_BUILTIN: 'false', QUEUE_ENABLED: 'false', CACHE_ENABLED: 'false',
    POSTGRES_BUILTIN: 'false', MINIO_BUILTIN: 'false', AUTO_START_SESSIONS: 'true',
    WEBHOOK_SSRF_PROTECT: 'true', SSRF_ALLOWED_HOSTS: '127.0.0.1',
    CORS_ORIGINS: links.origins.join(','), BASE_URL: links.origins[0], DASHBOARD_URL: links.origins[0],
    PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium', MAX_CONCURRENT_SESSIONS: '1',
  }],
  ['web', path.join(root, 'apps/web'), ['exec', '--', 'next', 'start', '--hostname', '0.0.0.0', '--port', '3000'], {}],
]) {
  const log = createWriteStream(path.join(root, `.daytona/logs/${name}.log`), { flags: 'a', mode: 0o600 });
  const child = spawn('npm', args, { cwd, env: { ...env, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout.pipe(log); child.stderr.pipe(log);
  child.on('error', () => { console.error(`${name} could not start; inspect its log.`); shutdown(1); });
  child.on('exit', code => {
    if (!shuttingDown) { console.error(`${name} exited (${code}); stopping stack.`); shutdown(1); }
  });
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
