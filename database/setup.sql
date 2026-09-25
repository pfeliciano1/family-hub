-- =====================================================================
-- Family Hub — Alpha 0.4 database setup
--
-- How to run: Supabase dashboard → SQL Editor → New query →
-- paste this whole file → Run.
--
-- Safe to run more than once: it skips anything that already exists.
-- If Supabase warns that the query contains "drop" statements, that's
-- expected — it only drops and re-creates the security rules below.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Family and members
-- ---------------------------------------------------------------------

create table if not exists public.families (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Our Family',
  invite_code   text not null unique
                default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  location_name text,
  latitude      double precision,
  longitude     double precision,
  temp_unit     text not null default 'fahrenheit'
                check (temp_unit in ('fahrenheit', 'celsius')),
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- A member is a person in the family. Adults who sign in are linked to
-- their login through user_id; kids can exist without a login.
create table if not exists public.family_members (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  display_name text not null check (length(trim(display_name)) > 0),
  role         text not null default 'child' check (role in ('parent', 'child')),
  color        text not null default '#1976d2' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  birthday     date,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- Each login belongs to exactly one family.
create unique index if not exists family_members_one_family_per_user
  on public.family_members (user_id) where user_id is not null;
create index if not exists family_members_family_idx
  on public.family_members (family_id);


-- ---------------------------------------------------------------------
-- 2. Helper functions used by the security rules
-- ---------------------------------------------------------------------

-- The family the signed-in person belongs to.
create or replace function public.my_family_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select family_id from public.family_members where user_id = auth.uid() limit 1;
$$;

-- Whether the signed-in person is a parent.
create or replace function public.i_am_parent()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.family_members where user_id = auth.uid() and role = 'parent'
  );
$$;


-- ---------------------------------------------------------------------
-- 3. Feature tables
-- ---------------------------------------------------------------------

create table if not exists public.countdowns (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null default public.my_family_id()
                    references public.families(id) on delete cascade,
  title             text not null check (length(trim(title)) > 0),
  event_date        date not null,
  category          text not null default 'custom',
  repeats_yearly    boolean not null default false,
  show_on_dashboard boolean not null default true,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists countdowns_family_idx on public.countdowns (family_id);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null default public.my_family_id()
              references public.families(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  assigned_to uuid references public.family_members(id) on delete set null,
  due_date    date,
  is_done     boolean not null default false,
  done_at     timestamptz,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists tasks_family_idx on public.tasks (family_id);

create table if not exists public.grocery_items (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  quantity   text,
  category   text not null default 'Other',
  is_checked boolean not null default false,
  added_by   uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists grocery_items_family_idx on public.grocery_items (family_id);


-- ---------------------------------------------------------------------
-- 4. Onboarding: create a family, or join one with an invite code
-- ---------------------------------------------------------------------

create or replace function public.create_family(p_family_name text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_family uuid;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  if public.my_family_id() is not null then
    raise exception 'You already belong to a family.';
  end if;

  insert into public.families (name, created_by)
  values (coalesce(nullif(trim(p_family_name), ''), 'Our Family'), auth.uid())
  returning id into v_family;

  insert into public.family_members (family_id, user_id, display_name, role)
  values (v_family, auth.uid(), coalesce(nullif(trim(p_display_name), ''), 'Parent'), 'parent');

  return v_family;
end;
$$;

create or replace function public.join_family(p_invite_code text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_family uuid;
  v_name   text := coalesce(nullif(trim(p_display_name), ''), 'Parent');
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  if public.my_family_id() is not null then
    raise exception 'You already belong to a family.';
  end if;

  select id into v_family
  from public.families
  where invite_code = upper(trim(p_invite_code));

  if v_family is null then
    raise exception 'That invite code was not found. Check it and try again.';
  end if;

  -- If a parent profile with this name already exists without a login,
  -- link it instead of creating a duplicate.
  update public.family_members
  set user_id = auth.uid()
  where id = (
    select id from public.family_members
    where family_id = v_family
      and user_id is null
      and role = 'parent'
      and lower(display_name) = lower(v_name)
    order by created_at
    limit 1
  );

  if not found then
    insert into public.family_members (family_id, user_id, display_name, role, sort_order)
    values (
      v_family, auth.uid(), v_name, 'parent',
      (select coalesce(max(sort_order), 0) + 1 from public.family_members where family_id = v_family)
    );
  end if;

  return v_family;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Row Level Security: people only ever see their own family's data
-- ---------------------------------------------------------------------

alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.countdowns     enable row level security;
alter table public.tasks          enable row level security;
alter table public.grocery_items  enable row level security;

-- families
drop policy if exists "Members can view their family" on public.families;
create policy "Members can view their family" on public.families
  for select to authenticated
  using (id = public.my_family_id());

drop policy if exists "Parents can update their family" on public.families;
create policy "Parents can update their family" on public.families
  for update to authenticated
  using (id = public.my_family_id() and public.i_am_parent())
  with check (id = public.my_family_id());

-- family_members
drop policy if exists "Members can view their family members" on public.family_members;
create policy "Members can view their family members" on public.family_members
  for select to authenticated
  using (family_id = public.my_family_id());

drop policy if exists "Parents can add members" on public.family_members;
create policy "Parents can add members" on public.family_members
  for insert to authenticated
  with check (family_id = public.my_family_id() and public.i_am_parent());

drop policy if exists "Parents can edit members" on public.family_members;
create policy "Parents can edit members" on public.family_members
  for update to authenticated
  using (family_id = public.my_family_id() and public.i_am_parent())
  with check (family_id = public.my_family_id());

drop policy if exists "Parents can remove other members" on public.family_members;
create policy "Parents can remove other members" on public.family_members
  for delete to authenticated
  using (
    family_id = public.my_family_id()
    and public.i_am_parent()
    and user_id is distinct from auth.uid()
  );

-- countdowns, tasks, grocery_items: anyone in the family can manage them
drop policy if exists "Family can manage countdowns" on public.countdowns;
create policy "Family can manage countdowns" on public.countdowns
  for all to authenticated
  using (family_id = public.my_family_id())
  with check (family_id = public.my_family_id());

drop policy if exists "Family can manage tasks" on public.tasks;
create policy "Family can manage tasks" on public.tasks
  for all to authenticated
  using (family_id = public.my_family_id())
  with check (family_id = public.my_family_id());

drop policy if exists "Family can manage grocery items" on public.grocery_items;
create policy "Family can manage grocery items" on public.grocery_items
  for all to authenticated
  using (family_id = public.my_family_id())
  with check (family_id = public.my_family_id());


-- ---------------------------------------------------------------------
-- 6. Access grants
-- Because "Automatically expose new tables" is off, each table has to be
-- explicitly opened to signed-in users. Signed-out visitors get nothing.
-- ---------------------------------------------------------------------

grant usage on schema public to authenticated;

revoke all on public.families, public.family_members, public.countdowns,
              public.tasks, public.grocery_items from anon;

grant select on public.families to authenticated;
grant update (name, location_name, latitude, longitude, temp_unit)
  on public.families to authenticated;

-- user_id is deliberately left out: logins are only linked through
-- create_family / join_family, never edited directly.
grant select, delete on public.family_members to authenticated;
grant insert (family_id, display_name, role, color, birthday, sort_order)
  on public.family_members to authenticated;
grant update (display_name, role, color, birthday, sort_order)
  on public.family_members to authenticated;

grant select, insert, update, delete
  on public.countdowns, public.tasks, public.grocery_items to authenticated;

revoke all on function public.my_family_id()              from public, anon;
revoke all on function public.i_am_parent()               from public, anon;
revoke all on function public.create_family(text, text)   from public, anon;
revoke all on function public.join_family(text, text)     from public, anon;
grant execute on function public.my_family_id()            to authenticated;
grant execute on function public.i_am_parent()             to authenticated;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.join_family(text, text)   to authenticated;


-- ---------------------------------------------------------------------
-- 7. Live sync: broadcast changes to every open device
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['families', 'family_members', 'countdowns', 'tasks', 'grocery_items'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Done! You should see "Success. No rows returned."
