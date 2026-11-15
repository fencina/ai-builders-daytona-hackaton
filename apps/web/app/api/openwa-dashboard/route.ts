import { readFileSync } from 'node:fs';
import path from 'node:path';
import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import { projectRoot } from '../../../../../packages/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await currentUser()) return new Response('Unauthorized', { status: 401 });
  let url = 'http://localhost:2886';
  try {
    url = JSON.parse(readFileSync(path.join(projectRoot, '.daytona/links.json'), 'utf8')).openwa;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  redirect(url);
}
