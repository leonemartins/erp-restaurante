-- WhatsApp Business integration for supplier quotations.
-- Consent is opt-in and defaults to false; no supplier is messaged until explicitly authorized.
alter table public.suppliers
  add column if not exists whatsapp_opt_in boolean not null default false,
  add column if not exists whatsapp_opt_in_at timestamptz;

alter table public.supplier_quote_links
  add column if not exists whatsapp_token_hash text,
  add column if not exists whatsapp_sent_at timestamptz,
  add column if not exists whatsapp_message_id text,
  add column if not exists last_whatsapp_error text;

create table if not exists public.supplier_quote_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  quote_id uuid references public.purchase_quotes(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  phone text not null,
  message_type text not null default 'text',
  body text,
  provider_message_id text,
  status text not null default 'received',
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists supplier_quote_whatsapp_messages_provider_id_uidx
  on public.supplier_quote_whatsapp_messages(provider_message_id)
  where provider_message_id is not null;

create index if not exists supplier_quote_whatsapp_messages_quote_created_idx
  on public.supplier_quote_whatsapp_messages(quote_id, created_at desc);

create index if not exists supplier_quote_whatsapp_messages_phone_created_idx
  on public.supplier_quote_whatsapp_messages(phone, created_at desc);

alter table public.supplier_quote_whatsapp_messages enable row level security;
revoke all on table public.supplier_quote_whatsapp_messages from anon, authenticated, public;
grant select, insert, update, delete on table public.supplier_quote_whatsapp_messages to service_role;
