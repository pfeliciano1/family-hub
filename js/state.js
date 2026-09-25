// One shared state object. Changing it through update() redraws the screen.
export const state = {
  loading: true,
  user: null,          // the signed-in login
  me: null,            // the signed-in person's family_members row
  family: null,
  members: [],
  countdowns: [],
  tasks: [],
  grocery: [],
  calendars: [],
  calendarsMissing: false,  // true until the 0.5 database script is run
  events: null,        // calendar events: { from, to, list, errors, fetchedAt } or { error }
  // Kids (0.6)
  kidsMissing: false,  // true until the 0.6 database script is run
  rewards: [],
  chores: [],
  completions: [],     // chore check-offs, last 45 days
  claims: [],          // reward requests
  points: [],          // recent point history
  balances: {},        // member id → { balance, earned }
  routines: [],
  steps: [],
  checks: [],          // routine step check-offs, last 7 days
  habits: [],
  habitLogs: [],
  kidId: null,         // Kid mode: the child using this device
  kidPicker: false,    // Kid mode: choosing who's using the device
  choreEdit: false,    // Tasks page: showing the chore manager
  calView: 'week',     // day | week | month
  calDate: null,       // the day the calendar page is looking at (YYYY-MM-DD)
  weather: null,
  live: false,         // true while live sync is connected
  view: 'home',
  tv: false,
  authMode: 'signin',
  authNotice: null,
  taskFilter: 'open',
  locResults: [],
  lastGroceryCat: 'Other',
};

let renderFn = () => {};
export function setRenderer(fn) { renderFn = fn; }

export function update(patch = {}) {
  Object.assign(state, patch);
  renderFn();
}
