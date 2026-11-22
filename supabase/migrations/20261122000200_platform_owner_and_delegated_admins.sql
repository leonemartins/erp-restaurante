-- GestorPro platform owner and delegated platform administration
-- Sensitive tables are service-role only. All admin operations must be exposed through
-- authenticated Edge Functions that validate the caller and permission server-side.

create table if not exists public.platform_staff (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  permissions jsonb not null default '{}'::jsonb,
  display_name text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_staff_permissions_object check (jsonb_typeof(permissions) = 'object'),
  constraint platform_owner_cannot_be_suspended check (role <> 'owner' or status = 'active')
);

create unique index if not exists platform_staff_single_owner_idx
  on public.platform_staff (role) where role = 'owner';

create table if not exists public.platform_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint platform_audit_details_object check (jsonb_typeof(details) = 'object')
);

create index if not exists platform_audit_created_at_idx
  on public.platform_audit_log (created_at desc);
create index if not exists platform_audit_actor_idx
  on public.platform_audit_log (actor_user_id, created_at desc);
create index if not exists platform_audit_target_idx
  on public.platform_audit_log (target_user_id, created_at desc);

alter table public.platform_staff enable row level security;
alter table public.platform_audit_log enable row level security;

revoke all on public.platform_staff from public, anon, authenticated;
revoke all on public.platform_audit_log from public, anon, authenticated;
grant all on public.platform_staff to service_role;
grant all on public.platform_audit_log to service_role;
grant usage, select on sequence public.platform_audit_log_id_seq to service_role;

comment on table public.platform_staff is
  'GestorPro platform owner and delegated administrators. Access only through server-side authorization.';
comment on table public.platform_audit_log is
  'Immutable-style audit trail for platform administration actions. Writes and reads are server-side only.';
comment on column public.platform_staff.permissions is
  'Granular delegated permissions, e.g. support, customers, onboarding, billing, sales, analytics, user_admin.';
