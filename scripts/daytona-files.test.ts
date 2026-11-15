import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeployFile } from './daytona-files.ts';

test('includes sources and reproducible dependency manifests', () => {
  for (const file of ['package-lock.json', 'apps/web/app/page.tsx', 'packages/db/index.ts',
    'src/mastra/index.ts', 'apps/openwa/dashboard/package-lock.json', 'apps/openwa/scripts/postinstall.js',
    'scripts/daytona-runtime.mjs', 'apps/openwa/.env.example']) assert.ok(isDeployFile(file), file);
});
test('excludes secrets, runtime data, dependencies and path traversal', () => {
  for (const file of ['.env', '.env.daytona', 'apps/web/.env.local', 'apps/openwa/.npmrc',
    'apps/openwa/data/.api-key', 'apps/openwa/data/sessions/auth.json', 'apps/web/node_modules/a.js',
    'apps/web/.next/server.js', 'src/mastra/public/workspace/file.txt', 'packages/db/test.sqlite-wal',
    'apps/openwa/key.pem', '../package.json', '/src/file.ts', '.daytona/state.json']) {
    assert.equal(isDeployFile(file), false, file);
  }
});
