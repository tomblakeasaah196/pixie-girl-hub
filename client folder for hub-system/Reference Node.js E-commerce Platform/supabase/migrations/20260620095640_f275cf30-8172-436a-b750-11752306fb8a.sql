
-- =========================================================
-- 1. Roles (admin / moderator / user) + has_role()
-- =========================================================
do $$ begin
  create type public.app_role as enum ('admin','moderator','user');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

drop policy if exists "users read own roles" on public.user_roles;
create policy "users read own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

drop policy if exists "admins manage roles" on public.user_roles;
create policy "admins manage roles" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

-- =========================================================
-- 2. Site content overrides (Studio-ready editable layer)
-- =========================================================
create table if not exists public.site_content_overrides (
  key text primary key,                    -- e.g. "why_choose", "artistry:product:pixie-curly-bob"
  scope text not null default 'global',    -- 'global' | 'collection' | 'product'
  scope_id text,                           -- null for global, else slug
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

grant select on public.site_content_overrides to anon, authenticated;
grant all on public.site_content_overrides to service_role;

alter table public.site_content_overrides enable row level security;

drop policy if exists "anyone reads content overrides" on public.site_content_overrides;
create policy "anyone reads content overrides" on public.site_content_overrides
  for select to anon, authenticated using (true);

drop policy if exists "admins write content overrides" on public.site_content_overrides;
create policy "admins write content overrides" on public.site_content_overrides
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

create trigger trg_site_content_overrides_updated_at
  before update on public.site_content_overrides
  for each row execute function public.tg_set_updated_at();

-- =========================================================
-- 3. Services
-- =========================================================
do $$ begin
  create type public.service_location as enum ('studio','home','virtual');
exception when duplicate_object then null; end $$;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  short_description text,
  long_description text,
  thumbnail_url text,
  gallery_urls text[] not null default '{}',
  tags text[] not null default '{}',
  meta_title text,
  meta_description text,
  price_ngn numeric(12,2),
  compare_at_price_ngn numeric(12,2),
  price_is_from boolean not null default false,
  duration_minutes int,
  buffer_minutes int not null default 0,
  required_stylist_tier text,
  is_bookable boolean not null default true,
  is_visible_storefront boolean not null default true,
  is_featured boolean not null default false,
  deposit_required boolean not null default false,
  deposit_pct numeric(5,2),
  deposit_amount_ngn numeric(12,2),
  location_type public.service_location not null default 'studio',
  cancellation_policy text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.services to anon, authenticated;
grant all on public.services to service_role;

alter table public.services enable row level security;

drop policy if exists "anyone reads published services" on public.services;
create policy "anyone reads published services" on public.services
  for select to anon, authenticated
  using (is_visible_storefront = true and published_at is not null and published_at <= now());

drop policy if exists "admins manage services" on public.services;
create policy "admins manage services" on public.services
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

create trigger trg_services_updated_at
  before update on public.services
  for each row execute function public.tg_set_updated_at();

-- =========================================================
-- 4. Bookings
-- =========================================================
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  service_id uuid not null references public.services(id) on delete restrict,
  scheduled_at timestamptz not null,
  duration_minutes int not null,
  location_type public.service_location not null,
  address jsonb,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  notes text,
  deposit_amount_ngn numeric(12,2),
  deposit_paid boolean not null default false,
  payment_provider text,                       -- 'stripe' | 'paystack' | 'nomba' | null
  status text not null default 'pending_deposit',
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.bookings to authenticated;
grant all on public.bookings to service_role;

alter table public.bookings enable row level security;

drop policy if exists "users see own bookings" on public.bookings;
create policy "users see own bookings" on public.bookings
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "users create own bookings" on public.bookings;
create policy "users create own bookings" on public.bookings
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "users update own pending bookings" on public.bookings;
create policy "users update own pending bookings" on public.bookings
  for update to authenticated
  using (auth.uid() = user_id and status in ('pending_deposit','confirmed'))
  with check (auth.uid() = user_id);

drop policy if exists "admins manage bookings" on public.bookings;
create policy "admins manage bookings" on public.bookings
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.tg_set_updated_at();

-- =========================================================
-- 5. Seed example services
-- =========================================================
insert into public.services (slug, name, short_description, long_description, tags,
  meta_title, meta_description,
  price_ngn, compare_at_price_ngn, price_is_from,
  duration_minutes, buffer_minutes, required_stylist_tier,
  is_bookable, is_visible_storefront, is_featured,
  deposit_required, deposit_pct, location_type, cancellation_policy, published_at)
values
  ('signature-pixie-install', 'Signature Pixie Install',
    'Our flagship glueless pixie install — cut, melt and style in one sitting.',
    'A full styling appointment with a senior Faitlyn stylist. We pre-cut, custom-bleach the knots, melt the lace and finish with a couture cut tailored to your face shape.',
    array['install','pixie','signature'],
    'Signature Pixie Install — Faitlyn Studio Lagos',
    'Book a Signature Pixie install with a senior Faitlyn stylist in our Lagos studio. Glueless, hand-finished, ready to wear.',
    180000, 220000, true, 150, 30, 'senior', true, true, true,
    true, 30, 'studio',
    'Free cancellation up to 48h before your appointment. Within 48h, the deposit is non-refundable.',
    now()),
  ('home-styling-lagos', 'Home Styling — Lagos',
    'A senior stylist comes to you anywhere in Lagos for a full pixie styling session.',
    'We bring the Faitlyn studio to your home. Includes wash, conditioning treatment, lace prep, and a finished couture cut. Lagos mainland and island only.',
    array['install','home','lagos'],
    'In-Home Pixie Styling — Lagos | Faitlyn',
    'A Faitlyn senior stylist comes to your Lagos home for a full pixie install and styling session.',
    250000, null, true, 180, 60, 'senior', true, true, false,
    true, 50, 'home',
    'Free cancellation up to 72h before your appointment. Within 72h, 50% of the deposit is retained.',
    now()),
  ('virtual-style-consult', 'Virtual Style Consultation',
    '30-minute live consult — pick the right silhouette, shade and length for you.',
    'A one-on-one video call with a Faitlyn stylist to walk through your face shape, lifestyle and shade preferences. You leave with a personalised pick of three Faitlyn pieces and care guidance.',
    array['consultation','virtual'],
    'Virtual Pixie Style Consultation | Faitlyn',
    'Book a 30-minute virtual styling consultation with a Faitlyn stylist. Personalised silhouette, shade and length picks.',
    25000, null, false, 30, 0, 'any', true, true, false,
    false, null, 'virtual',
    'Free cancellation or reschedule up to 24h before the call.',
    now())
on conflict (slug) do nothing;
