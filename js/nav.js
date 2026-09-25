// Every section of Family Hub. Sections with "soon" show a roadmap page
// until their module is built; they plug in without changing anything else.
export const NAV = [
  { id: 'home',       icon: '🏠', label: 'Home' },
  { id: 'calendar',   icon: '📅', label: 'Calendar', soon: 'Alpha 0.5' },
  { id: 'tasks',      icon: '✅', label: 'Tasks & Chores', short: 'Tasks' },
  { id: 'rewards',    icon: '⭐', label: 'Rewards', soon: 'Alpha 0.6' },
  { id: 'meals',      icon: '🍽️', label: 'Meals', soon: 'Alpha 0.7' },
  { id: 'recipes',    icon: '📖', label: 'Recipes', soon: 'Alpha 0.7' },
  { id: 'grocery',    icon: '🛒', label: 'Grocery List', short: 'Grocery' },
  { id: 'lists',      icon: '📝', label: 'Lists', soon: 'Alpha 0.7' },
  { id: 'routines',   icon: '🔄', label: 'Routines', soon: 'Alpha 0.6' },
  { id: 'habits',     icon: '❤️', label: 'Habits', soon: 'Alpha 0.6' },
  { id: 'countdowns', icon: '⏳', label: 'Countdowns' },
  { id: 'birthdays',  icon: '🎂', label: 'Birthdays & Anniversaries', short: 'Birthdays' },
  { id: 'gifts',      icon: '🎁', label: 'Gifts', soon: 'Alpha 0.8' },
  { id: 'weather',    icon: '🌤️', label: 'Weather' },
  { id: 'projects',   icon: '🔨', label: 'Home Projects', soon: 'Alpha 0.8' },
  { id: 'memories',   icon: '📸', label: 'Family Memories', soon: 'Alpha 0.8' },
  { id: 'assistant',  icon: '🤖', label: 'Family Assistant', soon: 'Alpha 0.9' },
];

export const SETTINGS = { id: 'settings', icon: '⚙️', label: 'Settings' };

export const NAV_IDS = new Set([...NAV.map(n => n.id), SETTINGS.id]);
