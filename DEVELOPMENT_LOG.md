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
**Status:** Current

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
- **Kid access (planned):** profile + PIN on shared devices instead of email logins, arriving with Rewards.
- **Google Calendar (planned for 0.5):** start by reading each calendar's private "secret address in iCal format" through a small server function, which avoids Google's OAuth setup and its 7-day token expiry for unverified apps. Events are still created in the Google Calendar app. Two-way sync can come later if needed.

### Testing
- Database script run twice against Postgres with Supabase's auth pieces simulated. Verified family isolation, invite-code linking, blocked login hijacking, blocked self-removal, and no access when signed out.
- Every screen exercised in a headless browser at desktop and phone sizes with no errors.

---

## Next Development Priorities

### Alpha 0.5 — Calendar
1. Google Calendar via private iCal addresses (server function to fetch and combine)
2. Today's Calendar card, day/week/month views, color by family member
3. Activity-aware weather tips ("soccer at 5:30, rain likely — pack a jacket")
4. + Event in Quick Add (opens Google Calendar prefilled)

### Alpha 0.6 — Kids
5. Recurring chores with points
6. Rewards: goals, prizes, progress, parent approval, point history
7. Routines (morning/night) with 4/5-style progress
8. Healthy habits with streaks
9. Kid profiles with PIN on shared devices

### Alpha 0.7 — Food
10. Weekly meal planner, Dinner Tonight card
11. Recipes with ingredients
12. Recipe-to-grocery list
13. Meal history ("last had tacos 12 days ago") and simple suggestions
14. Custom lists (packing, ideas, school supplies)

### Alpha 0.8 — Family Life
15. Gift tracker
16. Home projects with budget
17. Family memories

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
| UI-002 | Visual | Planned (0.6) | Routines & Habits card with per-routine lists and 4/5 progress |
| FEAT-001 | Feature | Done (0.4) | Cloud synchronization |
| FEAT-002 | Feature | Planned (0.5) | Google Calendar integration |
| FEAT-003 | Feature | Done (0.4) | Authentication and family roles (kid PIN profiles in 0.6) |
| FEAT-004 | Feature | Partial (0.4) | Tasks done; chores and rewards in 0.6 |
| FEAT-005 | Feature | Partial (0.4) | Grocery list done; meals and recipes in 0.7 |
| FEAT-006 | Feature | Done (0.4) | Weather and clothing engine (activity-aware tips in 0.5) |
| FEAT-007 | Feature | Partial (0.4) | TV mode wake lock, full screen, large text; auto-rotation later |
| FEAT-008 | Feature | Planned | Family Assistant / natural-language Quick Add |
| FEAT-009 | Feature | Done (0.4) | Countdowns with yearly repeats |
| FEAT-010 | Feature | Done (0.4) | Birthdays & anniversaries |

---

## Version History

- **0.1** — Initial responsive dashboard and application shell
- **0.2** — TV mode exit control and Escape-key support
- **0.3** — Removed distracting weather-area decoration and added development documentation
- **0.4** — Real foundation: accounts, shared database, live sync, tasks, groceries, countdowns, birthdays, live weather with clothing suggestions
