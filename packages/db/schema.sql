-- Turno business schema for Supabase PostgreSQL.
-- Kept in a non-exposed schema: the browser never queries it directly.
-- All writes go through public.turno_execute, executable only by service_role.

create schema if not exists turno;
revoke all on schema turno from public, anon, authenticated;

create table if not exists turno.stores (
  id uuid primary key,
  name text not null check (length(trim(name)) between 2 and 100),
  address text not null default '' check (length(address) <= 200),
  created_at timestamptz not null default now()
);

create table if not exists turno.employees (
  id uuid primary key,
  name text not null check (length(trim(name)) between 2 and 100),
  phone text not null unique check (phone ~ '^[1-9][0-9]{7,14}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists turno.employee_stores (
  employee_id uuid not null references turno.employees(id) on delete cascade,
  store_id uuid not null references turno.stores(id) on delete cascade,
  primary key (employee_id, store_id)
);

create table if not exists turno.shifts (
  id uuid primary key,
  store_id uuid not null references turno.stores(id),
  role text not null check (length(trim(role)) between 2 and 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 100),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours')
);

create table if not exists turno.invitations (
  id uuid primary key,
  shift_id uuid not null references turno.shifts(id) on delete cascade,
  employee_id uuid not null references turno.employees(id) on delete cascade,
  status text not null check (status in ('sending', 'sent', 'uncertain', 'accepted', 'declined', 'failed')),
  created_at timestamptz not null default now(),
  unique (shift_id, employee_id)
);

create table if not exists turno.applications (
  id uuid primary key,
  shift_id uuid not null references turno.shifts(id) on delete cascade,
  employee_id uuid not null references turno.employees(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (shift_id, employee_id)
);

create table if not exists turno.assignments (
  id uuid primary key,
  shift_id uuid not null references turno.shifts(id) on delete cascade,
  employee_id uuid not null references turno.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (shift_id, employee_id)
);

create table if not exists turno.events (
  id uuid primary key,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists turno.settings (
  key text primary key,
  value text not null
);

create table if not exists turno.webhook_events (
  id text primary key,
  created_at timestamptz not null default now()
);

create index if not exists shifts_dates_idx on turno.shifts (starts_at, ends_at);
create index if not exists invitations_shift_status_idx on turno.invitations (shift_id, status);
create index if not exists applications_shift_status_idx on turno.applications (shift_id, status);
create index if not exists assignments_employee_idx on turno.assignments (employee_id);
create index if not exists events_created_idx on turno.events (created_at desc);

-- Defense in depth: no policies means anon/authenticated see nothing even if
-- the schema is ever exposed. service_role bypasses RLS for server-side calls.
alter table turno.stores enable row level security;
alter table turno.employees enable row level security;
alter table turno.employee_stores enable row level security;
alter table turno.shifts enable row level security;
alter table turno.invitations enable row level security;
alter table turno.applications enable row level security;
alter table turno.assignments enable row level security;
alter table turno.events enable row level security;
alter table turno.settings enable row level security;
alter table turno.webhook_events enable row level security;

revoke all on all tables in schema turno from public, anon, authenticated;
grant usage on schema turno to service_role;
grant select, insert, update, delete on all tables in schema turno to service_role;
