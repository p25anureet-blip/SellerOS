-- =============================================================================
-- SellerOS Phase 0 foundation: accounts, organizations (tenants), memberships,
-- and the marketplace reference list.
--
-- Security model (applies to every table added in later phases):
--   * Every business table carries organization_id.
--   * Row Level Security (RLS) is enabled on every table.
--   * Access is decided by public.is_org_member(organization_id).
--   * The anon role (logged-out visitors) is granted nothing on these tables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- Keeps updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create type public.org_role as enum ('owner', 'admin', 'member');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- One row per login user. The login itself lives in auth.users (managed by Supabase).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  avatar_url  text check (char_length(avatar_url) <= 2048),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A seller company (the "tenant"). All business data hangs off this.
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  -- Indian GST Identification Number: 15 characters, e.g. 27AAPFU0939F1ZV.
  gstin       text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  currency    text not null default 'INR' check (currency = 'INR'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Which users belong to which organizations, and with what role.
create table public.organization_members (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.org_role not null default 'member',
  created_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- The primary key already indexes organization_id first; this speeds up
-- "which organizations is this user in?", which every RLS check asks.
create index organization_members_user_id_idx on public.organization_members (user_id);

-- Reference list of sales channels. Not tenant data: the same for everyone.
-- Fee values are illustrative defaults for the demo, not official fee schedules;
-- category-specific fees are added in a later phase.
create table public.marketplaces (
  code                    text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name                    text not null,
  channel_type            text not null check (channel_type in ('ecommerce', 'quick_commerce')),
  integration_mode        text not null default 'simulated'
                            check (integration_mode in ('simulated', 'api', 'file')),
  commission_pct          numeric(5, 2) not null check (commission_pct between 0 and 100),
  fixed_fee_inr           numeric(10, 2) not null default 0 check (fixed_fee_inr >= 0),
  shipping_fee_inr        numeric(10, 2) not null default 0 check (shipping_fee_inr >= 0),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Authorization helpers
--
-- SECURITY DEFINER lets these read organization_members without triggering that
-- table's own RLS policy (which would otherwise call is_org_member again and
-- recurse). search_path = '' prevents search-path hijacking. They only ever
-- answer questions about the *calling* user (auth.uid()).
-- -----------------------------------------------------------------------------

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(org_id uuid, roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Sign-up: create the profile, a personal organization and owner membership.
-- Runs inside the same transaction as the auth.users insert, so a sign-up either
-- gets all three rows or fails entirely.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  v_org_name  text := nullif(btrim(new.raw_user_meta_data ->> 'organization_name'), '');
  v_org_id    uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(v_full_name, 120));

  insert into public.organizations (name, created_by)
  values (
    left(coalesce(v_org_name, v_full_name || '''s Store', 'My Store'), 120),
    new.id
  )
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Privileges. Supabase grants broad table privileges to anon/authenticated by
-- default; we replace that with the minimum each role needs. RLS then decides
-- *which rows* those privileges apply to.
-- -----------------------------------------------------------------------------

revoke all on public.profiles, public.organizations, public.organization_members,
  public.marketplaces from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

grant select on public.organizations to authenticated;
-- Only these columns are editable; created_by, currency, ids and timestamps are not.
grant update (name, gstin) on public.organizations to authenticated;

-- Read-only for now. Inviting members and changing roles arrive in a later phase,
-- through a server-side function that can enforce the rules safely.
grant select on public.organization_members to authenticated;

grant select on public.marketplaces to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.marketplaces enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Members can view their organizations"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

create policy "Owners and admins can update their organization"
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

create policy "Members can view memberships of their organizations"
  on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));

create policy "Signed-in users can view marketplaces"
  on public.marketplaces for select to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- Reference data
-- -----------------------------------------------------------------------------

insert into public.marketplaces
  (code, name, channel_type, commission_pct, fixed_fee_inr, shipping_fee_inr)
values
  ('amazon_in',        'Amazon India',     'ecommerce',      15.00, 20.00, 60.00),
  ('flipkart',         'Flipkart',         'ecommerce',      14.00, 20.00, 55.00),
  ('meesho',           'Meesho',           'ecommerce',       0.00,  0.00, 70.00),
  ('myntra',           'Myntra',           'ecommerce',      22.00, 25.00, 50.00),
  ('blinkit',          'Blinkit',          'quick_commerce', 18.00, 10.00,  0.00),
  ('zepto',            'Zepto',            'quick_commerce', 17.00, 10.00,  0.00),
  ('swiggy_instamart', 'Swiggy Instamart', 'quick_commerce', 18.00, 10.00,  0.00);
