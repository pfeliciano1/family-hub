# Family Hub — Alpha 0.4

A private family command center: shared calendar, tasks, groceries, countdowns,
weather, and more, on every device in the house. Runs at $0/month on
GitHub Pages (hosting) and Supabase (database, logins, live sync).

## What works in Alpha 0.4

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

Calendar, rewards, routines, habits, meals, and the rest are on the roadmap
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

### 6. Install on phones and tablets
- **iPhone / iPad (Safari):** Share → Add to Home Screen
- **Samsung / Android (Chrome):** ⋮ menu → Add to home screen / Install app

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
js/modules/         one file per section: home, tasks, grocery, countdowns,
                    birthdays, weather, settings, auth, shell
database/setup.sql  tables, security rules, live sync
```
Adding a section means adding a module file and registering it in
`shell.js` and `main.js`; nothing else has to change.
