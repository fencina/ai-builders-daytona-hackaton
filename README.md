# ai-builders-daytona-hackaton

Welcome to your new [Mastra](https://mastra.ai) project! We're excited to see what you build.

This starter provides you with a general-purpose Mastra agent that can research current information, manage multi-step tasks, work with local files, run approved shell commands, and create recurring schedules.

## Features

- A local `workspace/` for files and command execution (created under `src/mastra/public/workspace/` when running `mastra dev`)
- Approval gates for file changes, deletions, and shell commands
- Conversation memory, generated thread titles, and task tracking
- Built-in web search and direct web page fetching
- Recurring schedules that persist across restarts
- Local libSQL storage and DuckDB observability, with optional Turso storage
- A bundled Mastra skill that helps coding agents use current Mastra APIs

## Get started

Set your `OPENAI_API_KEY` in `.env` or in your environment, then run:

```shell
npm run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/studio/overview).

Select **Agent** in Mastra Studio and try one of these prompts:

- `Get the weather forecast for Austin this weekend.`
- `Create a landing page for a Japanese sakura festival.`
- `Check the SPCX stock price now, then check it every minute.`

The agent asks for approval before it changes files or runs commands. When it creates a schedule, it returns an ID that you can use to pause the schedule.

## OpenWA local app

OpenWA is included as an independent application in `apps/openwa/`, with its own dependencies and configuration. Its source is integrated into this repository, not managed as a Git submodule. Upstream: https://github.com/rmyndharis/OpenWA (the upstream MIT license is preserved in the application directory).

From the repository root:

```shell
npm run install:openwa
npm run dev:openwa
```

- Dashboard: http://localhost:2886
- API: http://localhost:2785/api
- Swagger: http://localhost:2785/api/docs

OpenWA requires Node.js >=22.19. On first startup it generates local configuration and saves the admin API key in `apps/openwa/data/.api-key`. Use it to sign in to the dashboard; do not commit or share it. Environment files, session data, and dependencies are excluded by the application's `.gitignore`.

Mastra runs separately with `npm run dev`. OpenWA is an unofficial WhatsApp gateway: use a dedicated test number because account restrictions are possible.

## Turno: mobile-first shift management

`apps/web/` is a Next.js application with a day/week/month calendar, stores, employees, pending applications, activity log, and an administrator chat. `packages/db/` contains the shared SQLite business rules. No sample employees or shifts are inserted automatically.

The **Turnos** section provides a management table with role/store search, store and coverage-status filters, a local-date range, date sorting, and pages of 10 rows. **Gestionar** opens the existing shift detail for applications and coverage. **Equipo** displays employees in a table with name/phone/store search, store and active/inactive filters, name sorting, and pagination. Both tables scroll horizontally on small screens without widening the page. Creation continues through the existing forms; editing/deletion is not added by these table views.

Requirements: Node.js >=22.19 (the app uses the native `node:sqlite` module), persistent local disk, and one host for all three services.

```shell
npm install
npm run install:web
# Configure Supabase Auth in apps/web/.env.local (see below).
npm run dev:web
```

Open http://localhost:3000. Authentication is managed by **Supabase Auth**, not SQLite. The development servers bind to loopback.

### Supabase Auth

Configure these server-only variables in `apps/web/.env.local` (see `.env.example`):

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_ADMIN_USER_ID=the-approved-auth-user-uuid
SUPABASE_ADMIN_EMAIL=your-admin-email
ADMIN_USERNAME=messi
```

Use a publishable key, not `service_role` or a secret API key. There is no browser Supabase client and no public signup screen. `messi` is a server-side alias for the configured email; both the alias and email can be used to log in. Every protected API validates the user with `auth.getUser()` and requires the pinned user ID **and** confirmed email. Other Supabase users do not become administrators. User-editable metadata is never used to grant permissions.

To retain additional administrators, set `SUPABASE_ADDITIONAL_ADMINS` to a JSON array of `{ "userId": "auth-user-uuid", "email": "admin@example.com", "username": "unique-alias" }`. Each account must exist and be confirmed in Supabase Auth. IDs, emails and aliases must be unique across the primary and additional accounts. Access and recovery select the matching identity; adding a Supabase user alone does not grant access. This server-side allowlist is forwarded by the Daytona launcher on deployment; a running deployment must be updated separately to receive changed configuration.

For a new administrator, load the variables above plus `ADMIN_PASSWORD` securely in your shell and run `node --env-file=apps/web/.env.local apps/web/scripts/create-admin.mjs` once. The script uses the Auth signup API, sends the normal email confirmation, and returns the new ID to configure as `SUPABASE_ADMIN_USER_ID`. It does not write to `auth.users` via SQL, bypass confirmation, or overwrite an existing account's password. Never put the password in a committed file. Use a private email inbox for real data; disposable/public inboxes are demo-only.

Next.js `proxy.ts` refreshes cookies before authenticated rendering. Cookies are HTTP-only, SameSite=Lax, and Secure in production. Authenticated responses use `Cache-Control: private, no-store`. Session duration, refresh-token rotation, password storage, and authentication rate limits are managed by Supabase. Old `turno_session` cookies and the legacy SQLite password hashes are no longer accepted; existing legacy tables are preserved rather than deleted.

The login screen supports resending confirmation and password recovery. In **Supabase Dashboard → Authentication → URL Configuration**, allow the exact application origin and these redirect URLs for each environment:

- `http://localhost:3000/auth/confirmed`
- `http://localhost:3000/auth/callback`
- The equivalent exact HTTPS URLs for your deployed app.

Set `APP_ORIGIN` to the public HTTPS origin behind a reverse proxy. Start recovery at `/auth/recover` without entering the old password. Recovery uses PKCE: open the recovery link in the same browser/hostname that requested it (do not switch between `localhost` and `127.0.0.1`). At `/auth/callback`, click **Continuar y crear contraseña**; opening or prefetching the page alone does not consume the code. The callback also accepts recovery token-hash links and legacy fragment-based recovery links; credentials are removed from browser history and verified on the server before establishing HTTP-only cookies. If Supabase falls back to the root Site URL, the application forwards recovery parameters to this callback instead of silently discarding them.

A valid administrator session can set a new password of at least 12 characters at `/auth/password`. The form displays an explicit success message and link to the calendar. Consumed/expired links, missing PKCE verifiers, password-policy errors, and email quotas have distinct messages. No arbitrary redirect target is accepted. Outbound recovery/confirmation email delivery depends on the project's SMTP configuration and limits. The default test email service may allow only **2 emails per hour**; HTTP 429 requires waiting for quota to replenish or configuring custom SMTP in Supabase Auth. Repeatedly requesting links does not bypass that limit. Never reset passwords through direct writes to the managed `auth.users` table.

**Scope:** this change moves authentication to Supabase. Stores, employees, turns, invitations, applications, assignments, events, and settings still use SQLite until their separate PostgreSQL migration. The Mastra and OpenWA storage configurations are unchanged.

The business database is **`src/mastra/public/.data/mastra.db`**, configurable via `SHIFTS_DATABASE_PATH` (absolute or root-relative). Business tables use the `shifts_` prefix and do not replace Mastra's tables or its existing storage configuration. WAL mode, foreign keys, and transactions protect assignments. Never serve the database directory as public static files; Next.js does not expose it. Do not expose Mastra Studio publicly.

### WhatsApp and Mastra setup

1. Run OpenWA (`npm run dev:openwa`) and link a dedicated test number through its dashboard.
2. In the web application's **Configuración**, save the OpenWA session ID and the administrator's international phone number. Register stores and employees in **Equipo**; employees must consent to WhatsApp invitations.
3. Copy `apps/web/.env.example` to `apps/web/.env.local`. Set a random `OPENWA_WEBHOOK_SECRET`. Configure an OpenWA webhook on the selected session with event **`message.received`**, the same secret, and URL `http://127.0.0.1:3000/api/webhooks/openwa`. OpenWA's SSRF controls may require an explicit development-only allowance for loopback delivery; consult its security documentation rather than disabling protection globally.
4. Set `OPENAI_API_KEY` in the root `.env` and run Mastra with `npm run dev`. The dedicated `shiftAgent` is registered alongside the existing general-purpose agent. It has only overview, search, and decision tools, with server-side administrative authorization.
5. Create a future shift. When WhatsApp is configured, the app starts a bounded invitation batch automatically; coverage can also be started from the shift detail or requested through the agent. Employees reply **`SI <invitation-id>`** or **`NO <invitation-id>`**. The receiver verifies HMAC, session, sender, and message deduplication. Privacy LIDs and group chats are refused rather than mistaken for phone numbers.
6. Acceptance creates a pending application and notifies the administrator. Approve/reject in the web UI, with **`APROBAR <application-id>`** / **`RECHAZAR <application-id>`** on WhatsApp, or in natural language through the authenticated Mastra chat. Natural-language WhatsApp messages currently carry only the current message: include the employee/turn details instead of ambiguous references such as “approve him”. Approval checks cupos and schedule conflicts transactionally and notifies the employee.

Mastra's custom `/internal/shift-chat` route and the web `/api/internal` route use a random shared credential stored in the local database, never returned to the browser. Ordinary direct calls to the dedicated agent's tools lack administrative context and cannot access the business operations. Keep the generic starter agent and Studio private, as they retain local shell/filesystem capabilities.

### MVP boundaries

- Eligibility currently means active employee, assigned store, and no overlapping confirmed shift; recurring availability, rest-time rules, and labor-law checks are not implemented.
- New shifts trigger a batch if connected. There is no background retry/reminder/expiry worker yet. After rejections, start another search manually or through the agent. Pending outbound invitations count against the batch to avoid repeated outreach.
- WhatsApp uses deterministic replies for employees; free-text employee conversation is not implemented. Administrator chat uses Mastra.
- A network timeout can leave delivery uncertain. Such invitations are not automatically retried. Inbound partial failures are recorded in Activity and require review to avoid duplicate side effects. A durable outbox/reconciliation worker is future work.
- Day/week/month are mobile agenda views; week uses a day selector, not an hourly desktop grid. Creation and approvals are implemented; editing/canceling shifts and removing assignments are not yet implemented.
- Calendar input and display use the browser's local timezone. WhatsApp messages use `SHIFTS_TIMEZONE`; use the same zone on administrator devices for this MVP.

Verification commands: `npm run test:turnos`, `npm run test:web`, `npm --prefix apps/web run typecheck`, `npm run build:web`, and `npm run build` for Mastra. `test:web` uses an isolated SQLite database and local Supabase Auth/OpenWA stubs, including tests against forged sessions and non-admin users; it does not send real emails or WhatsApp messages.

The integration test also covers recovery request → token verification → password change → logout → rejection of the old password → login with the new password, plus link replay, other-user rejection and email rate limits. To include the mobile browser flow, set `BROWSER_EXECUTABLE_PATH` to an installed Chromium-compatible browser when running `npm run test:web` (it uses the Puppeteer dependency in `apps/openwa`). SQLite snapshot rows are normalized to plain objects before passing them to React Server Components; regression tests cover populated databases, not only empty dashboards.

## Run the complete project in Daytona

The TypeScript launcher uploads the current application sources (including uncommitted,
non-ignored source files) and runs **web + Mastra + OpenWA + Chromium** in a single private
sandbox. SQLite databases and WhatsApp sessions are created there, not copied from your machine.
Redis/Postgres/MinIO and Docker are not required for this single-instance setup.

1. Set `DAYTONA_API_KEY` and `OPENAI_API_KEY` in `.env.daytona`, plus the Supabase Auth variables
   documented above (these can also be read from `apps/web/.env.local`). `ADMIN_USERNAME` defaults to `messi`.
   Do not commit or share environment files. Existing environment variables take precedence.
2. Run `npm run daytona:deploy`. It creates a sandbox with Node 22, 4 CPU, 8 GiB RAM,
   10 GiB disk, installs dependencies and builds all three applications. Initial provisioning
   can take several minutes. Build and service logs are in `/app/turno/.daytona/logs/`.
3. Open the `urls.web`, `urls.openwa` and `urls.mastra` (Mastra Studio) links stored in the ignored `.daytona/state.json`.
   They are **private bearer links**, valid for 24 hours: do not publish this file or its URLs.
   `npm run daytona:urls` renews both links and the web dashboard's OpenWA shortcut.
4. Sign in with the configured Supabase administrator. The sandbox receives the publishable key
   and pinned identity, never the administrator's password. OpenWA serves its compiled dashboard and API together on
   port 2785 (not the local Vite port 2886). Retrieve its generated admin key privately from
   `/app/turno/apps/openwa/data/.api-key` using the Daytona dashboard/terminal; never paste it into chat.
   Pair a dedicated test WhatsApp number via QR and save the session ID in the web settings.
   The web reads the key server-side from the same filesystem.

Services communicate over loopback: web `3000`, Mastra `4111`, OpenWA `2785`.
All three have private preview links. Mastra includes the native Studio production bundle
(`npm run build -- --studio`, served with `MASTRA_STUDIO_PATH`) and binds to `0.0.0.0` only
inside the private sandbox. Local Mastra still defaults to `127.0.0.1`.
Never make the sandbox public: Studio exposes administrative agent and tool access.
To enable Studio on a previously deployed sandbox, run `npm run daytona:studio`. It updates
the runtime, stops services gracefully, rebuilds Mastra with Studio and restarts the stack,
preserving databases and WhatsApp sessions. Expect a brief service interruption.
Both web and Mastra use the same absolute `SHIFTS_DATABASE_PATH`.
The launcher also configures the exact HTTPS preview origins for web CSRF checks and OpenWA
CORS; it does not trust arbitrary forwarded host headers or use wildcard origins.

For incoming WhatsApp events, configure the existing web integration's webhook in OpenWA using
the internal URL `http://127.0.0.1:3000/api/webhooks/openwa` (no Daytona preview token needed).
The generated secret is stored privately in `/app/turno/.daytona/runtime.json` under
`OPENWA_WEBHOOK_SECRET`; use it as the webhook's signing secret and subscribe to
`message.received` on the paired session. The receiver validates `x-openwa-signature` (HMAC SHA-256).
The launcher explicitly allows `127.0.0.1` through OpenWA's SSRF guard without disabling the guard
for other hosts. Creating the webhook still requires the paired session and is not automatic.

Lifecycle commands:

```shell
npm run daytona:status
npm run daytona:resume # retry incomplete setup in the same recorded sandbox
npm run daytona:stop
npm run daytona:start
npm run daytona:urls
```

**Cost and persistence:** automatic stop/pause and automatic deletion are disabled so WhatsApp
does not disconnect in the middle of a demo. Stop the sandbox explicitly when finished; storage
charges may still apply. Stop/start retains the sandbox filesystem; it does not provide backups
or survival after sandbox deletion. Restart with `daytona:start` to relaunch the services.
The launcher deliberately refuses to overwrite an existing recorded deployment or local WhatsApp
sessions. If provisioning fails, the sandbox ID is saved immediately for inspection and manual
recovery or deletion in Daytona. Use `npm run daytona:resume` to retry incomplete provisioning in
that same sandbox; do not rerun deployment expecting it to create another sandbox. Resume overlays
application sources and repeats dependency installation/builds without copying local databases or sessions.
The source archive is cached in `.daytona/source.tar.gz`; subsequent resumes reuse that exact
archive and skip remote chunks whose SHA-256 matches. To deploy a different source revision after
an interrupted setup, deliberately replace that cached archive rather than expecting resume to refresh it.

`npm run test:daytona` tests the source-upload exclusion rules. A real cloud run requires your
Daytona credentials and quota; local checks alone do not verify QR pairing or WhatsApp delivery.

## Workspace safety

The local filesystem tools stay inside the `workspace/` directory, which resolves relative to the server's working directory (`src/mastra/public/workspace/` during `mastra dev`). Shell commands start in that directory, but `LocalSandbox` does not provide operating-system isolation by default. Review command approvals carefully, and do not expose this template through an unauthenticated public server.

## Storage

The default `file:./mastra.db` database stores agent memory, tasks, and schedules locally. To use Turso, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`.

Recurring schedules continue to use model tokens until you pause them. Ask the agent to pause a schedule with the ID returned by `start_schedule`.

## Making it yours

- Edit `src/mastra/agents/agent.ts` to change the model, instructions, memory, workspace, or approval policy.
- Edit `src/mastra/tools/` to customize scheduling.
- Edit `src/mastra/index.ts` to change storage and observability.
- Add files or reusable skills under `src/mastra/public/workspace/` for the agent to use during `mastra dev`.

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). If you're new to AI agents, check out our [course](https://mastra.ai/learn) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/mastra-ai) community to get help and share your projects.

## Deploy to the Mastra platform

The [Mastra platform](https://projects.mastra.ai) provides two products for deploying and managing AI applications built with the Mastra framework. Learn more in the [Mastra platform documentation](https://mastra.ai/docs/mastra-platform/overview).
