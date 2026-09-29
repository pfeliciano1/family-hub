-- =====================================================================
-- Family Hub — Alpha 0.9 database setup
--
-- How to run: Supabase dashboard → SQL Editor → New query →
-- paste this whole file → Run.
--
-- Safe to run more than once: it skips anything that already exists.
-- Upgrading from an earlier version? Just run this whole file again;
-- your data stays.
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

-- The signed-in person's own family_members row id.
create or replace function public.my_member_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.family_members where user_id = auth.uid() limit 1;
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

-- Calendars (Alpha 0.5): each one is a private iCal address, usually a
-- Google Calendar "Secret address in iCal format". member_id says whose
-- calendar it is (its color comes from them); empty means the whole family.
create table if not exists public.calendars (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  ical_url   text not null check (ical_url ~* '^(https|webcal)://'),
  member_id  uuid references public.family_members(id) on delete set null,
  color      text not null default '#1976d2' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists calendars_family_idx on public.calendars (family_id);


-- ---------------------------------------------------------------------
-- 3b. Kids (Alpha 0.6): chores, points, rewards, routines, habits
-- ---------------------------------------------------------------------

-- PINs for Kid mode on shared devices. These are a convenience lock for
-- a family tablet, not a security feature: family logins can read them.
alter table public.families      add column if not exists parent_pin_hash text;
alter table public.family_members add column if not exists pin_hash text;

create table if not exists public.rewards (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  icon       text not null default '🎁',
  cost       integer not null check (cost > 0 and cost <= 100000),
  member_id  uuid references public.family_members(id) on delete cascade,  -- empty = any child
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rewards_family_idx on public.rewards (family_id);

-- The prize each child is saving up for.
alter table public.family_members
  add column if not exists goal_reward_id uuid references public.rewards(id) on delete set null;

create table if not exists public.chores (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null default public.my_family_id()
                 references public.families(id) on delete cascade,
  title          text not null check (length(trim(title)) > 0),
  icon           text not null default '🧹',
  assigned_to    uuid not null references public.family_members(id) on delete cascade,
  points         integer not null default 1 check (points >= 0 and points <= 1000),
  frequency      text not null default 'daily' check (frequency in ('daily', 'weekly', 'once')),
  days           smallint[] not null default '{}',   -- weekly: 0 = Sunday … 6 = Saturday
  due_date       date,                               -- once: the day it's due
  needs_approval boolean not null default true,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists chores_family_idx on public.chores (family_id);

create table if not exists public.chore_completions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null default public.my_family_id()
              references public.families(id) on delete cascade,
  chore_id    uuid not null references public.chores(id) on delete cascade,
  member_id   uuid not null references public.family_members(id) on delete cascade,
  for_date    date not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  points      integer not null default 0,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  unique (chore_id, member_id, for_date)
);
create index if not exists chore_completions_family_idx on public.chore_completions (family_id, for_date);

create table if not exists public.reward_claims (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  reward_id  uuid references public.rewards(id) on delete set null,
  member_id  uuid not null references public.family_members(id) on delete cascade,
  title      text not null,
  cost       integer not null check (cost > 0),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists reward_claims_family_idx on public.reward_claims (family_id, created_at);

-- Every point earned or spent. A balance is the sum for that person.
-- ref_key stops the same thing from being counted twice
-- (e.g. two parents approving the same chore at once).
create table if not exists public.point_entries (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  member_id  uuid not null references public.family_members(id) on delete cascade,
  amount     integer not null check (amount between -100000 and 100000 and amount <> 0),
  reason     text not null,
  kind       text not null default 'bonus' check (kind in ('chore', 'routine', 'bonus', 'reward', 'adjust')),
  ref_key    text unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists point_entries_family_idx on public.point_entries (family_id, created_at);

create table if not exists public.routines (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  member_id  uuid not null references public.family_members(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  icon       text not null default '☀️',
  bonus      integer not null default 0 check (bonus >= 0 and bonus <= 1000),  -- points for finishing
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists routines_family_idx on public.routines (family_id);
-- 0.8.1: 'finish' pays the bonus for finishing every step;
-- 'per_step' pays the bonus for each step checked.
alter table public.routines add column if not exists reward_mode text not null default 'finish'
  check (reward_mode in ('finish', 'per_step'));

create table if not exists public.routine_steps (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists routine_steps_family_idx on public.routine_steps (family_id);

create table if not exists public.routine_checks (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  step_id    uuid not null references public.routine_steps(id) on delete cascade,
  for_date   date not null,
  created_at timestamptz not null default now(),
  unique (step_id, for_date)
);
create index if not exists routine_checks_family_idx on public.routine_checks (family_id, for_date);

create table if not exists public.habits (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  member_id  uuid not null references public.family_members(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  icon       text not null default '❤️',
  created_at timestamptz not null default now()
);
create index if not exists habits_family_idx on public.habits (family_id);

create table if not exists public.habit_logs (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  habit_id   uuid not null references public.habits(id) on delete cascade,
  for_date   date not null,
  created_at timestamptz not null default now(),
  unique (habit_id, for_date)
);
create index if not exists habit_logs_family_idx on public.habit_logs (family_id, for_date);

-- ---------------------------------------------------------------------
-- 3c. Food (Alpha 0.7): recipes, meal plan, custom lists
-- ---------------------------------------------------------------------

create table if not exists public.recipes (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null default public.my_family_id()
               references public.families(id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  icon         text not null default '🍽️',
  ingredients  text not null default '',   -- one per line, e.g. "2 lbs ground beef"
  steps        text not null default '',
  prep_minutes integer check (prep_minutes is null or prep_minutes between 0 and 1440),
  servings     integer check (servings is null or servings between 1 and 100),
  tags         text[] not null default '{}',
  source_url   text check (source_url is null or source_url ~* '^https?://'),
  created_at   timestamptz not null default now()
);
create index if not exists recipes_family_idx on public.recipes (family_id);

-- One meal per day and slot. A meal is a recipe, or just a name
-- ("Leftovers", "Pizza night").
create table if not exists public.meal_plan (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  plan_date  date not null,
  slot       text not null default 'dinner' check (slot in ('breakfast', 'lunch', 'dinner')),
  recipe_id  uuid references public.recipes(id) on delete set null,
  title      text not null check (length(trim(title)) > 0),
  note       text,
  created_at timestamptz not null default now(),
  unique (family_id, plan_date, slot)
);
create index if not exists meal_plan_family_idx on public.meal_plan (family_id, plan_date);

create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  icon       text not null default '📝',
  created_at timestamptz not null default now()
);
create index if not exists lists_family_idx on public.lists (family_id);

create table if not exists public.list_items (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  list_id    uuid not null references public.lists(id) on delete cascade,
  text       text not null check (length(trim(text)) > 0),
  is_checked boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists list_items_family_idx on public.list_items (family_id);

-- ---------------------------------------------------------------------
-- 3d. Family life (Alpha 0.8): gifts, home projects, memories
-- ---------------------------------------------------------------------

-- Gift ideas and purchases. A gift for someone in the family who has a
-- login is hidden from them (see the security rules below), unless they
-- added it themselves.
create table if not exists public.gifts (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null default public.my_family_id()
                 references public.families(id) on delete cascade,
  recipient_id   uuid references public.family_members(id) on delete cascade,
  recipient_name text,                      -- for people outside the family
  occasion       text,                      -- e.g. "Christmas", "Ana's birthday"
  occasion_date  date,
  title          text not null check (length(trim(title)) > 0),
  url            text check (url is null or url ~* '^https?://'),
  price          numeric(10, 2) check (price is null or price >= 0),
  status         text not null default 'idea' check (status in ('idea', 'bought', 'wrapped', 'given')),
  note           text,
  created_by     uuid default public.my_member_id() references public.family_members(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (recipient_id is not null or length(trim(coalesce(recipient_name, ''))) > 0)
);
create index if not exists gifts_family_idx on public.gifts (family_id);

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null default public.my_family_id()
              references public.families(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  icon        text not null default '🔨',
  status      text not null default 'planned' check (status in ('idea', 'planned', 'doing', 'done')),
  budget      numeric(10, 2) check (budget is null or budget >= 0),
  target_date date,
  owner_id    uuid references public.family_members(id) on delete set null,
  note        text,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists projects_family_idx on public.projects (family_id);

create table if not exists public.project_tasks (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  is_done    boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists project_tasks_family_idx on public.project_tasks (family_id);

create table if not exists public.project_expenses (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default public.my_family_id()
             references public.families(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  amount     numeric(10, 2) not null check (amount >= 0),
  spent_on   date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists project_expenses_family_idx on public.project_expenses (family_id);

-- A memory: a date, a story, and optionally one photo. Photos are stored
-- in the private "family-photos" storage bucket, in a folder named after
-- the family.
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null default public.my_family_id()
              references public.families(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  happened_on date not null default current_date,
  story       text,
  photo_path  text,
  people      uuid[] not null default '{}',
  created_by  uuid default public.my_member_id() references public.family_members(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (photo_path is null or photo_path like (family_id::text || '/%'))
);
create index if not exists memories_family_idx on public.memories (family_id, happened_on);

-- Private photo storage: 5 MB per photo, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-photos', 'family-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Everyone's point balance in one call (a long history can exceed the
-- number of rows the app loads at once).
create or replace function public.points_balances()
returns table (member_id uuid, balance bigint, earned bigint)
language sql stable security invoker set search_path = public
as $$
  select member_id,
         coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where amount > 0), 0)
  from public.point_entries
  where family_id = public.my_family_id()
  group by member_id;
$$;

-- ---------------------------------------------------------------------
-- 3e. Home layout (Alpha 0.8.3): each person's own card order
-- ---------------------------------------------------------------------

create table if not exists public.home_layouts (
  member_id  uuid primary key references public.family_members(id) on delete cascade,
  family_id  uuid not null references public.families(id) on delete cascade,
  layout     jsonb not null default '{}'::jsonb,   -- { "order": [card ids], "hidden": [card ids] }
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3f. Notifications (Alpha 0.9): push notifications on phones and computers
-- ---------------------------------------------------------------------

-- One row per device where someone turned notifications on, with that
-- device's choices. Rows are added through save_push_subscription().
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  member_id     uuid not null references public.family_members(id) on delete cascade,
  endpoint      text not null unique check (endpoint ~* '^https://'),
  p256dh        text not null check (length(p256dh) between 40 and 200),
  auth          text not null check (length(auth) between 10 and 100),
  device        text,
  tz            text not null default 'America/New_York',
  morning       boolean not null default true,   -- morning summary
  morning_time  time not null default '07:00',
  reminders     boolean not null default true,   -- the day before birthdays and countdowns
  lists         boolean not null default true,   -- new grocery and list items
  last_morning  date,
  last_reminder date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (member_id);

-- The notify function's signing keys and the schedule's secret.
-- Nobody signed in can read this table; only the server can.
create table if not exists public.push_config (
  id           integer primary key default 1 check (id = 1),
  public_key   text,
  private_jwk  jsonb,
  function_url text,
  cron_secret  text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_at   timestamptz not null default now()
);
insert into public.push_config (id) values (1) on conflict (id) do nothing;

-- Grocery and list items waiting to be announced. The notify function
-- sends them in one message once people stop adding for a moment.
create table if not exists public.notify_queue (
  id         bigint generated always as identity primary key,
  family_id  uuid not null references public.families(id) on delete cascade,
  kind       text not null check (kind in ('grocery', 'list')),
  list_id    uuid,
  text       text not null,
  actor      uuid,                                  -- the login that added it (not told about their own)
  created_at timestamptz not null default now()
);

create or replace function public.queue_item_notice()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  row_json jsonb := to_jsonb(new);
begin
  if exists (select 1 from public.push_subscriptions where family_id = new.family_id and lists) then
    insert into public.notify_queue (family_id, kind, list_id, text, actor)
    values (new.family_id,
            case when tg_table_name = 'grocery_items' then 'grocery' else 'list' end,
            (row_json ->> 'list_id')::uuid,
            left(coalesce(row_json ->> 'name', row_json ->> 'text'), 80),
            auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists grocery_items_notice on public.grocery_items;
create trigger grocery_items_notice after insert on public.grocery_items
  for each row execute function public.queue_item_notice();
drop trigger if exists list_items_notice on public.list_items;
create trigger list_items_notice after insert on public.list_items
  for each row execute function public.queue_item_notice();

-- Turn notifications on for this device (or update its keys). If the
-- device was set up by someone else before, it now belongs to you.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_tz text, p_device text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me     uuid := public.my_member_id();
  v_family uuid := public.my_family_id();
  v_id     uuid;
begin
  if v_me is null then
    raise exception 'Join or create a family first.';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and member_id <> v_me;
  insert into public.push_subscriptions (family_id, member_id, endpoint, p256dh, auth, tz, device)
  values (v_family, v_me, p_endpoint, p_p256dh, p_auth,
          coalesce(nullif(trim(p_tz), ''), 'America/New_York'), left(p_device, 40))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz,
        device = excluded.device, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Turn notifications off for a device (knowing its address is proof enough).
create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;


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
alter table public.calendars      enable row level security;
alter table public.rewards           enable row level security;
alter table public.chores            enable row level security;
alter table public.chore_completions enable row level security;
alter table public.reward_claims     enable row level security;
alter table public.point_entries     enable row level security;
alter table public.routines          enable row level security;
alter table public.routine_steps     enable row level security;
alter table public.routine_checks    enable row level security;
alter table public.habits            enable row level security;
alter table public.habit_logs        enable row level security;
alter table public.recipes           enable row level security;
alter table public.meal_plan         enable row level security;
alter table public.lists             enable row level security;
alter table public.list_items        enable row level security;
alter table public.gifts             enable row level security;
alter table public.projects          enable row level security;
alter table public.project_tasks     enable row level security;
alter table public.project_expenses  enable row level security;
alter table public.memories          enable row level security;
alter table public.home_layouts      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_config        enable row level security;  -- no rules: server only
alter table public.notify_queue       enable row level security;  -- no rules: server only

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

-- countdowns, tasks, grocery_items, calendars: anyone in the family can manage them
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

drop policy if exists "Family can manage calendars" on public.calendars;
create policy "Family can manage calendars" on public.calendars
  for all to authenticated
  using (family_id = public.my_family_id())
  with check (family_id = public.my_family_id());

-- Kids tables (0.6): same rule, one family only
do $$
declare
  t text;
begin
  foreach t in array array['rewards', 'chores', 'chore_completions', 'reward_claims', 'point_entries',
                           'routines', 'routine_steps', 'routine_checks', 'habits', 'habit_logs',
                           'recipes', 'meal_plan', 'lists', 'list_items',
                           'projects', 'project_tasks', 'project_expenses', 'memories'] loop
    execute format('drop policy if exists "Family can manage %s" on public.%I', t, t);
    execute format('create policy "Family can manage %s" on public.%I for all to authenticated
                    using (family_id = public.my_family_id())
                    with check (family_id = public.my_family_id())', t, t);
  end loop;
end;
$$;

-- Gifts (0.8): same family, but a gift for you stays hidden from you
-- unless you added it yourself.
drop policy if exists "Family can manage gifts" on public.gifts;
create policy "Family can manage gifts" on public.gifts
  for all to authenticated
  using (
    family_id = public.my_family_id()
    and (recipient_id is distinct from public.my_member_id() or created_by = public.my_member_id())
  )
  with check (family_id = public.my_family_id());

-- Home layout (0.8.3): only your own, nobody else's
drop policy if exists "Members manage their own home layout" on public.home_layouts;
create policy "Members manage their own home layout" on public.home_layouts
  for all to authenticated
  using (member_id = public.my_member_id() and family_id = public.my_family_id())
  with check (member_id = public.my_member_id() and family_id = public.my_family_id());

-- Notifications (0.9): see and change only your own devices
drop policy if exists "Members manage their own devices" on public.push_subscriptions;
create policy "Members manage their own devices" on public.push_subscriptions
  for all to authenticated
  using (member_id = public.my_member_id() and family_id = public.my_family_id())
  with check (member_id = public.my_member_id() and family_id = public.my_family_id());

-- Family photos (0.8): each family can only reach its own folder.
do $$
declare
  op text;
begin
  foreach op in array array['select', 'insert', 'update', 'delete'] loop
    execute format('drop policy if exists "Family photos %s" on storage.objects', op);
    if op = 'insert' then
      execute format('create policy "Family photos %s" on storage.objects for insert to authenticated
                      with check (bucket_id = ''family-photos''
                                  and (storage.foldername(name))[1] = public.my_family_id()::text)', op);
    else
      execute format('create policy "Family photos %s" on storage.objects for %s to authenticated
                      using (bucket_id = ''family-photos''
                             and (storage.foldername(name))[1] = public.my_family_id()::text)', op, op);
    end if;
  end loop;
end;
$$;

-- Records that point to a person, chore, reward, routine, or habit must
-- point to one in the same family.
create or replace function public.same_family_check()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  row_json jsonb := to_jsonb(new);
  ref record;
  ok boolean;
begin
  for ref in
    select v.tbl, row_json ->> v.col as id
    from (values
      ('family_members', 'member_id'),
      ('family_members', 'assigned_to'),
      ('rewards',        'reward_id'),
      ('rewards',        'goal_reward_id'),
      ('chores',         'chore_id'),
      ('routines',       'routine_id'),
      ('routine_steps',  'step_id'),
      ('habits',         'habit_id'),
      ('recipes',        'recipe_id'),
      ('lists',          'list_id'),
      ('family_members', 'recipient_id'),
      ('family_members', 'owner_id'),
      ('family_members', 'created_by'),
      ('projects',       'project_id')
    ) as v(tbl, col)
    where row_json ->> v.col is not null
      -- created_by holds a family member only on gifts and memories; on
      -- older tables (tasks, calendars, points) it holds the login instead
      and (v.col <> 'created_by' or tg_table_name in ('gifts', 'memories'))
  loop
    execute format('select exists (select 1 from public.%I where id = $1 and family_id = $2)', ref.tbl)
      into ok using ref.id::uuid, new.family_id;
    if not ok then
      raise exception 'That item belongs to a different family.';
    end if;
  end loop;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'calendars', 'family_members', 'rewards', 'chores', 'chore_completions',
                           'reward_claims', 'point_entries', 'routines', 'routine_steps',
                           'routine_checks', 'habits', 'habit_logs', 'meal_plan', 'list_items',
                           'gifts', 'projects', 'project_tasks', 'project_expenses', 'memories'] loop
    execute format('drop trigger if exists same_family on public.%I', t);
    execute format('create trigger same_family before insert or update on public.%I
                    for each row execute function public.same_family_check()', t);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Access grants
-- Because "Automatically expose new tables" is off, each table has to be
-- explicitly opened to signed-in users. Signed-out visitors get nothing.
-- ---------------------------------------------------------------------

grant usage on schema public to authenticated;

revoke all on public.families, public.family_members, public.countdowns,
              public.tasks, public.grocery_items, public.calendars,
              public.rewards, public.chores, public.chore_completions, public.reward_claims,
              public.point_entries, public.routines, public.routine_steps, public.routine_checks,
              public.habits, public.habit_logs,
              public.recipes, public.meal_plan, public.lists, public.list_items,
              public.gifts, public.projects, public.project_tasks, public.project_expenses,
              public.memories, public.home_layouts, public.push_subscriptions from anon;
revoke all on public.push_config, public.notify_queue from anon, authenticated;

grant select on public.families to authenticated;
grant update (name, location_name, latitude, longitude, temp_unit, parent_pin_hash)
  on public.families to authenticated;

-- user_id is deliberately left out: logins are only linked through
-- create_family / join_family, never edited directly.
grant select, delete on public.family_members to authenticated;
grant insert (id, family_id, display_name, role, color, birthday, sort_order, pin_hash, goal_reward_id)
  on public.family_members to authenticated;
grant update (display_name, role, color, birthday, sort_order, pin_hash, goal_reward_id)
  on public.family_members to authenticated;

grant select, insert, update, delete
  on public.countdowns, public.tasks, public.grocery_items, public.calendars,
     public.rewards, public.chores, public.chore_completions, public.reward_claims,
     public.point_entries, public.routines, public.routine_steps, public.routine_checks,
     public.habits, public.habit_logs,
     public.recipes, public.meal_plan, public.lists, public.list_items,
     public.gifts, public.projects, public.project_tasks, public.project_expenses,
     public.memories, public.home_layouts to authenticated;

-- Devices are added through save_push_subscription(); only the choices can be edited.
grant select, delete on public.push_subscriptions to authenticated;
grant update (morning, morning_time, reminders, lists, tz, device, updated_at)
  on public.push_subscriptions to authenticated;

revoke all on function public.my_family_id()              from public, anon;
revoke all on function public.i_am_parent()               from public, anon;
revoke all on function public.my_member_id()              from public, anon;
revoke all on function public.create_family(text, text)   from public, anon;
revoke all on function public.join_family(text, text)     from public, anon;
revoke all on function public.points_balances()           from public, anon;
revoke all on function public.same_family_check()         from public, anon;
revoke all on function public.save_push_subscription(text, text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
revoke all on function public.queue_item_notice()          from public, anon, authenticated;
grant execute on function public.my_family_id()            to authenticated;
grant execute on function public.i_am_parent()             to authenticated;
grant execute on function public.my_member_id()            to authenticated;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.join_family(text, text)   to authenticated;
grant execute on function public.points_balances()         to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;


-- ---------------------------------------------------------------------
-- 7. Live sync: broadcast changes to every open device
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['families', 'family_members', 'countdowns', 'tasks', 'grocery_items', 'calendars',
                           'rewards', 'chores', 'chore_completions', 'reward_claims', 'point_entries',
                           'routines', 'routine_steps', 'routine_checks', 'habits', 'habit_logs',
                           'recipes', 'meal_plan', 'lists', 'list_items',
                           'gifts', 'projects', 'project_tasks', 'project_expenses', 'memories'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. Notifications schedule (0.9): once a minute, ask the notify function
-- to send anything that's due. It does nothing until someone turns
-- notifications on, and the notify function has been set up.
-- ---------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.notify_tick()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c record;
begin
  delete from public.notify_queue where created_at < now() - interval '1 day';
  if not exists (select 1 from public.push_subscriptions) then
    return;
  end if;
  select function_url, cron_secret into c from public.push_config where id = 1;
  if c.function_url is null then
    return; -- set the first time the app asks the notify function for its key
  end if;
  perform net.http_post(
    url := c.function_url,
    body := '{"action": "run"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.cron_secret),
    timeout_milliseconds := 25000
  );
end;
$$;
revoke all on function public.notify_tick() from public, anon, authenticated;

do $$
begin
  perform cron.schedule('family-hub-notify', '* * * * *', 'select public.notify_tick()');
end;
$$;

-- Done! You should see "Success. No rows returned."
