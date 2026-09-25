// Connects to Supabase using the values in config.js.
const cfg = window.FAMILY_HUB_CONFIG || {};

export const configured = Boolean(
  cfg.supabaseUrl && cfg.supabaseKey &&
  !cfg.supabaseUrl.startsWith('YOUR_') && !cfg.supabaseKey.startsWith('YOUR_') &&
  window.supabase
);

export const sb = configured
  ? window.supabase.createClient(cfg.supabaseUrl.trim(), cfg.supabaseKey.trim())
  : null;
