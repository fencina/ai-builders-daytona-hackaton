import { Daytona, DaytonaError, Image } from '@daytona/sdk';
import type { Sandbox } from '@daytona/sdk';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeployFile } from './daytona-files.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.daytona', '.env', 'apps/web/.env.local']) {
  const file = path.join(root, name);
  if (existsSync(file)) for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    process.env[key] ??= value;
  }
}
const command = process.argv[2];
if (!['deploy', 'resume', 'start', 'stop', 'status', 'urls'].includes(command)) {
  console.error('Usage: scripts/daytona.ts deploy|resume|start|stop|status|urls');
  process.exit(1);
}
if (!process.env.DAYTONA_API_KEY) {
  console.error('Configure DAYTONA_API_KEY in .env.daytona (never commit it).');
  process.exit(1);
}
const daytona = new Daytona();
const statePath = path.join(root, '.daytona/state.json');
const remoteRoot = '/app/turno';
class LauncherError extends Error {}
type State = { id: string; ready?: boolean; urls?: { web: string; openwa: string }; session?: string };
let state: State | undefined = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined;
function save() {
  mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}
async function run(sandbox: Sandbox, cmd: string, timeout = 1200) {
  const response = await sandbox.process.executeCommand(cmd, remoteRoot, undefined, timeout);
  if (response.exitCode !== 0) throw new LauncherError('Sandbox command failed. Inspect /app/turno/.daytona/logs for details.');
  return response;
}
async function upload(sandbox: Sandbox, source: Buffer, destination: string) {
  // Small uploads work reliably where long multipart streams are reset by the proxy.
  const chunkSize = 64 * 1024;
  if (source.length <= chunkSize) {
    await sandbox.fs.uploadFile(source, destination, 30);
    return;
  }
  const prefix = `/tmp/turno-upload-${randomUUID()}`;
  const parts: string[] = [];
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    const part = `${prefix}-${parts.length}`;
    await sandbox.fs.uploadFile(source.subarray(offset, offset + chunkSize), part, 30);
    parts.push(part);
  }
  const digest = createHash('sha256').update(source).digest('hex');
  const code = `import hashlib,os; parts=${JSON.stringify(parts)}; payload=b"".join(open(p,"rb").read() for p in parts); assert hashlib.sha256(payload).hexdigest()==${JSON.stringify(digest)}, "Upload checksum mismatch"; target=${JSON.stringify(prefix + '-complete')}; open(target,"wb").write(payload); os.replace(target,${JSON.stringify(destination)}); [os.unlink(p) for p in parts]`;
  const quoted = "'" + code.replaceAll("'", "'\\''") + "'";
  await run(sandbox, `python3 -c ${quoted}`, 60);
}
async function links(sandbox: Sandbox) {
  const [web, openwa, openwaPreview] = await Promise.all([
    sandbox.getSignedPreviewUrl(3000, 86400), sandbox.getSignedPreviewUrl(2785, 86400), sandbox.getPreviewLink(2785),
  ]);
  state!.urls = { web: web.url, openwa: openwa.url }; save();
  await upload(sandbox, Buffer.from(JSON.stringify({
    openwa: openwa.url, origins: [...new Set([new URL(openwaPreview.url).origin, new URL(openwa.url).origin])],
    webOrigin: new URL(web.url).origin,
  })), `${remoteRoot}/.daytona/links.json`);
  // Do not print bearer links into CI logs. They are available in the ignored local state file.
  console.log('Private preview links saved in .daytona/state.json (valid for 24 hours; do not share publicly).');
}
async function start(sandbox: Sandbox) {
  if (!state!.ready) throw new LauncherError('Setup is incomplete. Inspect sandbox build logs before starting.');
  if (sandbox.state !== 'started') await sandbox.start(180);
  const probe = await sandbox.process.executeCommand('curl -fsS http://127.0.0.1:3000/ -o /dev/null', remoteRoot, undefined, 10);
  await links(sandbox);
  if (probe.exitCode === 0) {
    // Refresh the dashboard link without restarting active WhatsApp sessions.
    console.log('Stack is already running.'); return;
  }
  state!.session = `turno-${randomUUID()}`; save();
  await sandbox.process.createSession(state!.session);
  await sandbox.process.executeSessionCommand(state!.session, {
    command: `cd ${remoteRoot} && node scripts/daytona-runtime.mjs`, runAsync: true,
  });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const check = await sandbox.process.executeCommand(
      'curl --max-time 4 -fsS http://127.0.0.1:3000/ -o /dev/null && curl --max-time 4 -fsS http://127.0.0.1:4111/api/agents -o /dev/null && curl --max-time 4 -fsS http://127.0.0.1:2785/api/health -o /dev/null && curl --max-time 4 -fsS http://127.0.0.1:2785/ -o /dev/null',
      remoteRoot, undefined, 15);
    if (check.exitCode === 0) {
      for (const port of [3000, 2785]) {
        const preview = await sandbox.getPreviewLink(port);
        const response = await fetch(preview.url, {
          headers: { 'X-Daytona-Preview-Token': preview.token }, signal: AbortSignal.timeout(30000),
        });
        await response.body?.cancel();
        if (!response.ok) throw new LauncherError(`External preview on port ${port} returned HTTP ${response.status}.`);
      }
      console.log('Web, Mastra and OpenWA respond internally; authenticated web/OpenWA previews also respond.'); return;
    }
    await delay(3000);
  }
  throw new LauncherError(`Services did not become ready. Inspect ${remoteRoot}/.daytona/logs and session ${state!.session}.`);
}

try {
  if (command === 'deploy' || command === 'resume') {
    if (command === 'deploy' && state) throw new LauncherError('A sandbox is already recorded in .daytona/state.json. Use daytona:resume for incomplete setup or daytona:start when ready.');
    if (command === 'resume' && (!state || state.ready)) throw new LauncherError('Resume requires a recorded sandbox with incomplete setup. Use daytona:start when ready.');
    if (!process.env.OPENAI_API_KEY) throw new LauncherError('Configure OPENAI_API_KEY before creating the sandbox.');
    const authKeys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ADMIN_USER_ID','SUPABASE_ADMIN_EMAIL'] as const;
    if(authKeys.some(key=>!process.env[key]))throw new LauncherError('Configure Supabase Auth URL, publishable key, administrator ID and email before deploying.');
    const image = Image.base('node:22-bookworm')
      .runCommands('apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ffmpeg python3 make g++ patch curl ca-certificates && rm -rf /var/lib/apt/lists/*')
      .env({ PUPPETEER_SKIP_DOWNLOAD: 'true', PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium' })
      .workdir(remoteRoot);
    console.log(command === 'resume' ? 'Resuming setup in the existing sandbox.' : 'Creating private sandbox (4 CPU, 8 GiB RAM, 10 GiB disk).');
    const sandbox = command === 'resume' ? await daytona.get(state!.id) : await daytona.create({
      image, language: 'typescript', public: false, user: 'root',
      resources: { cpu: 4, memory: 8, disk: 10 },
      autoStopInterval: 0, autoPauseInterval: 0, autoDeleteInterval: -1,
      labels: { project: 'ai-builders-daytona-hackaton' },
    }, { timeout: 1200 });
    if (sandbox.state !== 'started') await sandbox.start(180);
    state = { id: sandbox.id }; save();
    console.log(`Sandbox: ${sandbox.id}. Stop it with npm run daytona:stop when finished.`);
    const temporary = mkdtempSync(path.join(tmpdir(), 'turno-daytona-'));
    try {
      const staging = path.join(temporary, 'source'); mkdirSync(staging);
      const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
        .split('\0').filter(Boolean).filter(isDeployFile);
      for (const file of new Set(files)) {
        const source = path.join(root, file);
        if (!existsSync(source) || !lstatSync(source).isFile()) continue;
        const target = path.join(staging, file); mkdirSync(path.dirname(target), { recursive: true }); copyFileSync(source, target);
      }
      const archive = path.join(temporary, 'source.tar.gz');
      execFileSync('tar', ['-czf', archive, '-C', staging, '.']);
      console.log('Uploading application source archive.');
      await upload(sandbox, readFileSync(archive), '/tmp/turno-source.tar.gz');
      console.log('Extracting application sources.');
      await run(sandbox, 'tar -xzf /tmp/turno-source.tar.gz && mkdir -p .daytona/logs && chmod 700 .daytona');
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    // Only the explicitly listed application settings leave the local machine.
    const runtime: Record<string, string> = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENWA_WEBHOOK_SECRET: process.env.OPENWA_WEBHOOK_SECRET || randomBytes(32).toString('hex'),
      SHIFTS_DATABASE_PATH: `${remoteRoot}/src/mastra/public/.data/mastra.db`,
      MASTRA_URL: 'http://127.0.0.1:4111', OPENWA_URL: 'http://127.0.0.1:2785',
      ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'messi',
    };
    for(const key of authKeys)runtime[key]=process.env[key]!;
    if (process.env.SHIFTS_TIMEZONE) runtime.SHIFTS_TIMEZONE = process.env.SHIFTS_TIMEZONE;
    await upload(sandbox, Buffer.from(JSON.stringify(runtime)), `${remoteRoot}/.daytona/runtime.json`);
    await run(sandbox, 'chmod 600 .daytona/runtime.json');
    console.log('Installing dependencies and building all applications; logs stay in the sandbox.');
    await run(sandbox, 'npm ci --include=dev > .daytona/logs/install-root.log 2>&1 && npm --prefix apps/web ci --include=dev > .daytona/logs/install-web.log 2>&1 && npm --prefix apps/openwa ci --include=dev > .daytona/logs/install-openwa.log 2>&1');
    await run(sandbox, 'npm run build > .daytona/logs/build-mastra.log 2>&1 && npm run build:web > .daytona/logs/build-web.log 2>&1 && npm --prefix apps/openwa run build:all > .daytona/logs/build-openwa.log 2>&1');
    state.ready = true; save();
    await start(sandbox);
  } else {
    if (!state) throw new LauncherError('No sandbox recorded. Run npm run daytona:deploy first.');
    const sandbox = await daytona.get(state.id);
    if (command === 'stop') { await sandbox.stop(120); console.log('Sandbox stopped; its filesystem is retained.'); }
    if (command === 'status') console.log(`Sandbox ${sandbox.id}: ${sandbox.state}`);
    if (command === 'start') await start(sandbox);
    if (command === 'urls') {
      if (sandbox.state !== 'started') throw new LauncherError('Start the sandbox before renewing preview links.');
      await links(sandbox);
    }
  }
} catch (error) {
  // SDK error objects can contain authorization headers. Never dump them.
  console.error(error instanceof LauncherError ? error.message : 'Deployment operation failed. Check authentication, quota and sandbox logs in the Daytona dashboard.');
  if (error instanceof DaytonaError) {
    let message = error.message;
    for (const [key, value] of Object.entries(process.env)) {
      if (value && /KEY|TOKEN|SECRET|PASSWORD/i.test(key)) message = message.split(value).join('[REDACTED]');
    }
    message = message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/https?:\/\/\S+/gi, '[URL omitted]');
    console.error(`Daytona ${error.statusCode ?? 'SDK'}: ${message}`);
  }
  if (state) console.error(`Sandbox retained: ${state.id}. It may still incur costs; use npm run daytona:stop.`);
  process.exitCode = 1;
}
