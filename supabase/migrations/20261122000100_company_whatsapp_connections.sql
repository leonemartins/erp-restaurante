-- Per-company WhatsApp Cloud API connections for GestorPro SaaS.
-- Access tokens are encrypted by the Edge Function before persistence.
-- This table is intentionally service-role-only; browser clients never read credentials.
create table if not exists public.company_whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  meta_business_id text,
  waba_id text not null,
  phone_number_id text not null,
  display_phone_number text,
  verified_name text,
  encrypted_access_token text not null,
  token_expires_at timestamptz,
  onboarding_mode text not null default 'standard'
    check (onboarding_mode in ('standard','coexistence')),
  connection_status text not null default 'pending'
    check (connection_status in ('pending','active','reauth_required','disconnected','error')),
  granted_scopes text[] not null default '{}',
  connected_by uuid references auth.users(id) on delete set null,
  last_webhook_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_whatsapp_connections_company_uidx unique (company_id),
  constraint company_whatsapp_connections_waba_uidx unique (waba_id),
  constraint company_whatsapp_connections_phone_uidx unique (phone_number_id)
);

create index if not exists company_whatsapp_connections_status_idx
  on public.company_whatsapp_connections(connection_status);

alter table public.company_whatsapp_connections enable row level security;
revoke all on table public.company_whatsapp_connections from anon, authenticated, public;
grant all on table public.company_whatsapp_connections to service_role;

comment on table public.company_whatsapp_connections is
  'One WhatsApp Business Platform connection per GestorPro company. Access tokens must be encrypted server-side; never expose this table to browser clients.';
