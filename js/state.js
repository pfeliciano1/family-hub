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
