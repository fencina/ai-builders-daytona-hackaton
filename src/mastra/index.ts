import { Mastra } from '@mastra/core/mastra';
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
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { shiftAgent } from './agents/shift-agent';
import { shiftOverviewTool, shiftSearchTool, shiftDecisionTool } from './tools/shift-tools';
import { shiftChatRoute } from './routes/shift-chat';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { agent, shiftAgent },
  tools: { startScheduleTool, stopScheduleTool, shiftOverviewTool, shiftSearchTool, shiftDecisionTool },
  server: {
    host: '127.0.0.1',
    apiRoutes: [shiftChatRoute],
    middleware: [async (context,next) => {
      // The requested SQLite location is beneath public/. Never serve it as a static asset.
      const pathname=decodeURIComponent(new URL(context.req.url).pathname).toLowerCase();
      if(pathname.includes('/.data') || /\.(db|sqlite|sqlite3)(-|$)/.test(pathname)) return context.text('Not found',404);
      await next();
    }],
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
