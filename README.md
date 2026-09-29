# Family Hub — Alpha 0.9

A private family command center: shared calendar, tasks, groceries, countdowns,
weather, and more, on every device in the house. Runs at $0/month on
GitHub Pages (hosting) and Supabase (database, logins, live sync).

## What works in Alpha 0.9

- Email + password accounts, password reset
- Create a family, or join one with an invite code
- Family members with roles, colors, and birthdays (kids don't need logins)
- Live sync: a change on one device appears on the others within seconds
- Tasks: assign to anyone, due dates, overdue highlighting
- Grocery list grouped by store section, check off and clear
- Countdowns (vacations, birthdays, holidays), with yearly repeats
- Birthdays & anniversaries, built from profiles and countdowns
- Live weather with "what to wear" suggestions (Open-Meteo, free, no key)
- TV Display mode that keeps the laptop screen awake
- Phone layout with bottom navigation; installable to the home screen
- Calendar: everyone's Google calendars combined, colored by family member,
  with Today, day, week, and month views
- Weather tips for your plans ("Soccer at 5:30 PM: rain likely, pack a rain jacket")
- + Event opens Google Calendar with the details filled in
- Chores that repeat (every day, certain weekdays, or once) and earn points,
  with a parent OK before points are given
- Rewards: point balances, a goal each child saves for, prizes to ask for,
  bonus points, and a point history
- Routines (morning, bedtime) with steps and progress like 4/5, plus
  optional bonus points for finishing
- Habits with daily check-offs, the last 7 days, and streaks 🔥
- Kid mode: a kid-sized screen for a shared tablet, with a PIN per child and
  a parent PIN to leave

- Meals: a weekly meal plan with Dinner Tonight on Home, meal history, and
  ideas for what to make next
- Recipes with ingredients and steps; send a recipe's (or the whole week's)
  ingredients to the grocery list
- Lists: shared checklists for packing, school supplies, ideas, anything

- Gifts: ideas and purchases by person and occasion, hidden from the person
  they're for
- Home projects with steps, a budget, and what you've spent
- Family memories with photos, and "On this day" on Home

- Customize Home: drag cards (mouse or finger), hide and add them back; each
  person's layout follows them to every device
- Find recipes: search a free online recipe collection, save one, and send
  its ingredients to the grocery list
- Notifications on phones and computers: a morning summary, the day before
  birthdays and countdowns, and new grocery or list items

Smart features and the rest are on the roadmap
(see `DEVELOPMENT_LOG.md`).

## First-time setup

### 1. Create the database
1. In Supabase, open **SQL Editor → New query**.
2. Open `database/setup.sql`, copy everything, paste it in, and click **Run**.
3. You should see "Success. No rows returned." If Supabase warns about
   "drop" statements, confirm. The script only re-creates its own security rules.

### 2. Connect the app to your database
1. In Supabase, open **Project Settings → API** (or **API Keys**).
2. Open `config.js` in Notepad and replace the two placeholders with your
   **Project URL** and **publishable** key. Keep the quotes.
3. Never use the **secret** / **service_role** key.

### 3. Put it online
1. In your `family-hub` repository on GitHub: **Add file → Upload files**.
2. Drag in everything from this folder, including the `js`, `icons`, and
   `database` folders. Replace the existing README when asked.
3. Click **Commit changes**. After a minute or two, the app is live at
   your GitHub Pages address.

### 4. Create your family
1. Open your GitHub Pages address and choose **Create an account**.
2. Click the confirmation link in the email from Supabase.
3. Choose **Start a new family**. Then go to **Settings** to set your weather
   location and add family members.

### 5. Invite your spouse
Settings shows an 8-character invite code. They create their own account,
choose **Join your family**, and enter the code. If you already added them as
a Parent, they should type the same name so their profile gets linked.

### 6. Set up the calendar
See **Setting up the calendar** below.

### 7. Set up the kids features
See **Setting up chores, rewards, and Kid mode** below.

### 8. Install on phones and tablets
- **iPhone / iPad (Safari):** Share → Add to Home Screen
- **Samsung / Android (Chrome):** ⋮ menu → Add to home screen / Install app

## Setting up the calendar
The calendar needs one small server function, because Google doesn't let web
pages read calendars directly. It runs free on Supabase.

**A. Update the database.** In Supabase's **SQL Editor**, run
`database/setup.sql` again (the whole file). It adds the calendars table and
leaves your existing data alone. The "destructive operations" warning is
expected; it only re-creates its own security rules.

**B. Create the server function.**
1. In Supabase, open **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `calendar-feed`.
3. Delete the sample code, paste in everything from
   `supabase/functions/calendar-feed/index.ts`, and click **Deploy**.
4. Open the function's **Details** (or **Settings**) and turn **off**
   "Verify JWT with legacy secret" (it may be called "Enforce JWT
   verification"), then save. The function checks that the person is signed
   in itself, so this is safe; leaving it on can block sign-ins that use
   Supabase's newer keys.

**C. Upload the new app files** to GitHub the usual way.

**D. Connect each calendar.** In Family Hub, go to **Settings → Calendars →
Connect a calendar**. For each Google calendar:
1. On a computer, open calendar.google.com → ⚙️ **Settings**.
2. Under **Settings for my calendars**, click the calendar.
3. Under **Integrate calendar**, copy **Secret address in iCal format**.
4. Paste it into Family Hub and pick whose calendar it is.

Anyone with a secret address can see that calendar, so only paste it into
Family Hub. It is stored in your Supabase database, where only your family's
logins can read it. If one ever leaks, click **Reset** next to it in Google
and paste the new address.

Calendars refresh every 15 minutes and whenever the app is reopened. Events
you add in Google Calendar usually appear within a few minutes.

## Setting up chores, rewards, and Kid mode
**A. Update the database.** In Supabase's **SQL Editor**, open a new query,
paste all of `database/setup.sql`, and click **Run** (the usual "destructive
operations" warning is expected). It adds the kids tables and keeps your data.

**B. Upload the new app files** to GitHub the usual way and hard refresh
(Ctrl+Shift+R). The footer should say **Alpha 0.6**.

**C. Set things up in Family Hub:**
1. **Tasks & Chores → Chores → ＋ New chore.** Pick who, how many points, and
   how often. Leave "A parent approves it" on if you want to check the work.
2. **Rewards → ＋ New reward.** Add prizes with a point cost, then pick what
   each child is saving for.
3. **Routines** and **Habits**: add a morning or bedtime routine (one step per
   line) and any daily habits.
4. **Settings → Kid mode:** set a 4-digit parent PIN. To give a child their
   own PIN, edit them under Family members.
5. On the shared tablet: **Kid mode** (sidebar, or More on phones). Kids tap
   their picture. Leaving Kid mode asks for the parent PIN.

How points work: when a parent checks off a chore, points are given right
away. When a kid checks it off in Kid mode, it waits under **Waiting for your
OK** (on the Rewards page and the Chores tab) until a parent approves it.
Reward requests work the same way; approving one takes the points away.

Kid mode is a convenience lock for a family device, not a security feature:
the device stays signed in with a parent's account.

## Setting up meals, recipes, and lists
**A. Update the database.** In Supabase's **SQL Editor**, open a new query,
paste all of `database/setup.sql`, and click **Run** (the "destructive
operations" warning is expected). It adds the food and list tables and keeps
your data.

**B. Upload the new app files** to GitHub the usual way and hard refresh
(Ctrl+Shift+R; on phones, close and reopen the app). The footer should say
**Alpha 0.7**.

**C. Try it:**
1. **Recipes → ＋ New recipe.** Put one ingredient per line, like
   `1 lb ground beef`. Tags like `quick` or `kid favorite` become filters.
2. **Meals:** tap a day to plan dinner, from a recipe or just a name like
   "Leftovers". Tick **Breakfast & lunch** if you plan those too.
3. **🛒 Add this week's ingredients** (Meals page) or **Add to grocery** (on a
   recipe) shows a checklist; uncheck what you already have.
4. **Lists → ＋ New list**, starting from a template or blank.

## Setting up gifts, projects, and memories
**A. Update the database.** In Supabase's **SQL Editor**, open a new query,
paste all of `database/setup.sql`, and click **Run** (the "destructive
operations" warning is expected). It adds the new tables and a private photo
folder, and keeps your data. If you skipped the 0.7 update, this one covers it.
Afterward, **Storage** in Supabase should list a bucket called
`family-photos`.

**B. Upload the new app files** to GitHub the usual way and hard refresh
(Ctrl+Shift+R; on phones, close and reopen the app). The footer should say
**Alpha 0.8**.

**C. Try it:**
1. **Gifts → ＋ New gift.** A gift for someone with their own login is hidden
   from them, so you and your spouse can plan each other's presents here.
2. **Home Projects → ＋ New project.** Type the steps one per line, set a
   budget, then log purchases as you go.
3. **Family Memories → ＋ Add a memory.** Pick a photo, say who was there,
   and write a line or two.

Photos are shrunk before upload, so Supabase's free storage (1 GB) holds
thousands. They're private to your family.

## Setting up notifications
Notifications are free. They use the phone makers' own push services, a small
server function that writes the messages, and a once-a-minute schedule in your
database. You set this up once; after that, each person turns notifications
on for each of their devices.

**A. Update the database.** In Supabase's **SQL Editor**, open a new query,
paste all of `database/setup.sql`, and click **Run** (the "destructive
operations" warning is expected). It adds the notification tables and turns on
two built-in Supabase extensions, **pg_cron** (the schedule) and **pg_net**
(lets the schedule call the function). If Supabase says an extension can't be
created, open **Database → Extensions**, turn on `pg_cron` and `pg_net`, and
run the script again.

**B. Create the server function** (just like the calendar one):
1. In Supabase, open **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `notify`.
3. Delete the sample code, paste in everything from
   `supabase/functions/notify/index.ts`, and click **Deploy**.
4. In the function's **Details** (or **Settings**), turn **off** "Verify JWT
   with legacy secret" / "Enforce JWT verification", then save. The schedule
   calls it with its own secret, which the function checks.

There are no keys to copy: the function makes its own signing keys the first
time someone turns notifications on, and keeps them in the database.

**C. Upload the new app files** to GitHub the usual way (including the new
`sw.js` next to `index.html`) and hard refresh. The footer should say
**Alpha 0.9**.

**D. Turn them on, on each device.** Open **Settings → Notifications → Turn
on for this device**, allow notifications, then tap **Send a test**. Choose
which ones this device gets and the morning summary time.
- **iPhone / iPad:** first add Family Hub to the Home Screen (Safari → Share →
  Add to Home Screen) and open it from that icon. Needs iOS 16.4 or newer.
- **Samsung / Android:** works in Chrome, installed or not.
- **Computers:** works in Chrome, Edge, Firefox, and Safari while the browser
  is running.

What gets sent:
- **Morning summary** at the time you pick: today's calendar events, tasks due,
  and dinner.
- **Tomorrow:** birthdays (from profiles) and countdowns, at the same time.
- **Grocery and lists:** a minute after someone else adds items, one message
  per list, like "3 added to the Grocery List: Milk, Eggs, Bread".

## Updating later
Upload the changed files to GitHub the same way. Your data lives in
Supabase, so updating the app never touches it. If a new version includes a
database script, run it in the SQL Editor first.

## Troubleshooting
- **"Almost there" screen:** `config.js` still has the placeholders.
- **"The database isn't set up yet":** run `database/setup.sql`.
- **Confirmation email never arrives:** check spam. Supabase's free email
  service only sends a few emails per hour.
- **Confirmation link opens a blank or wrong page:** in Supabase, go to
  Authentication → URL Configuration and add your address with `/**` at the
  end under Redirect URLs, for example `https://yourname.github.io/family-hub/**`.
- **Calendar says "The calendar-feed server function isn't set up yet":**
  follow step B above, and check the function name is exactly `calendar-feed`.
- **Calendar says "Please sign out and sign back in":** turn off the JWT
  setting in step B.4, then reload.
- **A calendar "was not accepted":** its secret address was reset in Google.
  Copy the new one and edit the calendar in Settings.
- **"The notify server function isn't set up yet":** follow **Setting up
  notifications** step B, and check the name is exactly `notify`.
- **The test notification never pops up:** check the phone's own settings
  (Settings → Notifications → Family Hub, or the browser on Android) and that
  Focus / Do Not Disturb is off. On iPhone it only works from the Home Screen
  icon.
- **Morning summaries don't come:** in Supabase, **Integrations → Cron** (or
  Database → Cron Jobs) should list `family-hub-notify` running every minute,
  and **Edge Functions → notify → Logs** should show calls. If the job is
  missing, run `database/setup.sql` again.
- **Changes don't show on another device:** the footer should say
  "Live sync on." Reloading the page always pulls the latest data.

## How the code is organized
```
index.html          page shell
config.js           your Supabase connection
styles.css          all styling
js/main.js          startup, clicks, forms, timers
js/data.js          loading, saving, live sync
js/session.js       sign-in / sign-out handling
js/nav.js           list of sections (and which are coming soon)
js/modules/         one file per section: home, calendar, tasks, chores,
                    rewards, routines, habits, kidmode, meals, recipes, lists,
                    gifts, projects, memories, grocery, countdowns, birthdays,
                    weather, settings, auth, shell, findrecipes (online
                    recipe search), notify (notification settings)
                    (kids.js holds what chores/rewards/routines/habits share;
                    food.js holds meal history and recipe-to-grocery)
sw.js               service worker that shows notifications
database/setup.sql  tables, security rules, live sync, notification schedule
supabase/functions/calendar-feed/index.ts
                    server function that reads the iCal addresses
supabase/functions/notify/index.ts
                    server function that sends notifications
```
Adding a section means adding a module file and registering it in
`shell.js` and `main.js`; nothing else has to change.
