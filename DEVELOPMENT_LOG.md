# Family Hub Development Log

This document tracks important development decisions, bugs, fixes, feature requests, and milestones for the Family Hub project.

## Project
**Family Hub — Digital Family Command Center**

**Primary goal:** Build a shared family command center that works across desktop, mobile, tablet, and a laptop/TV display while keeping the core experience at **$0/month** whenever practical.

---

## Alpha 0.1–0.3 — Visual Prototype
**Status:** Completed (built in an earlier planning session)

- 0.1: Responsive dashboard shell, left navigation, family setup, TV Display Mode, mobile layout, placeholder cards and pages. Data stored in the browser only.
- 0.2: Fixed BUG-001 (no way to exit TV mode). Added Exit TV Mode button and Escape key.
- 0.3: Removed the decorative blue shape behind the weather card (UI-001). Added this log.

The prototype established the approved look: navy sidebar, blue accents, card dashboard. All dashboard content was sample data.

---

## Alpha 0.4 — Real Foundation
**Status:** Completed. Deployed to GitHub Pages and Supabase on 2026-09-25; Paul confirmed sign-up, family setup, settings, and TV Display work.

The prototype's look was kept; the code underneath was rebuilt so every working card reads real, shared family data.

### Built
- **Cloud database and logins (Supabase):** email + password accounts, confirmation emails, password reset.
- **Family onboarding:** first adult creates the family; other adults join with an 8-character invite code. Joining with the same name as an existing Parent profile links that profile instead of duplicating it.
- **Family members:** name, parent/child role, color, birthday. Kids don't need logins.
- **Live sync** across all devices, plus catch-up when a phone or tablet is reopened and a 5-minute safety refresh.
- **Tasks:** assignee, optional due date, overdue/today labels, To do / Done views.
- **Grocery list:** store sections, quantities, check off, clear checked items, quick add from Home.
- **Countdowns:** categories with icons, yearly repeats, show/hide on Home, past countdowns kept separately.
- **Birthdays & Anniversaries:** built automatically from member birthdays plus birthday/anniversary countdowns, with ages and years.
- **Weather + What to Wear:** live forecast from Open-Meteo (free, no key), location search in Settings, °F/°C. Clothing suggestions consider feels-like temperature, rain/snow, daily temperature swing, wind, and UV. Rain and snow gear is listed first.
- **TV Display:** keeps the laptop screen awake, goes full screen, larger text, hides editing controls, remembers TV mode on that device.
- **Phone layout:** bottom navigation plus a "More" menu with every section. Coming-soon cards are hidden on phones.
- **Installable:** app icons for iPhone, iPad, and Android home screens.
- Sections not built yet show a roadmap page with the planned version.

### Architecture decisions
- **Hosting:** GitHub Pages (free). Requires a public repository; no private data or secret keys live in the code.
- **Database:** Supabase free tier. Free projects pause after about a week with no activity, which daily family use prevents.
- **Security:** Row Level Security on every table. People can only see their own family's data. Signed-out visitors can see nothing. Logins can only be linked to a family through the create/join functions, never edited directly. "Automatically expose new tables" is off, so every table is explicitly granted.
- **Code structure:** plain JavaScript modules, no build step, so files can be uploaded straight to GitHub. One module per section; each registers its own buttons, forms, and checkboxes.
- **Weather:** Open-Meteo instead of a keyed API, to keep $0 and avoid storing an API key.
- **Kid access (built in 0.6):** profile + PIN on shared devices (Kid mode) instead of email logins.
- **Google Calendar (built in 0.5):** start by reading each calendar's private "secret address in iCal format" through a small server function, which avoids Google's OAuth setup and its 7-day token expiry for unverified apps. Events are still created in the Google Calendar app. Two-way sync can come later if needed.

### Testing
- Database script run twice against Postgres with Supabase's auth pieces simulated. Verified family isolation, invite-code linking, blocked login hijacking, blocked self-removal, and no access when signed out.
- Every screen exercised in a headless browser at desktop and phone sizes with no errors.

---

## Alpha 0.5 — Calendar
**Status:** Completed. Deployed 2026-09-25; Paul connected his Google calendar and confirmed events show in Family Hub.

### Built
- **Calendars in Settings:** connect any number of Google calendars by their "Secret address in iCal format", each assigned to a family member (their color) or the whole family. Catches the common mistakes (web link or public address instead of the secret one).
- **calendar-feed server function** (Supabase Edge Function): reads every family calendar, expands repeating events, applies moved and cancelled instances, handles time zones, and returns one combined list for a date range. Uses the Mozilla ical.js library.
- **Today's Calendar card** on Home, with the next upcoming event when today is empty.
- **Calendar page:** Day, Week, and Month views with previous/next/today, colored by family member. Events on two people's calendars (invites) show once. Tap an event for details and a map link.
- **Weather for your plans:** hourly forecast is matched to each timed event in the next 24 hours. Rain, snow, storms, cold, and heat produce a tip on the weather card, the Weather page, the event itself, and a ☔-style marker on the calendar.
- **+ Event** (Quick Add and Calendar page): opens Google Calendar with the title, date, times, and place filled in.
- Phone: Calendar replaces Countdowns in the bottom bar (Countdowns stays under More). The month view shows colored dots instead of titles.

### Decisions
- Events are read-only in Family Hub; Google Calendar stays the place to create and edit them. No Google sign-in or OAuth needed.
- The server function reads calendars with the signed-in person's own login, so the database security rules keep each family to its own calendars. No secret keys are stored in the function.
- Secret iCal addresses are stored in the `calendars` table, readable only by the family's logins.
- If the 0.5 database update hasn't been run, the rest of the app keeps working and the calendar explains what to do.
- Events refresh every 15 minutes, on reopen, on a new day, and about 90 seconds after + Event.

### Testing
- Database script run against Postgres on top of an existing 0.4 database, then run again: 0.4 data kept, calendars isolated between families, cross-family inserts blocked, signed-out access denied, non-https addresses rejected.
- Server function's calendar reader tested with a Google-style feed: weekly repeats across daylight saving, a skipped date, a moved instance, multi-day all-day events, cancelled events, and a daily repeat running since 2010.
- Every calendar screen exercised in a headless browser at desktop, phone, and TV sizes, including no calendars, no database update, function not deployed, and one bad calendar. No errors.
- Not yet tested against Paul's live Supabase project and real Google calendars.

---

## Alpha 0.6 — Kids
**Status:** Deployed 2026-09-25

### Built
- **Chores** (Chores tab on Tasks & Chores): every day, certain weekdays, or once; points per chore; optional parent approval; pause without deleting. Missed one-time chores stay on the list marked Late.
- **Points ledger:** every point earned or spent is one row, so balances are always explainable. A unique key per source (chore, routine day, reward request) makes double approvals harmless. Balances come from a database function so a long history never hits Supabase's 1,000-row limit.
- **Rewards page:** each child's balance and goal with a progress bar, prizes (for any child or one child), "Waiting for your OK" for chores and reward requests, give/take points with a reason, and the point history. Getting the goal prize clears the goal.
- **Routines:** steps (one per line), progress like 4/5, optional bonus points when every step is done (taken back if a step is unchecked). Checks reset daily. Editing steps keeps today's checks for steps that stay.
- **Habits:** once-a-day check-off, last 7 days as dots, streak 🔥 counting today or ending yesterday, a toast at 3, 7, 14, 30, 50, and 100 days.
- **Kid mode:** picker with each child's picture, optional 4-digit PIN per child, parent PIN to leave, stays on after a reload on that device. Kids see their chores, routines, habits, goal, and rewards they can ask for. Kid check-offs of chores that need approval wait for a parent.
- **Home:** Rewards card (balances, goals, waiting count) and Routines & Habits card replace the coming-soon cards. Quick Add has ＋ Chore.

### Decisions
- **Kid PINs are a convenience lock, not security.** Kids don't have logins; Kid mode runs on a parent's signed-in device. PIN hashes are stored in the database and readable by family logins. Real per-kid logins can come later if needed.
- Parents checking off a chore counts as approval.
- Removing a reward hides it, so past requests and history keep their names.
- A database trigger now checks that anything pointing at a person, chore, reward, routine, or habit points at one in the same family (also applied to tasks and calendars).
- If the 0.6 database update hasn't been run, the rest of the app keeps working and the kids sections explain what to do.

### Testing
- Database script run on top of the 0.5 test database, then again: data kept; kids tables isolated between families; another family can't add a chore or points for your child even knowing the ID; duplicate point keys rejected; signed-out access denied.
- Headless browser: parent and kid chore check-offs, approvals, un-checking removes points, weekly chore form, goals, bonus points, reward request and approval (balance and goal update), routine bonus, routine step edits keep order, habit streak toast, wrong and right PINs for kid and parent, Kid mode surviving a reload, the no-database-update state, and phone layouts. No errors.
- Not yet tested against Paul's live Supabase project.

---

## Alpha 0.6.1 — Fixes (2026-09-26)
- **BUG-002 fixed:** the Calendar page froze when showing a week or day with a timed event more than about 5 days away, so Day/Week/Month and the arrows seemed to do nothing. The weather-tip check looped forever looking for a forecast hour that didn't exist. Tips are now limited to events in the next 48 hours and the check is bounded. Reproduced in a headless browser before the fix and confirmed after.
- **iPhone/iPad install:** Apple doesn't offer to install web apps automatically the way Android does. Home now shows a one-time tip on iPhone/iPad (Safari → Share → Add to Home Screen), hidden once dismissed or when opened from the home screen.
- Files changed: js/modules/weather.js, js/modules/home.js, js/main.js, js/modules/shell.js, styles.css. No database changes.

---

## Alpha 0.7 — Food
**Status:** Delivered 2026-09-26 (its database changes are included in the 0.8 script)

### Built
- **Meals page:** a Sunday-to-Saturday planner with week arrows. Dinner always shows; a "Breakfast & lunch" checkbox (remembered per device) adds the other two. Each meal is a recipe or just a name ("Leftovers", "Pizza night"), with an optional note.
- **Dinner Tonight** card on Home with a View recipe link and tomorrow's dinner. When nothing is planned it suggests a recipe with a one-tap "Make it tonight". Quick Add ＋ Meal works.
- **Recipes page:** search (title, ingredients, tags), tag filters, cards with time, servings, and "Last had 12 days ago". Each recipe has ingredients and steps (one per line), time, servings, tags, and a link to the original.
- **Recipe to grocery list:** from a recipe or "Add this week's ingredients" on the Meals page. A checklist shows each ingredient with its amount; things already on the grocery list and pantry basics (salt, pepper, oil, flour, sugar…) start unchecked. Items are sorted into store sections automatically.
- **History and suggestions:** "Ideas for this week" lists recipes never made first, then the longest since last time, skipping anything already planned in the next week. "Recent dinners" shows the last two weeks.
- **Lists page:** any number of shared checklists, starting blank or from a template (Trip packing, School supplies, Ideas). Check off, add, remove, Uncheck all (reuse a packing list), Remove checked, rename, delete.

### Decisions
- Ingredients are plain text, one per line, instead of a structured table. It's how people copy recipes, and the grocery import splits amounts from names well enough ("2 lbs ground beef" → ground beef, 2 lbs), with a checklist to fix anything before it's added.
- One meal per day and slot, enforced by the database. Deleting a recipe keeps past and planned meals by name.
- Meal history uses the plan itself (the last 180 days), so there's nothing extra to log.
- Lists live with Food in this version because packing and school-supply lists were on the 0.7 roadmap; they aren't food-specific.
- If the 0.7 database update hasn't been run, the rest of the app keeps working and the food sections explain what to do.

### Testing
- Database script run on top of the 0.6 test database, then again: data kept; food tables isolated between families; another family can't plan a meal with your recipe or add to your list even knowing the ID; a second dinner on the same day is rejected; signed-out access denied.
- Headless browser: Dinner Tonight empty and planned, Make it tonight, planning by name and by recipe, changing a meal, breakfast and lunch, this week's ingredients into the grocery list (sections and "on the list" detection), recipe search, tags, add, plan, delete, lists from a template, add, check, uncheck all, remove checked, rename, delete, the no-database-update state, TV and phone layouts. The 0.6 kids test still passes. No errors.
- Not yet tested against Paul's live Supabase project.

---

## Alpha 0.8 — Family Life
**Status:** Current (built 2026-09-28; needs the database script run again)

### Built
- **Gifts:** ideas and purchases for family members or anyone else ("Grandma"), with occasion and date, price, link, note, and a status of Idea, Bought, Wrapped, or Given. Grouped by person with ideas and money spent. "Coming up" lists birthdays, anniversaries, and gift dates in the next 60 days with how many gifts are ready and a one-tap ＋ Gift (the person and date fill in). Given gifts hide until you ask for them.
- **Home Projects:** stages (In progress, Planned, Someday, Done), who's leading it, a finish-by date (late ones turn red), steps, a budget, and an expense log with a spent/left bar that turns red when over. Steps can be typed all at once when creating a project. Home shows projects in progress.
- **Family Memories:** a title, date, story, who was there, and one photo. Grouped by year and filterable by person. Home shows "On this day, 2 years ago" when a memory matches today's date, otherwise a different memory each day. Photos can be opened full size, replaced, removed, or downloaded.
- Quick Add has ＋ Memory and ＋ Project.

### Decisions
- **Gift secrecy is enforced by the database,** not just hidden on screen: a gift for someone with their own login is invisible to them (and to their devices' live sync) unless they added it themselves, which makes it a wish list everyone can see. Kids without logins can see gifts on a shared device outside Kid mode; the gift form says so.
- **Gifts never appear on Home,** since Home may be on the TV.
- **Photos stay private.** They're stored in a private Supabase Storage bucket, one folder per family, and shown through links that expire after an hour. Each photo is shrunk to 1600 px on the device before upload (about 300 KB), so the free 1 GB holds thousands. Deleting a memory or replacing its photo deletes the old file.
- One photo per memory keeps the page simple; albums can come later.
- Money is shown in US dollars.

### Fix (2026-09-28)
- **BUG-003 fixed:** a routine's bonus was only paid when a step was checked, so setting or changing the bonus after all steps were already done showed "Finished! +6" but paid nothing. Saving a routine now settles today's bonus right away (gives it, corrects the amount, or takes it back). Only js/modules/routines.js changed.

- **BUG-004 fixed (database):** the 0.8 script's same-family rule also checked `created_by` on older tables (tasks, calendars, point entries), where it holds the login rather than a family member, so adding points, tasks, or calendars failed with "That item belongs to a different family." The rule now checks `created_by` only on gifts and memories. Fixed by running the updated setup.sql. A write test across every table now runs before any database change ships.

### Testing
- Database script run on top of the 0.7 test database, then again: data kept. Tested with two logins in one family plus an outsider: a gift for Ana is invisible to Ana and she can't change or delete it; gifts for kids, for yourself, and for people outside the family are visible to the family; outsiders see nothing; another family can't link a gift, project step, or photo to yours; negative amounts rejected; photos can only be saved in your own family's folder; signed-out access denied.
- Headless browser: every gift, project, and memory flow above, photo upload with preview, replace and remove (storage cleaned up), missing photos (placeholder, no endless retries), the no-database-update state, and phone layouts. The 0.6 kids and 0.7 food tests still pass. No errors.
- Not yet tested against Paul's live Supabase project.

---

## Alpha 0.8.1 — Stars per routine step (2026-09-28)
- Paul asked for partial credit on routines. Each routine now has a Stars setting: **for each step checked** (e.g. 4 of 6 steps = 4 stars) or **only for finishing every step** (the old behavior, still the default for existing routines). New routines start at 1 star per step.
- One point entry per routine per day, resized as steps are checked or unchecked ("Morning routine (4 of 6)"), so the history stays tidy and nothing is double-counted.
- Database: adds `routines.reward_mode`. Run setup.sql again. Files: js/modules/routines.js, js/modules/shell.js (version), styles.css (version), database/setup.sql.
- Tested: 4 of 6 = 4, unchecking one takes a star back, all 6 = 6, switching to finish-only corrects the total; script run twice; write test across every table passes; kids tests pass.

## Alpha 0.8.2 — Home dashboard layout (2026-09-28)
- Paul asked for a Home card for every section except Gifts, Quick Add near the top, and Routines and Habits as separate cards. He approved screenshots before the change.
- New order: Today, Tasks, Quick Add; Dinner Tonight, Groceries, Lists; Rewards, Routines, Habits; Countdowns, Birthdays, Home Projects; Recipes, Memory, Weather; Family.
- New cards: Lists (up to 3 lists with items left), Recipes (3 suggestions with "Plan it"), separate Routines (progress) and Habits (check off, streaks). Home Projects always shows, with an empty state. Quick Add gains "+ List" and is hidden in TV mode.
- Same layout on every device (phone stacks the cards in the same order). No database change.
- Files: js/modules/home.js, habits.js, lists.js, recipes.js, projects.js, shell.js (version), styles.css.
- Tested: lint, kids/food/life browser tests, computer/phone/TV screenshots, no errors.

---

## Next Development Priorities

### Notifications (requested 2026-09-28, next up)
- Real push notifications on phones and computers, free (Web Push with a service worker, a Supabase server function, and a schedule). iPhone/iPad need the app added to the Home Screen and iOS 16.4+.
- First set: a chore or reward waiting for a parent's OK, a morning summary (tasks, events, dinner), the day before a birthday or countdown, and new shared list or grocery items. Each person turns each one on or off per device.

### Alpha 0.9+ — Smart Features
18. Natural-language Quick Add
19. Family Assistant (only if its value justifies any cost)
20. TV auto-rotation between views

---

## Design Principles

- **Digital family command center:** The Home page should answer:
  1. What's happening today?
  2. What needs to be done?
  3. What's coming up?
- Keep the Home dashboard high-level; deeper management belongs in dedicated sections.
- Family data is entered through Setup/Settings, never hard-coded.
- Works on Windows, Android/Samsung phones, iPhone, iPad, and a laptop connected to a TV.
- Internet connectivity is required for the shared experience.
- Prefer free tiers and open/free services.
- Do not add AI costs until AI features provide clear value.
- Show honest empty states and "coming soon" labels instead of fake sample data.

---

## Bug / Feature Log

| ID | Type | Status | Item |
|---|---|---|---|
| BUG-001 | Bug | Fixed (0.2) | No way to exit TV Display Mode after sidebar disappeared |
| UI-001 | Visual | Fixed (0.3) | Large blue decorative shape behind weather card |
| UI-002 | Visual | Done (0.6) | Routines & Habits card with per-routine lists and 4/5 progress |
| FEAT-001 | Feature | Done (0.4) | Cloud synchronization |
| FEAT-002 | Feature | Done (0.5) | Google Calendar integration (read-only, via secret iCal addresses) |
| FEAT-003 | Feature | Done (0.6) | Authentication, family roles, and kid PIN profiles (Kid mode) |
| FEAT-004 | Feature | Done (0.6) | Tasks, chores with points, and rewards |
| FEAT-005 | Feature | Done (0.7) | Grocery list, meal planner, recipes, recipe-to-grocery, meal history |
| FEAT-011 | Feature | Done (0.7) | Custom shared lists with templates |
| FEAT-012 | Feature | Done (0.8) | Gift tracker hidden from the recipient |
| FEAT-013 | Feature | Done (0.8) | Home projects with steps and budget |
| FEAT-014 | Feature | Done (0.8) | Family memories with private photos and "On this day" |
| BUG-003 | Bug | Fixed (0.8) | Routine bonus not paid when set after the steps were already checked |
| BUG-004 | Bug | Fixed (0.8) | 0.8 database rule blocked points, tasks, and calendars ("belongs to a different family") |
| FEAT-015 | Feature | Planned | Push notifications |
| FEAT-006 | Feature | Done (0.5) | Weather and clothing engine, with activity-aware tips |
| FEAT-007 | Feature | Partial (0.4) | TV mode wake lock, full screen, large text; auto-rotation later |
| FEAT-008 | Feature | Planned | Family Assistant / natural-language Quick Add |
| FEAT-009 | Feature | Done (0.4) | Countdowns with yearly repeats |
| FEAT-010 | Feature | Done (0.4) | Birthdays & anniversaries |
| BUG-002 | Bug | Fixed (0.6.1) | Calendar froze when a shown week had an event beyond the weather forecast |
| UI-003 | Visual | Done (0.6.1) | Add-to-Home-Screen tip for iPhone and iPad |

---

## Version History

- **0.1** — Initial responsive dashboard and application shell
- **0.2** — TV mode exit control and Escape-key support
- **0.3** — Removed distracting weather-area decoration and added development documentation
- **0.4** — Real foundation: accounts, shared database, live sync, tasks, groceries, countdowns, birthdays, live weather with clothing suggestions
- **0.5** — Calendar: Google calendars combined by family member, Today card, day/week/month views, weather tips for events, + Event
- **0.6** — Kids: chores with points and approvals, rewards and goals, routines, habits with streaks, Kid mode with PINs
- **0.6.1** — Calendar freeze fix; iPhone/iPad home screen tip
- **0.7** — Food: weekly meal plan, Dinner Tonight, recipes, recipe-to-grocery, meal history and suggestions, custom lists
- **0.8** — Family life: gifts (hidden from the recipient), home projects with budgets, family memories with photos
- **0.8.1** — Routine stars per step
- **0.8.2** — Home dashboard: a card for every section except Gifts, Quick Add at the top
