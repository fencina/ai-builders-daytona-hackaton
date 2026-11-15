import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { agent } from './agents/agent';
import { findUrgentShiftsTool, sendWhatsAppMessageTool, assignShiftTool } from './tools/shift-tools';
import { urgentShiftsWorkflow } from './workflows/urgent-shifts';
import { incomingMessage, handleIncomingMessage } from './lib/conversations';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { agent },
  tools: { findUrgentShiftsTool, sendWhatsAppMessageTool, assignShiftTool },
  workflows: { urgentShiftsWorkflow },
  server: {
    apiRoutes: [registerApiRoute('/whatsapp/incoming', {
      method: 'POST',
      handler: async c => {
        const payload = incomingMessage.safeParse(await c.req.json());
        if (!payload.success) {
          console.log('[whatsapp] ignored unsupported webhook', { issues: payload.error.issues.map(issue => ({ path: issue.path, message: issue.message })) });
          return c.json({ ignored: true });
        }
        return c.json(await handleIncomingMessage(payload.data));
      },
    })],
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});

// MVP cron: one run at startup, then one run per interval, without overlapping runs.
// Disable while manually trying the workflow in Studio with SHIFT_POLL_ENABLED=false.
let polling = false;
async function pollUrgentShifts() {
  if (polling) return;
  polling = true;
  try {
    const run = await mastra.getWorkflow('urgentShiftsWorkflow').createRun();
    const result = await run.start({ inputData: {} });
    console.log('[urgent-shifts]', result.status === 'success' ? result.result : result);
  } catch (error) {
    console.error('[urgent-shifts]', error);
  } finally {
    polling = false;
  }
}
if (process.env.SHIFT_POLL_ENABLED !== 'false') {
  const intervalMs = Number(process.env.SHIFT_POLL_INTERVAL_MS || 300_000);
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error('SHIFT_POLL_INTERVAL_MS must be at least 1000');
  setTimeout(() => void pollUrgentShifts(), 1000).unref();
  setInterval(() => void pollUrgentShifts(), intervalMs).unref();
}
