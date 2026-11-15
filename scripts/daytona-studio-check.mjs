// Verify Studio from the sandbox or a local browser; never print signed preview URLs.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/openwa/package.json', import.meta.url));
const { default: puppeteer } = await import(require.resolve('puppeteer'));
const stateFile = new URL('../.daytona/state.json', import.meta.url);
const links = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8')).urls
  : JSON.parse(readFileSync(new URL('../.daytona/links.json', import.meta.url), 'utf8'));
const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'daytona-skip-preview-warning': 'true' });
  const errors = [];
  const failed = [];
  page.on('pageerror', () => errors.push('page-error'));
  page.on('response', response => { if (response.status() >= 400) failed.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('requestfailed', request => { failed.push({ path: new URL(request.url()).pathname, status: 'network-error' }); });
  const response = await page.goto(links.mastra, { waitUntil: 'networkidle2', timeout: 60000 });
  try {
    await page.waitForFunction(() => document.body.innerText.includes('Agents'), { timeout: 30000 });
  } catch {
    console.log(JSON.stringify({ title: await page.title(), pageStatus: response.status(), pageErrors: errors.length, failed,
      text: (await page.evaluate(() => document.body.innerText)).slice(0, 1200).replace(/https?:\/\/\S+/g, '[URL omitted]') }));
    process.exitCode = 1;
    throw new Error('Studio did not render the Agents navigation.');
  }
  const api = await page.evaluate(async () => {
    const response = await fetch('/api/agents');
    const data = await response.json();
    return { status: response.status, agentCount: Object.keys(data).length };
  });
  const result = { title: await page.title(), pageStatus: response.status(), ...api, pageErrors: errors.length };
  console.log(JSON.stringify(result));
  if (result.title !== 'Mastra Studio' || result.status !== 200 || result.agentCount < 1 || result.pageErrors) process.exitCode = 1;
} finally {
  await browser.close();
}
