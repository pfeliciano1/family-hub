// What happens when someone signs in or out.
import { state, update } from './state.js';
import { toast, friendlyError } from './utils.js';
import { loadMembership, loadAll, subscribe, unsubscribe } from './data.js';
import { loadWeather } from './modules/weather.js';

const EMPTY = {
  me: null, family: null, members: [], countdowns: [], tasks: [], grocery: [],
  weather: null, locResults: [], live: false,
};

export async function handleSession(session, force = false) {
  if (!session) {
    unsubscribe();
    update({ ...EMPTY, user: null, loading: false });
    return;
  }
  if (!force && state.user?.id === session.user.id) return;

  update({ user: session.user, loading: true });
  try {
    const me = await loadMembership(session.user.id);
    if (!me) {
      // Signed in, but not part of a family yet → onboarding screen
      unsubscribe();
      update({ ...EMPTY, loading: false });
      return;
    }
    state.me = me;
    await loadAll();
    subscribe();
    loadWeather();
  } catch (e) {
    console.error(e);
    toast(friendlyError(e), 'error');
    state.me = null;
  }
  update({ loading: false });
}
