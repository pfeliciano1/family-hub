// Every section of Family Hub. Sections with "soon" show a roadmap page
// until their module is built; they plug in without changing anything else.
export const NAV = [
  { id: 'home',       icon: '🏠', label: 'Home' },
  { id: 'calendar',   icon: '📅', label: 'Calendar' },
  { id: 'tasks',      icon: '✅', label: 'Tasks & Chores', short: 'Tasks' },
  { id: 'rewards',    icon: '⭐', label: 'Rewards' },
  { id: 'meals',      icon: '🍽️', label: 'Meals' },
  { id: 'recipes',    icon: '📖', label: 'Recipes' },
  { id: 'grocery',    icon: '🛒', label: 'Grocery List', short: 'Grocery' },
  { id: 'lists',      icon: '📝', label: 'Lists' },
  { id: 'routines',   icon: '🔄', label: 'Routines' },
  { id: 'habits',     icon: '❤️', label: 'Habits' },
  { id: 'countdowns', icon: '⏳', label: 'Countdowns' },
  { id: 'birthdays',  icon: '🎂', label: 'Birthdays & Anniversaries', short: 'Birthdays' },
  { id: 'gifts',      icon: '🎁', label: 'Gifts' },
  { id: 'weather',    icon: '🌤️', label: 'Weather' },
  { id: 'projects',   icon: '🔨', label: 'Home Projects', short: 'Projects' },
  { id: 'memories',   icon: '📸', label: 'Family Memories', short: 'Memories' },
  { id: 'assistant',  icon: '🤖', label: 'Family Assistant', soon: 'Alpha 0.9' },
];

export const SETTINGS = { id: 'settings', icon: '⚙️', label: 'Settings' };

export const NAV_IDS = new Set([...NAV.map(n => n.id), SETTINGS.id]);
