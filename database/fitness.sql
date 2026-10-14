-- =====================================================================
-- Family Hub — Fitness (Alpha 0.10) database setup
--
-- How to run: Supabase dashboard → SQL Editor → New query →
-- paste this whole file → Run. Run database/setup.sql (Alpha 0.9) first.
--
-- Add-only: this file creates new fitness_* tables, rules and one
-- function. It never changes, renames or removes anything that already
-- exists. Safe to run more than once; your workouts stay.
-- To undo it completely, run database/rollback_fitness.sql.
--
-- Privacy: each login sees only its own fitness profile and workouts.
-- The built-in routines and the exercise library are shared, read-only.
-- The family display only gets first name, streak and workouts this
-- week, for people who turn that on, and only within their own family.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- One row per login: weight for calorie estimates, slot finder settings
create table if not exists public.fitness_profiles (
  user_id                uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  weight_lbs             numeric check (weight_lbs is null or weight_lbs between 50 and 700),
  weight_updated_at      timestamptz,
  workout_calendar_ids   uuid[] not null default '{}',   -- rows of public.calendars that count as busy
  slot_window_start      time not null default '06:00',
  slot_window_end        time not null default '21:00',
  slot_buffer_min        int  not null default 5 check (slot_buffer_min between 0 and 60),
  show_on_family_display boolean not null default false,
  updated_at             timestamptz not null default now(),
  check (slot_window_end > slot_window_start)
);

-- Shared exercise library, from Free Exercise DB (public domain).
-- Filled by this file only; the app can read it but not change it.
create table if not exists public.fitness_exercises (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  muscle_group text,
  equipment    text,
  instructions text,
  image_urls   text[] not null default '{}',   -- 1–2 frames, files in assets/exercises/
  source       text not null default 'free-exercise-db'
);

-- Routines. owner_id empty = built-in, visible to everyone signed in.
create table if not exists public.fitness_routines (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),
  category    text not null check (category in ('run', 'cardio', 'abs', 'strength', 'mobility')),
  est_minutes int  not null check (est_minutes between 10 and 45),
  met_value   numeric not null check (met_value between 1 and 20),
  rounds      int  not null default 1 check (rounds between 1 and 10),  -- times through the whole list
  description text,
  created_at  timestamptz not null default now()
);
create index if not exists fitness_routines_owner_idx on public.fitness_routines (owner_id);

-- The steps of a routine, in order. A step either points to an exercise
-- (with a picture) or is just a label, like "Easy jog". label also
-- renames an exercise, e.g. "Side plank (left)".
create table if not exists public.fitness_routine_steps (
  id           uuid primary key default gen_random_uuid(),
  routine_id   uuid not null references public.fitness_routines(id) on delete cascade,
  position     int  not null,
  exercise_id  uuid references public.fitness_exercises(id) on delete set null,
  label        text check (label is null or length(label) <= 80),
  sets         int check (sets is null or sets between 1 and 20),
  reps         int check (reps is null or reps between 1 and 500),
  duration_sec int check (duration_sec is null or duration_sec between 5 and 7200),
  rest_sec     int check (rest_sec is null or rest_sec between 0 and 600),
  check (exercise_id is not null or label is not null),
  check (reps is not null or duration_sec is not null),
  unique (routine_id, position)
);

-- What each person did. Calories are worked out when logged and kept,
-- so old entries don't change when weight changes.
create table if not exists public.fitness_logs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id          uuid references public.fitness_routines(id) on delete set null,
  category            text not null check (category in ('run', 'cardio', 'abs', 'strength', 'mobility')),
  performed_at        timestamptz not null default now(),
  duration_min        numeric not null check (duration_min > 0 and duration_min <= 600),
  distance_mi         numeric check (distance_mi is null or (distance_mi > 0 and distance_mi <= 200)),
  effort_rpe          int check (effort_rpe is null or effort_rpe between 1 and 10),
  weight_lbs_snapshot numeric check (weight_lbs_snapshot is null or weight_lbs_snapshot between 50 and 700),
  met_value           numeric check (met_value is null or met_value between 1 and 20),
  calories_est        numeric check (calories_est is null or calories_est between 0 and 10000),
  notes               text check (notes is null or length(notes) <= 1000),
  source              text not null default 'manual' check (source in ('routine', 'manual', 'import')),
  created_at          timestamptz not null default now()
);
create index if not exists fitness_logs_user_time_idx on public.fitness_logs (user_id, performed_at desc);


-- ---------------------------------------------------------------------
-- 2. Security rules: your own rows only
-- ---------------------------------------------------------------------

alter table public.fitness_profiles      enable row level security;
alter table public.fitness_exercises     enable row level security;
alter table public.fitness_routines      enable row level security;
alter table public.fitness_routine_steps enable row level security;
alter table public.fitness_logs          enable row level security;

drop policy if exists "Own fitness profile" on public.fitness_profiles;
create policy "Own fitness profile" on public.fitness_profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Signed-in can read exercises" on public.fitness_exercises;
create policy "Signed-in can read exercises" on public.fitness_exercises
  for select to authenticated using (true);

drop policy if exists "Read built-in and own routines" on public.fitness_routines;
create policy "Read built-in and own routines" on public.fitness_routines
  for select to authenticated using (owner_id is null or owner_id = auth.uid());
drop policy if exists "Add own routines" on public.fitness_routines;
create policy "Add own routines" on public.fitness_routines
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "Change own routines" on public.fitness_routines;
create policy "Change own routines" on public.fitness_routines
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Delete own routines" on public.fitness_routines;
create policy "Delete own routines" on public.fitness_routines
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "Read steps of visible routines" on public.fitness_routine_steps;
create policy "Read steps of visible routines" on public.fitness_routine_steps
  for select to authenticated using (exists (
    select 1 from public.fitness_routines r
    where r.id = routine_id and (r.owner_id is null or r.owner_id = auth.uid())));
drop policy if exists "Manage steps of own routines" on public.fitness_routine_steps;
create policy "Manage steps of own routines" on public.fitness_routine_steps
  for all to authenticated
  using (exists (select 1 from public.fitness_routines r where r.id = routine_id and r.owner_id = auth.uid()))
  with check (exists (select 1 from public.fitness_routines r where r.id = routine_id and r.owner_id = auth.uid()));

drop policy if exists "Own workouts" on public.fitness_logs;
create policy "Own workouts" on public.fitness_logs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 3. Access grants ("Automatically expose new tables" is off)
-- ---------------------------------------------------------------------

revoke all on public.fitness_profiles, public.fitness_exercises, public.fitness_routines,
              public.fitness_routine_steps, public.fitness_logs from anon;
revoke insert, update, delete, truncate on public.fitness_exercises from authenticated;
grant select on public.fitness_exercises to authenticated;
grant select, insert, update, delete on public.fitness_profiles, public.fitness_routines,
      public.fitness_routine_steps, public.fitness_logs to authenticated;
grant select, insert, update, delete on public.fitness_profiles, public.fitness_exercises,
      public.fitness_routines, public.fitness_routine_steps, public.fitness_logs to service_role;


-- ---------------------------------------------------------------------
-- 4. Family display: name, streak and workouts this week, for people in
-- your own family who turned "show on the family display" on. Nothing
-- else about their workouts is shared.
-- p_tz is the device's time zone (e.g. 'America/New_York'); days and
-- weeks (Monday to Sunday) are counted in it.
-- ---------------------------------------------------------------------

create or replace function public.fitness_family_summary(p_tz text default 'UTC')
returns table (member_id uuid, display_name text, current_streak int, workouts_this_week int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tz    text := coalesce((select name from pg_timezone_names where name = p_tz limit 1), 'UTC');
  v_today date := (now() at time zone v_tz)::date;
begin
  return query
  with people as (
    select m.id, m.display_name, m.user_id
    from family_members m
    join fitness_profiles p on p.user_id = m.user_id and p.show_on_family_display
    where m.family_id = my_family_id() and m.user_id is not null
  ),
  days as (
    select distinct l.user_id, (l.performed_at at time zone v_tz)::date as d
    from fitness_logs l join people pp on pp.user_id = l.user_id
    where l.performed_at >= now() - interval '400 days'
  ),
  -- The streak counts back from today, or from yesterday if nothing is logged yet today
  starts as (
    select pp.user_id,
      case when exists (select 1 from days x where x.user_id = pp.user_id and x.d = v_today) then v_today
           else v_today - 1 end as s
    from people pp
  ),
  runs as (
    select st.user_id, x.d, st.s - x.d as back, row_number() over (partition by st.user_id order by x.d desc) - 1 as rn
    from starts st join days x on x.user_id = st.user_id and x.d <= st.s
  )
  select pp.id, pp.display_name,
    coalesce((select count(*)::int from runs r where r.user_id = pp.user_id and r.back = r.rn), 0),
    (select count(*)::int from fitness_logs l where l.user_id = pp.user_id
       and (l.performed_at at time zone v_tz)::date >= date_trunc('week', v_today)::date
       and (l.performed_at at time zone v_tz)::date <= v_today)
  from people pp
  order by pp.display_name;
end $$;

revoke all on function public.fitness_family_summary(text) from public, anon;
grant execute on function public.fitness_family_summary(text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Exercise library and the 15 built-in routines
-- Exercises and pictures: Free Exercise DB by yuhonas
-- (github.com/yuhonas/free-exercise-db), public domain (Unlicense).
-- Re-running this section refreshes the built-ins; your own routines and
-- workouts are left alone.
-- ---------------------------------------------------------------------

insert into public.fitness_exercises (slug, name, muscle_group, equipment, instructions, image_urls) values
  ('star-jump', 'Star Jump', 'quadriceps', 'none', 'Begin in a relaxed stance with your feet shoulder width apart and hold your arms close to the body.
To initiate the move, squat down halfway and explode back up as high as possible. Fully extend your entire body, spreading your legs and arms away from the body.
As you land, bring your limbs back in and absorb your impact through the legs.', array['assets/exercises/star-jump/0.jpg', 'assets/exercises/star-jump/1.jpg']::text[]),
  ('mountain-climbers', 'Mountain Climbers', 'quadriceps', 'none', 'Begin in a pushup position, with your weight supported by your hands and toes. Flexing the knee and hip, bring one leg until the knee is approximately under the hip. This will be your starting position.
Explosively reverse the positions of your legs, extending the bent leg until the leg is straight and supported by the toe, and bringing the other foot up with the hip and knee flexed. Repeat in an alternating fashion for 20-30 seconds.', array['assets/exercises/mountain-climbers/0.jpg', 'assets/exercises/mountain-climbers/1.jpg']::text[]),
  ('freehand-jump-squat', 'Freehand Jump Squat', 'quadriceps', 'none', 'Cross your arms over your chest.
With your head up and your back straight, position your feet at shoulder width.
Keeping your back straight and chest up, squat down as you inhale until your upper thighs are parallel, or lower, to the floor.
Now pressing mainly with the ball of your feet, jump straight up in the air as high as possible, using the thighs like springs. Exhale during this portion of the movement.
When you touch the floor again, immediately squat down and jump again.
Repeat for the recommended amount of repetitions.', array['assets/exercises/freehand-jump-squat/0.jpg', 'assets/exercises/freehand-jump-squat/1.jpg']::text[]),
  ('lateral-bound', 'Lateral Bound', 'adductors', 'none', 'Assume a half squat position facing 90 degrees from your direction of travel. This will be your starting position.
Allow your lead leg to do a countermovement inward as you shift your weight to the outside leg.
Immediately push off and extend, attempting to bound to the side as far as possible.
Upon landing, immediately push off in the opposite direction, returning to your original start position.
Continue back and forth for several repetitions.', array['assets/exercises/lateral-bound/0.jpg', 'assets/exercises/lateral-bound/1.jpg']::text[]),
  ('single-leg-butt-kick', 'Single Leg Butt Kick', 'quadriceps', 'none', 'Begin by standing on one leg, with the bent knee raised. This will be your start position.
Using a countermovement jump, take off upward by extending the hip, knee, and ankle of the grounded leg.
Immediately flex the knee and attempt to touch your butt with the heel of your jumping leg.
Return the leg to a partially bent position underneath the hips and land. Your opposite leg should stay in relatively the same position throughout the drill.', array['assets/exercises/single-leg-butt-kick/0.jpg', 'assets/exercises/single-leg-butt-kick/1.jpg']::text[]),
  ('rope-jumping', 'Rope Jumping', 'quadriceps', 'other', 'Hold an end of the rope in each hand. Position the rope behind you on the ground. Raise your arms up and turn the rope over your head bringing it down in front of you. When it reaches the ground, jump over it. Find a good turning pace that can be maintained. Different speeds and techniques can be used to introduce variation.
Rope jumping is exciting, challenges your coordination, and requires a lot of energy. A 150 lb person will burn about 350 calories jumping rope for 30 minutes, compared to over 450 calories running.', array['assets/exercises/rope-jumping/0.jpg', 'assets/exercises/rope-jumping/1.jpg']::text[]),
  ('dumbbell-rear-lunge', 'Dumbbell Rear Lunge', 'quadriceps', 'dumbbell', 'Stand with your torso upright holding two dumbbells in your hands by your sides. This will be your starting position.
Step backward with your right leg around two feet or so from the left foot and lower your upper body down, while keeping the torso upright and maintaining balance. Inhale as you go down. Tip: As in the other exercises, do not allow your knee to go forward beyond your toes as you come down, as this will put undue stress on the knee joint. Make sure that you keep your front shin perpendicular to the ground. Keep the torso upright during the lunge; flexible hip flexors are important. A long lunge emphasizes the Gluteus Maximus; a short lunge emphasizes Quadriceps.
Push up and go back to the starting position as you exhale. Tip: Use the ball of your feet to push in order to accentuate the quadriceps. To focus on the glutes, press with your heels.
Now repeat with the opposite leg.', array['assets/exercises/dumbbell-rear-lunge/0.jpg', 'assets/exercises/dumbbell-rear-lunge/1.jpg']::text[]),
  ('crunches', 'Crunches', 'abdominals', 'none', 'Lie flat on your back with your feet flat on the ground, or resting on a bench with your knees bent at a 90 degree angle. If you are resting your feet on a bench, place them three to four inches apart and point your toes inward so they touch.
Now place your hands lightly on either side of your head keeping your elbows in. Tip: Don''t lock your fingers behind your head.
While pushing the small of your back down in the floor to better isolate your abdominal muscles, begin to roll your shoulders off the floor.
Continue to push down as hard as you can with your lower back as you contract your abdominals and exhale. Your shoulders should come up off the floor only about four inches, and your lower back should remain on the floor. At the top of the movement, contract your abdominals hard and keep the contraction for a second. Tip: Focus on slow, controlled movement - don''t cheat yourself by using momentum.
After the one second contraction, begin to come down slowly again to the starting position as you inhale.
Repeat for the recommended amount of repetitions.', array['assets/exercises/crunches/0.jpg', 'assets/exercises/crunches/1.jpg']::text[]),
  ('air-bike', 'Air Bike', 'abdominals', 'none', 'Lie flat on the floor with your lower back pressed to the ground. For this exercise, you will need to put your hands beside your head. Be careful however to not strain with the neck as you perform it. Now lift your shoulders into the crunch position.
Bring knees up to where they are perpendicular to the floor, with your lower legs parallel to the floor. This will be your starting position.
Now simultaneously, slowly go through a cycle pedal motion kicking forward with the right leg and bringing in the knee of the left leg. Bring your right elbow close to your left knee by crunching to the side, as you breathe out.
Go back to the initial position as you breathe in.
Crunch to the opposite side as you cycle your legs and bring closer your left elbow to your right knee and exhale.
Continue alternating in this manner until all of the recommended repetitions for each side have been completed.', array['assets/exercises/air-bike/0.jpg', 'assets/exercises/air-bike/1.jpg']::text[]),
  ('plank', 'Plank', 'abdominals', 'none', 'Get into a prone position on the floor, supporting your weight on your toes and your forearms. Your arms are bent and directly below the shoulder.
Keep your body straight at all times, and hold this position as long as possible. To increase difficulty, an arm or leg can be raised.', array['assets/exercises/plank/0.jpg', 'assets/exercises/plank/1.jpg']::text[]),
  ('flat-bench-lying-leg-raise', 'Flat Bench Lying Leg Raise', 'abdominals', 'none', 'Lie with your back flat on a bench and your legs extended in front of you off the end.
Place your hands either under your glutes with your palms down or by the sides holding on to the bench. This will be your starting position.
As you keep your legs extended, straight as possible with your knees slightly bent but locked raise your legs until they make a 90-degree angle with the floor. Exhale as you perform this portion of the movement and hold the contraction at the top for a second.
Now, as you inhale, slowly lower your legs back down to the starting position.', array['assets/exercises/flat-bench-lying-leg-raise/0.jpg', 'assets/exercises/flat-bench-lying-leg-raise/1.jpg']::text[]),
  ('side-bridge', 'Side Bridge', 'abdominals', 'none', '', array['assets/exercises/side-bridge/0.jpg', 'assets/exercises/side-bridge/1.jpg']::text[]),
  ('dead-bug', 'Dead Bug', 'abdominals', 'none', 'Begin lying on your back with your hands extended above you toward the ceiling.
Bring your feet, knees, and hips up to 90 degrees.
Exhale hard to bring your ribcage down and flatten your back onto the floor, rotating your pelvis up and squeezing your glutes. Hold this position throughout the movement. This will be your starting position.
Initiate the exercise by extending one leg, straightening the knee and hip to bring the leg just above the ground.
Maintain the position of your lumbar and pelvis as you perform the movement, as your back is going to want to arch.
Stay tight and return the working leg to the starting position.
Repeat on the opposite side, alternating until the set is complete.', array['assets/exercises/dead-bug/0.jpg', 'assets/exercises/dead-bug/1.jpg']::text[]),
  ('russian-twist', 'Russian Twist', 'abdominals', 'none', 'Lie down on the floor placing your feet either under something that will not move or by having a partner hold them. Your legs should be bent at the knees.
Elevate your upper body so that it creates an imaginary V-shape with your thighs. Your arms should be fully extended in front of you perpendicular to your torso and with the hands clasped. This is the starting position.
Twist your torso to the right side until your arms are parallel with the floor while breathing out.
Hold the contraction for a second and move back to the starting position while breathing out. Now move to the opposite side performing the same techniques you applied to the right side.
Repeat for the recommended amount of repetitions.', array['assets/exercises/russian-twist/0.jpg', 'assets/exercises/russian-twist/1.jpg']::text[]),
  ('reverse-crunch', 'Reverse Crunch', 'abdominals', 'none', 'Lie down on the floor with your legs fully extended and arms to the side of your torso with the palms on the floor. Your arms should be stationary for the entire exercise.
Move your legs up so that your thighs are perpendicular to the floor and feet are together and parallel to the floor. This is the starting position.
While inhaling, move your legs towards the torso as you roll your pelvis backwards and you raise your hips off the floor. At the end of this movement your knees will be touching your chest.
Hold the contraction for a second and move your legs back to the starting position while exhaling.
Repeat for the recommended amount of repetitions.', array['assets/exercises/reverse-crunch/0.jpg', 'assets/exercises/reverse-crunch/1.jpg']::text[]),
  ('scissor-kick', 'Scissor Kick', 'abdominals', 'none', 'To begin, lie down with your back pressed against the floor or on an exercise mat (optional). Your arms should be fully extended to the sides with your palms facing down. Note: The arms should be stationary the entire time.
With a slight bend at the knees, lift your legs up so that your heels are about 6 inches off the ground. This is the starting position.
Now lift your left leg up to about a 45 degree angle while your right leg is lowered until the heel is about 2-3 inches from the ground.
Switch movements by raising your right leg up and lowering your left leg. Remember to breathe while performing this exercise.
Repeat for the recommended amount of repetitions.', array['assets/exercises/scissor-kick/0.jpg', 'assets/exercises/scissor-kick/1.jpg']::text[]),
  ('pushups', 'Pushups', 'chest', 'none', 'Lie on the floor face down and place your hands about 36 inches apart while holding your torso up at arms length.
Next, lower yourself downward until your chest almost touches the floor as you inhale.
Now breathe out and press your upper body back up to the starting position while squeezing your chest.
After a brief pause at the top contracted position, you can begin to lower yourself downward again for as many repetitions as needed.', array['assets/exercises/pushups/0.jpg', 'assets/exercises/pushups/1.jpg']::text[]),
  ('bodyweight-squat', 'Bodyweight Squat', 'quadriceps', 'none', 'Stand with your feet shoulder width apart. You can place your hands behind your head. This will be your starting position.
Begin the movement by flexing your knees and hips, sitting back with your hips.
Continue down to full depth if you are able,and quickly reverse the motion until you return to the starting position. As you squat, keep your head and chest up and push your knees out.', array['assets/exercises/bodyweight-squat/0.jpg', 'assets/exercises/bodyweight-squat/1.jpg']::text[]),
  ('butt-lift-bridge', 'Butt Lift (Bridge)', 'glutes', 'none', 'Lie flat on the floor on your back with the hands by your side and your knees bent. Your feet should be placed around shoulder width. This will be your starting position.
Pushing mainly with your heels, lift your hips off the floor while keeping your back straight. Breathe out as you perform this part of the motion and hold at the top for a second.
Slowly go back to the starting position as you breathe in.', array['assets/exercises/butt-lift-bridge/0.jpg', 'assets/exercises/butt-lift-bridge/1.jpg']::text[]),
  ('one-arm-dumbbell-row', 'One-Arm Dumbbell Row', 'middle back', 'dumbbell', 'Choose a flat bench and place a dumbbell on each side of it.
Place the right leg on top of the end of the bench, bend your torso forward from the waist until your upper body is parallel to the floor, and place your right hand on the other end of the bench for support.
Use the left hand to pick up the dumbbell on the floor and hold the weight while keeping your lower back straight. The palm of the hand should be facing your torso. This will be your starting position.
Pull the resistance straight up to the side of your chest, keeping your upper arm close to your side and keeping the torso stationary. Breathe out as you perform this step. Tip: Concentrate on squeezing the back muscles once you reach the full contracted position. Also, make sure that the force is performed with the back muscles and not the arms. Finally, the upper torso should remain stationary and only the arms should move. The forearms should do no other work except for holding the dumbbell; therefore do not try to pull the dumbbell up using the forearms.
Lower the resistance straight down to the starting position. Breathe in as you perform this step.
Repeat the movement for the specified amount of repetitions.
Switch sides and repeat again with the other arm.', array['assets/exercises/one-arm-dumbbell-row/0.jpg', 'assets/exercises/one-arm-dumbbell-row/1.jpg']::text[]),
  ('dumbbell-shoulder-press', 'Dumbbell Shoulder Press', 'shoulders', 'dumbbell', 'While holding a dumbbell in each hand, sit on a military press bench or utility bench that has back support. Place the dumbbells upright on top of your thighs.
Now raise the dumbbells to shoulder height one at a time using your thighs to help propel them up into position.
Make sure to rotate your wrists so that the palms of your hands are facing forward. This is your starting position.
Now, exhale and push the dumbbells upward until they touch at the top.
Then, after a brief pause at the top contracted position, slowly lower the weights back down to the starting position while inhaling.
Repeat for the recommended amount of repetitions.', array['assets/exercises/dumbbell-shoulder-press/0.jpg', 'assets/exercises/dumbbell-shoulder-press/1.jpg']::text[]),
  ('bench-dips', 'Bench Dips', 'triceps', 'none', 'For this exercise you will need to place a bench behind your back. With the bench perpendicular to your body, and while looking away from it, hold on to the bench on its edge with the hands fully extended, separated at shoulder width. The legs will be extended forward, bent at the waist and perpendicular to your torso. This will be your starting position.
Slowly lower your body as you inhale by bending at the elbows until you lower yourself far enough to where there is an angle slightly smaller than 90 degrees between the upper arm and the forearm. Tip: Keep the elbows as close as possible throughout the movement. Forearms should always be pointing down.
Using your triceps to bring your torso up again, lift yourself back to the starting position.
Repeat for the recommended amount of repetitions.', array['assets/exercises/bench-dips/0.jpg', 'assets/exercises/bench-dips/1.jpg']::text[]),
  ('dumbbell-bicep-curl', 'Dumbbell Bicep Curl', 'biceps', 'dumbbell', 'Stand up straight with a dumbbell in each hand at arm''s length. Keep your elbows close to your torso and rotate the palms of your hands until they are facing forward. This will be your starting position.
Now, keeping the upper arms stationary, exhale and curl the weights while contracting your biceps. Continue to raise the weights until your biceps are fully contracted and the dumbbells are at shoulder level. Hold the contracted position for a brief pause as you squeeze your biceps.
Then, inhale and slowly begin to lower the dumbbells back to the starting position.
Repeat for the recommended amount of repetitions.', array['assets/exercises/dumbbell-bicep-curl/0.jpg', 'assets/exercises/dumbbell-bicep-curl/1.jpg']::text[]),
  ('goblet-squat', 'Goblet Squat', 'quadriceps', 'kettlebell', 'Stand holding a light kettlebell by the horns close to your chest. This will be your starting position.
Squat down between your legs until your hamstrings are on your calves. Keep your chest and head up and your back straight.
At the bottom position, pause and use your elbows to push your knees out. Return to the starting position, and repeat for 10-20 repetitions.', array['assets/exercises/goblet-squat/0.jpg', 'assets/exercises/goblet-squat/1.jpg']::text[]),
  ('stiff-legged-dumbbell-deadlift', 'Stiff-Legged Dumbbell Deadlift', 'hamstrings', 'dumbbell', 'Grasp a couple of dumbbells holding them by your side at arm''s length.
Stand with your torso straight and your legs spaced using a shoulder width or narrower stance. The knees should be slightly bent. This is your starting position.
Keeping the knees stationary, lower the dumbbells to over the top of your feet by bending at the waist while keeping your back straight. Keep moving forward as if you were going to pick something from the floor until you feel a stretch on the hamstrings. Exhale as you perform this movement
Start bringing your torso up straight again by extending your hips and waist until you are back at the starting position. Inhale as you perform this movement.
Repeat for the recommended amount of repetitions.', array['assets/exercises/stiff-legged-dumbbell-deadlift/0.jpg', 'assets/exercises/stiff-legged-dumbbell-deadlift/1.jpg']::text[]),
  ('split-squat-with-dumbbells', 'Split Squat with Dumbbells', 'quadriceps', 'dumbbell', 'Position yourself into a staggered stance with the rear foot elevated and front foot forward.
Hold a dumbbell in each hand, letting them hang at the sides. This will be your starting position.
Begin by descending, flexing your knee and hip to lower your body down. Maintain good posture througout the movement. Keep the front knee in line with the foot as you perform the exercise.
At the bottom of the movement, drive through the heel to extend the knee and hip to return to the starting position.', array['assets/exercises/split-squat-with-dumbbells/0.jpg', 'assets/exercises/split-squat-with-dumbbells/1.jpg']::text[]),
  ('standing-dumbbell-calf-raise', 'Standing Dumbbell Calf Raise', 'calves', 'dumbbell', 'Stand with your torso upright holding two dumbbells in your hands by your sides. Place the ball of the foot on a sturdy and stable wooden board (that is around 2-3 inches tall) while your heels extend off and touch the floor. This will be your starting position.
With the toes pointing either straight (to hit all parts equally), inwards (for emphasis on the outer head) or outwards (for emphasis on the inner head), raise the heels off the floor as you exhale by contracting the calves. Hold the top contraction for a second.
As you inhale, go back to the starting position by slowly lowering the heels.
Repeat for the recommended amount of times.', array['assets/exercises/standing-dumbbell-calf-raise/0.jpg', 'assets/exercises/standing-dumbbell-calf-raise/1.jpg']::text[]),
  ('cat-stretch', 'Cat Stretch', 'lower back', 'none', 'Position yourself on the floor on your hands and knees.
Pull your belly in and round your spine, lower back, shoulders, and neck, letting your head drop.
Hold for 15 seconds.', array['assets/exercises/cat-stretch/0.jpg', 'assets/exercises/cat-stretch/1.jpg']::text[]),
  ('worlds-greatest-stretch', 'World''s Greatest Stretch', 'hamstrings', 'none', 'This is a three-part stretch. Begin by lunging forward, with your front foot flat on the ground and on the toes of your back foot. With your knees bent, squat down until your knee is almost touching the ground. Keep your torso erect, and hold this position for 10-20 seconds.
Now, place the arm on the same side as your front leg on the ground, with the elbow next to the foot. Your other hand should be placed on the ground, parallel to your lead leg, to help support you during this portion of the stretch.
After 10-20 seconds, place your hands on either side of your front foot. Raise the toes of the front foot off of the ground, and straighten your leg. You may need to reposition your rear leg to do so. Hold for 10-20 seconds, and then repeat the entire sequence for the other side.', array['assets/exercises/worlds-greatest-stretch/0.jpg', 'assets/exercises/worlds-greatest-stretch/1.jpg']::text[]),
  ('standing-hip-circles', 'Standing Hip Circles', 'abductors', 'none', 'Begin standing on one leg, holding to a vertical support.
Raise the unsupported knee to 90 degrees. This will be your starting position.
Open the hip as far as possible, attempting to make a big circle with your knee.
Perform this movement slowly for a number of repetitions, and repeat on the other side.', array['assets/exercises/standing-hip-circles/0.jpg', 'assets/exercises/standing-hip-circles/1.jpg']::text[]),
  ('middle-back-stretch', 'Middle Back Stretch', 'middle back', 'none', 'Stand so your feet are shoulder width apart and your hands are on your hips.
Twist at your waist until you feel a stretch. Hold for 10 to 15 seconds, then twist to the other side.', array['assets/exercises/middle-back-stretch/0.jpg', 'assets/exercises/middle-back-stretch/1.jpg']::text[]),
  ('hamstring-stretch', 'Hamstring Stretch', 'hamstrings', 'none', 'Lie on your back with one leg extended above you, with the hip at ninety degrees. Keep the other leg flat on the floor.
Loop a belt, band, or rope over the ball of your foot. This will be your starting position.
Pull on the belt to create tension in the calves and hamstrings. Hold this stretch for 10-30 seconds, and repeat with the other leg.', array['assets/exercises/hamstring-stretch/0.jpg', 'assets/exercises/hamstring-stretch/1.jpg']::text[]),
  ('on-your-side-quad-stretch', 'On Your Side Quad Stretch', 'quadriceps', 'none', 'Start off by lying on your right side, with your right knee bent at a 90-degree angle resting on the floor in front of you (this stabilizes the torso).
Bend your left knee behind you and hold your left foot with your left hand. To stretch your hip flexor, press your left hip forward as you push your left foot back into your hand. Switch sides.', array['assets/exercises/on-your-side-quad-stretch/0.jpg', 'assets/exercises/on-your-side-quad-stretch/1.jpg']::text[]),
  ('calf-stretch-hands-against-wall', 'Calf Stretch Hands Against Wall', 'calves', 'none', 'Stand facing a wall from several feet away. Stagger your stance, placing one foot forward.
Lean forward and rest your hands on the wall, keeping your heel, hip and head in a straight line.
Attempt to keep your heel on the ground. Hold for 10-20 seconds and then switch sides.', array['assets/exercises/calf-stretch-hands-against-wall/0.jpg', 'assets/exercises/calf-stretch-hands-against-wall/1.jpg']::text[]),
  ('kneeling-hip-flexor', 'Kneeling Hip Flexor', 'quadriceps', 'none', 'Kneel on a mat and bring your right knee up so the bottom of your foot is on the floor and extend your left leg out behind you so the top of your foot is on the floor.
Shift your weight forward until you feel a stretch in your hip. Hold for 15 seconds, then repeat for your other side.', array['assets/exercises/kneeling-hip-flexor/0.jpg', 'assets/exercises/kneeling-hip-flexor/1.jpg']::text[]),
  ('side-neck-stretch', 'Side Neck Stretch', 'neck', 'none', 'Start with your shoulders relaxed, gently tilt your head towards your shoulder.
Assist stretch with a gentle pull on the side of the head.', array['assets/exercises/side-neck-stretch/0.jpg', 'assets/exercises/side-neck-stretch/1.jpg']::text[]),
  ('dynamic-chest-stretch', 'Dynamic Chest Stretch', 'chest', 'none', 'Stand with your hands together, arms extended directly in front of you. This will be your starting position.
Keeping your arms straight, quickly move your arms back as far as possible and back in again, similar to an exaggerated clapping motion. Repeat 5-10 times, increasing speed as you do so.', array['assets/exercises/dynamic-chest-stretch/0.jpg', 'assets/exercises/dynamic-chest-stretch/1.jpg']::text[]),
  ('spinal-stretch', 'Spinal Stretch', 'middle back', 'none', 'Sit in a chair so your back is straight and your feet planted on the floor.
Interlace your fingers behind your head, elbows out and your chin down.
Twist your upper body to one side about 3 times as far as you can. Then lean forward and twist your torso to reach your elbow to the floor on the inside of your knee.
Return to upright position and then repeat for your other side.', array['assets/exercises/spinal-stretch/0.jpg', 'assets/exercises/spinal-stretch/1.jpg']::text[]),
  ('standing-hip-flexors', 'Standing Hip Flexors', 'quadriceps', 'none', 'Stand up straight with the spine vertical, the left foot slightly in front of the right.
Bend both knees and lift the back heel off the floor as you press the right hip forward. You can''t get a thorough, deep stretch in this position, however, because it''s hard to relax the hip flexor and stand on it at the same time. Switch sides.', array['assets/exercises/standing-hip-flexors/0.jpg', 'assets/exercises/standing-hip-flexors/1.jpg']::text[]),
  ('childs-pose', 'Child''s Pose', 'lower back', 'none', 'Get on your hands and knees, walk your hands in front of you.
Lower your buttocks down to sit on your heels. Let your arms drag along the floor as you sit back to stretch your entire spine.
Once you settle onto your heels, bring your hands next to your feet and relax. "breathe" into your back. Rest your forehead on the floor. Avoid this position if you have knee problems.', array['assets/exercises/childs-pose/0.jpg', 'assets/exercises/childs-pose/1.jpg']::text[])
on conflict (slug) do update set name = excluded.name, muscle_group = excluded.muscle_group,
  equipment = excluded.equipment, instructions = excluded.instructions, image_urls = excluded.image_urls, source = 'free-exercise-db';

insert into public.fitness_routines (id, owner_id, name, category, est_minutes, met_value, rounds, description) values
  ('f1e55000-0000-4000-8000-000000000001'::uuid, null, 'Easy 20', 'run', 20, 9.8, 1, 'An easy run to build the habit: walk, jog at a pace where you can talk, walk.'),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, null, 'Intervals 25', 'run', 25, 9.8, 1, 'Warm up, then 8 rounds of 1 minute fast and 1½ minutes easy.'),
  ('f1e55000-0000-4000-8000-000000000003'::uuid, null, 'Tempo 30', 'run', 30, 9.8, 1, 'A steady, comfortably hard middle section between an easy start and finish.'),
  ('f1e55000-0000-4000-8000-000000000004'::uuid, null, 'Quick Burn 15', 'cardio', 15, 8.0, 3, '40 seconds on, 20 seconds rest. 3 rounds.'),
  ('f1e55000-0000-4000-8000-000000000005'::uuid, null, 'Cardio Circuit 20', 'cardio', 20, 8.0, 3, '45 seconds on, 15 seconds rest. 3 rounds. No rope? Just mimic the motion.'),
  ('f1e55000-0000-4000-8000-000000000006'::uuid, null, 'Low-Impact 25', 'cardio', 25, 8.0, 4, 'No jumping. 50 seconds on, 10 seconds rest. 4 rounds.'),
  ('f1e55000-0000-4000-8000-000000000007'::uuid, null, 'Core 15', 'abs', 15, 3.8, 3, '3 rounds. Rest 30 seconds between rounds.'),
  ('f1e55000-0000-4000-8000-000000000008'::uuid, null, 'Plank Series 20', 'abs', 20, 3.8, 4, '40 seconds on, 20 seconds rest. 4 rounds.'),
  ('f1e55000-0000-4000-8000-000000000009'::uuid, null, 'Abs & Obliques 25', 'abs', 25, 3.8, 4, '45 seconds on, 15 seconds rest. 4 rounds.'),
  ('f1e55000-0000-4000-8000-000000000010'::uuid, null, 'Bodyweight Basics 20', 'strength', 20, 5.0, 3, '3 rounds, no equipment.'),
  ('f1e55000-0000-4000-8000-000000000011'::uuid, null, 'Upper Body 25', 'strength', 25, 5.0, 1, '3 sets of 10–12 of each. Rest 45 seconds between sets.'),
  ('f1e55000-0000-4000-8000-000000000012'::uuid, null, 'Lower Body 25', 'strength', 25, 5.0, 3, '3 rounds. A dumbbell works for the goblet squat.'),
  ('f1e55000-0000-4000-8000-000000000013'::uuid, null, 'Morning Mobility 15', 'mobility', 15, 2.5, 2, '60 seconds each, 2 rounds. Move slowly.'),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, null, 'Post-Run Stretch 15', 'mobility', 15, 2.5, 1, '45 seconds each side.'),
  ('f1e55000-0000-4000-8000-000000000015'::uuid, null, 'Desk Reset 15', 'mobility', 15, 2.5, 2, 'For a break from sitting. 60 seconds each, 2 rounds.')
on conflict (id) do update set name = excluded.name, category = excluded.category, est_minutes = excluded.est_minutes,
  met_value = excluded.met_value, rounds = excluded.rounds, description = excluded.description
  where public.fitness_routines.owner_id is null;

delete from public.fitness_routine_steps where routine_id in (select id from public.fitness_routines where owner_id is null);
insert into public.fitness_routine_steps (routine_id, position, exercise_id, label, sets, reps, duration_sec, rest_sec) values
  ('f1e55000-0000-4000-8000-000000000001'::uuid, 1, null, 'Brisk walk', null, null, 180, null),
  ('f1e55000-0000-4000-8000-000000000001'::uuid, 2, null, 'Easy jog', null, null, 900, null),
  ('f1e55000-0000-4000-8000-000000000001'::uuid, 3, null, 'Walk to cool down', null, null, 120, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 1, null, 'Easy jog to warm up', null, null, 240, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 2, null, 'Fast (1 of 8)', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 3, null, 'Easy', null, null, 90, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 4, null, 'Fast (2 of 8)', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 5, null, 'Easy', null, null, 90, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 6, null, 'Fast (3 of 8)', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 7, null, 'Easy', null, null, 90, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 8, null, 'Fast (4 of 8)', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 9, null, 'Easy', null, null, 90, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 10, null, 'Fast (5 of 8)', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 11, null, 'Easy', null, null, 90, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 12, null, 'Fast (6 of 8)', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 13, null, 'Easy', null, null, 90, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 14, null, 'Fast (7 of 8)', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 15, null, 'Easy', null, null, 90, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 16, null, 'Fast (8 of 8)', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 17, null, 'Easy', null, null, 90, null),
  ('f1e55000-0000-4000-8000-000000000002'::uuid, 18, null, 'Walk to cool down', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000003'::uuid, 1, null, 'Easy jog', null, null, 480, null),
  ('f1e55000-0000-4000-8000-000000000003'::uuid, 2, null, 'Comfortably hard', null, null, 900, null),
  ('f1e55000-0000-4000-8000-000000000003'::uuid, 3, null, 'Easy jog', null, null, 420, null),
  ('f1e55000-0000-4000-8000-000000000004'::uuid, 1, (select id from public.fitness_exercises where slug = 'star-jump'), 'Jumping jacks', null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000004'::uuid, 2, null, 'High knees', null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000004'::uuid, 3, (select id from public.fitness_exercises where slug = 'mountain-climbers'), null, null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000004'::uuid, 4, (select id from public.fitness_exercises where slug = 'freehand-jump-squat'), 'Squat jumps', null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000005'::uuid, 1, null, 'Burpees', null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000005'::uuid, 2, (select id from public.fitness_exercises where slug = 'lateral-bound'), 'Skaters', null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000005'::uuid, 3, (select id from public.fitness_exercises where slug = 'single-leg-butt-kick'), 'Butt kicks', null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000005'::uuid, 4, null, 'Plank jacks', null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000005'::uuid, 5, (select id from public.fitness_exercises where slug = 'rope-jumping'), 'Jump rope', null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000006'::uuid, 1, null, 'March in place', null, null, 50, 10),
  ('f1e55000-0000-4000-8000-000000000006'::uuid, 2, (select id from public.fitness_exercises where slug = 'dumbbell-rear-lunge'), 'Step-back lunges (no weights needed)', null, null, 50, 10),
  ('f1e55000-0000-4000-8000-000000000006'::uuid, 3, null, 'Standing knee drives', null, null, 50, 10),
  ('f1e55000-0000-4000-8000-000000000006'::uuid, 4, null, 'Side steps', null, null, 50, 10),
  ('f1e55000-0000-4000-8000-000000000006'::uuid, 5, null, 'Shadow boxing', null, null, 50, 10),
  ('f1e55000-0000-4000-8000-000000000007'::uuid, 1, (select id from public.fitness_exercises where slug = 'crunches'), null, null, 15, null, 15),
  ('f1e55000-0000-4000-8000-000000000007'::uuid, 2, (select id from public.fitness_exercises where slug = 'air-bike'), 'Bicycle crunches', null, 20, null, 15),
  ('f1e55000-0000-4000-8000-000000000007'::uuid, 3, (select id from public.fitness_exercises where slug = 'plank'), null, null, null, 40, 15),
  ('f1e55000-0000-4000-8000-000000000007'::uuid, 4, (select id from public.fitness_exercises where slug = 'flat-bench-lying-leg-raise'), 'Leg raises (bench or floor)', null, 12, null, 30),
  ('f1e55000-0000-4000-8000-000000000008'::uuid, 1, (select id from public.fitness_exercises where slug = 'plank'), 'Front plank', null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000008'::uuid, 2, (select id from public.fitness_exercises where slug = 'side-bridge'), 'Side plank (left)', null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000008'::uuid, 3, (select id from public.fitness_exercises where slug = 'side-bridge'), 'Side plank (right)', null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000008'::uuid, 4, (select id from public.fitness_exercises where slug = 'plank'), 'Plank shoulder taps', null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000008'::uuid, 5, (select id from public.fitness_exercises where slug = 'dead-bug'), null, null, null, 40, 20),
  ('f1e55000-0000-4000-8000-000000000009'::uuid, 1, (select id from public.fitness_exercises where slug = 'russian-twist'), null, null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000009'::uuid, 2, (select id from public.fitness_exercises where slug = 'reverse-crunch'), null, null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000009'::uuid, 3, (select id from public.fitness_exercises where slug = 'scissor-kick'), 'Flutter kicks', null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000009'::uuid, 4, (select id from public.fitness_exercises where slug = 'side-bridge'), 'Side-plank hip dips', null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000009'::uuid, 5, null, 'Hollow hold', null, null, 45, 15),
  ('f1e55000-0000-4000-8000-000000000010'::uuid, 1, (select id from public.fitness_exercises where slug = 'pushups'), 'Push-ups', null, 10, null, 20),
  ('f1e55000-0000-4000-8000-000000000010'::uuid, 2, (select id from public.fitness_exercises where slug = 'bodyweight-squat'), 'Squats', null, 15, null, 20),
  ('f1e55000-0000-4000-8000-000000000010'::uuid, 3, (select id from public.fitness_exercises where slug = 'butt-lift-bridge'), 'Glute bridges', null, 15, null, 20),
  ('f1e55000-0000-4000-8000-000000000010'::uuid, 4, (select id from public.fitness_exercises where slug = 'dumbbell-rear-lunge'), 'Reverse lunges (10 each leg, no weights needed)', null, 10, null, 45),
  ('f1e55000-0000-4000-8000-000000000011'::uuid, 1, (select id from public.fitness_exercises where slug = 'pushups'), 'Push-ups', 3, 10, null, 45),
  ('f1e55000-0000-4000-8000-000000000011'::uuid, 2, (select id from public.fitness_exercises where slug = 'one-arm-dumbbell-row'), 'Dumbbell rows (each arm)', 3, 12, null, 45),
  ('f1e55000-0000-4000-8000-000000000011'::uuid, 3, (select id from public.fitness_exercises where slug = 'dumbbell-shoulder-press'), null, 3, 10, null, 45),
  ('f1e55000-0000-4000-8000-000000000011'::uuid, 4, (select id from public.fitness_exercises where slug = 'bench-dips'), 'Tricep dips (chair or bench)', 3, 12, null, 45),
  ('f1e55000-0000-4000-8000-000000000011'::uuid, 5, (select id from public.fitness_exercises where slug = 'dumbbell-bicep-curl'), 'Dumbbell curls', 3, 12, null, 45),
  ('f1e55000-0000-4000-8000-000000000012'::uuid, 1, (select id from public.fitness_exercises where slug = 'goblet-squat'), null, null, 12, null, 20),
  ('f1e55000-0000-4000-8000-000000000012'::uuid, 2, (select id from public.fitness_exercises where slug = 'stiff-legged-dumbbell-deadlift'), 'Romanian deadlifts', null, 10, null, 20),
  ('f1e55000-0000-4000-8000-000000000012'::uuid, 3, (select id from public.fitness_exercises where slug = 'split-squat-with-dumbbells'), 'Split squats (each leg)', null, 10, null, 20),
  ('f1e55000-0000-4000-8000-000000000012'::uuid, 4, (select id from public.fitness_exercises where slug = 'standing-dumbbell-calf-raise'), 'Calf raises', null, 15, null, 20),
  ('f1e55000-0000-4000-8000-000000000012'::uuid, 5, null, 'Wall sit', null, null, 45, 45),
  ('f1e55000-0000-4000-8000-000000000013'::uuid, 1, (select id from public.fitness_exercises where slug = 'cat-stretch'), 'Cat-cow', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000013'::uuid, 2, (select id from public.fitness_exercises where slug = 'worlds-greatest-stretch'), null, null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000013'::uuid, 3, (select id from public.fitness_exercises where slug = 'standing-hip-circles'), 'Hip circles', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000013'::uuid, 4, (select id from public.fitness_exercises where slug = 'middle-back-stretch'), 'Thoracic rotations', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000013'::uuid, 5, (select id from public.fitness_exercises where slug = 'hamstring-stretch'), null, null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 1, (select id from public.fitness_exercises where slug = 'on-your-side-quad-stretch'), 'Quad stretch (left)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 2, (select id from public.fitness_exercises where slug = 'on-your-side-quad-stretch'), 'Quad stretch (right)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 3, (select id from public.fitness_exercises where slug = 'hamstring-stretch'), 'Hamstring stretch (left)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 4, (select id from public.fitness_exercises where slug = 'hamstring-stretch'), 'Hamstring stretch (right)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 5, (select id from public.fitness_exercises where slug = 'calf-stretch-hands-against-wall'), 'Calf stretch (left)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 6, (select id from public.fitness_exercises where slug = 'calf-stretch-hands-against-wall'), 'Calf stretch (right)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 7, (select id from public.fitness_exercises where slug = 'kneeling-hip-flexor'), 'Hip flexor stretch (left)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 8, (select id from public.fitness_exercises where slug = 'kneeling-hip-flexor'), 'Hip flexor stretch (right)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 9, null, 'Pigeon stretch (left)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000014'::uuid, 10, null, 'Pigeon stretch (right)', null, null, 45, null),
  ('f1e55000-0000-4000-8000-000000000015'::uuid, 1, (select id from public.fitness_exercises where slug = 'side-neck-stretch'), 'Neck rolls', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000015'::uuid, 2, (select id from public.fitness_exercises where slug = 'dynamic-chest-stretch'), 'Chest stretch', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000015'::uuid, 3, (select id from public.fitness_exercises where slug = 'spinal-stretch'), 'Seated twist', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000015'::uuid, 4, (select id from public.fitness_exercises where slug = 'standing-hip-flexors'), 'Hip flexor stretch', null, null, 60, null),
  ('f1e55000-0000-4000-8000-000000000015'::uuid, 5, (select id from public.fitness_exercises where slug = 'childs-pose'), 'Child''s pose', null, null, 60, null);
