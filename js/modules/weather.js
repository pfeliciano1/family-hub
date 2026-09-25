// Weather + "what to wear" using Open-Meteo (free, no account or key).
import { state, update } from '../state.js';
import { esc, cardHead, fmtDate, parseDate } from '../utils.js';

const CODES = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly sunny'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'],
  45: ['🌫️', 'Foggy'], 48: ['🌫️', 'Freezing fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
  56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'],
  85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Heavy snow showers'],
  95: ['⛈️', 'Thunderstorms'], 96: ['⛈️', 'Storms with hail'], 99: ['⛈️', 'Storms with hail'],
};
const describe = code => CODES[code] || ['🌡️', 'Unknown'];
const isRain = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const isSnow = c => (c >= 71 && c <= 77) || c === 85 || c === 86;

export async function loadWeather(force = false) {
  const f = state.family;
  if (!f || f.latitude == null || f.longitude == null) {
    if (state.weather) update({ weather: null });
    return;
  }
  const key = `${f.latitude},${f.longitude},${f.temp_unit}`;
  const w = state.weather;
  if (!force && w && !w.error && w.key === key && Date.now() - w.fetchedAt < 30 * 60 * 1000) return;

  const imperial = f.temp_unit !== 'celsius';
  const params = new URLSearchParams({
    latitude: f.latitude,
    longitude: f.longitude,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max',
    temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    wind_speed_unit: imperial ? 'mph' : 'kmh',
    timezone: 'auto',
    forecast_days: '5',
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
    const j = await res.json();
    const d = j.daily;
    const days = d.time.map((date, i) => ({
      date,
      code: d.weather_code[i],
      hi: d.temperature_2m_max[i],
      lo: d.temperature_2m_min[i],
      pop: d.precipitation_probability_max?.[i] ?? 0,
      uv: d.uv_index_max?.[i] ?? 0,
    }));
    update({
      weather: {
        key, imperial, fetchedAt: Date.now(),
        temp: j.current.temperature_2m,
        feels: j.current.apparent_temperature,
        code: j.current.weather_code,
        wind: j.current.wind_speed_10m,
        days,
      },
    });
  } catch (e) {
    console.error(e);
    update({ weather: { key, error: true, fetchedAt: Date.now() } });
  }
}

// Turn the forecast into practical advice.
export function clothingFor(w) {
  const toF = v => (w.imperial ? v : v * 9 / 5 + 32);
  const toMph = v => (w.imperial ? v : v / 1.609);
  const today = w.days[0];
  const feels = toF(w.feels);
  const hi = toF(today.hi);
  const lo = toF(today.lo);
  let core;
  if (feels < 25) core = ['🧥 Heavy winter coat', '🧣 Hat and scarf', '🧤 Gloves', '🥾 Warm boots'];
  else if (feels < 40) core = ['🧥 Winter coat', '🧤 Gloves and a hat', '👖 Long pants'];
  else if (feels < 55) core = ['🧥 Warm jacket', '👕 Long sleeves', '👖 Long pants'];
  else if (feels < 65) core = ['🧥 Light jacket or hoodie', '👖 Jeans or pants'];
  else if (feels < 78) core = ['👕 T-shirt', '👖 Light pants or shorts'];
  else core = ['👕 Light, breathable clothes', '🩳 Shorts', '💧 Extra water'];

  // Rain and snow gear matter most, so they go right after the main layer
  let wet = null;
  if (isSnow(today.code) || isSnow(w.code)) wet = '❄️ Snow boots and waterproof gloves';
  else if (today.pop >= 50 || isRain(w.code)) wet = feels < 55 ? '🧥 Waterproof jacket' : '☔ Rain jacket or umbrella';
  else if (today.pop >= 30) wet = '☂️ Maybe pack an umbrella';

  const items = [core[0], ...(wet ? [wet] : []), ...core.slice(1)];
  if (hi - lo >= 18) items.push(`🔄 Dress in layers (${Math.round(today.lo)}° to ${Math.round(today.hi)}°)`);
  if (toMph(w.wind) >= 18) items.push('💨 Windbreaker, it\'s gusty');
  if (today.uv >= 6 && feels >= 60) items.push('🧴 Sunscreen');
  return items;
}

const unit = w => (w.imperial ? 'F' : 'C');

// ---------- Dashboard pieces ----------

export function heroWeather() {
  const f = state.family;
  const w = state.weather;
  if (f.latitude == null) {
    return `<a class="hero-weather setup" href="#/settings">🌤️ Set your location in Settings to see the weather and what to wear</a>`;
  }
  if (!w) return `<div class="hero-weather"><span class="muted">Loading weather…</span></div>`;
  if (w.error) return `<div class="hero-weather"><span class="muted">Weather is unavailable right now.</span></div>`;
  const [icon, text] = describe(w.code);
  const wear = clothingFor(w).slice(0, 3);
  return `<a class="hero-weather" href="#/weather" title="Weather details">
      <div class="hw-now"><span class="hw-icon">${icon}</span>
        <div><div class="temp">${Math.round(w.temp)}°${unit(w)}</div>
        <div class="muted">${text}, feels like ${Math.round(w.feels)}°</div></div></div>
      <div class="hw-wear"><b>👕 What to wear</b>${wear.map(x => `<div>${x}</div>`).join('')}</div>
    </a>`;
}

export function weatherCard() {
  const f = state.family;
  const w = state.weather;
  let body;
  if (f.latitude == null) body = `<div class="empty-mini">No location yet. <a href="#/settings">Set it in Settings</a></div>`;
  else if (!w) body = `<p class="muted">Loading…</p>`;
  else if (w.error) body = `<p class="muted">Weather is unavailable right now.</p>`;
  else {
    const t = w.days[0];
    const [icon, text] = describe(w.code);
    body = `<div class="wx-mini"><span class="hw-icon">${icon}</span>
        <div><b class="temp">${Math.round(w.temp)}°${unit(w)}</b>
        <div class="muted">${text} • High ${Math.round(t.hi)}° • Low ${Math.round(t.lo)}°${t.pop ? ` • ${t.pop}% rain` : ''}</div></div></div>
      <ul class="wear-list">${clothingFor(w).map(x => `<li>${x}</li>`).join('')}</ul>`;
  }
  return `<div class="card">${cardHead('🌤️', 'Weather & What to Wear', 'weather', 'Details')}${body}</div>`;
}

// ---------- Weather page ----------

export function view() {
  const f = state.family;
  const w = state.weather;
  const title = `<div class="page-title"><h2>🌤️ Weather</h2>${f.location_name ? `<span class="muted">📍 ${esc(f.location_name)}</span>` : ''}</div>`;
  if (f.latitude == null) {
    return `${title}<div class="panel empty"><div class="empty-icon">📍</div>
      <h3>Add your location to see the weather</h3>
      <p>Family Hub uses it for the forecast and clothing suggestions.</p>
      <a class="btn primary" href="#/settings">Open Settings</a></div>`;
  }
  if (!w) return `${title}<div class="panel empty">Loading weather…</div>`;
  if (w.error) {
    return `${title}<div class="panel empty"><p>Weather is unavailable right now.</p>
      <button class="btn" data-action="weather-retry">Try again</button></div>`;
  }
  const [icon, text] = describe(w.code);
  const t = w.days[0];
  return `${title}
    <div class="weather-grid">
      <section class="panel">
        <div class="wx-now"><span class="big">${icon}</span>
          <div><div class="temp">${Math.round(w.temp)}°${unit(w)}</div>
          <div>${text}</div>
          <div class="muted">Feels like ${Math.round(w.feels)}° • High ${Math.round(t.hi)}° • Low ${Math.round(t.lo)}°</div>
          <div class="muted">Rain chance ${t.pop}% • Wind ${Math.round(w.wind)} ${w.imperial ? 'mph' : 'km/h'} • UV ${Math.round(t.uv)}</div></div>
        </div>
      </section>
      <section class="panel">
        <h3>👕 What to wear today</h3>
        <ul class="wear-list">${clothingFor(w).map(x => `<li>${x}</li>`).join('')}</ul>
      </section>
    </div>
    <section class="panel">
      <h3>Next few days</h3>
      <div class="forecast">${w.days.slice(1).map(day => {
        const [di, dt] = describe(day.code);
        return `<div class="fday"><b>${fmtDate(parseDate(day.date), { weekday: 'short' })}</b>
          <div class="ic">${di}</div><div>${Math.round(day.hi)}° / ${Math.round(day.lo)}°</div>
          <div class="muted">${dt}${day.pop >= 30 ? ` • ${day.pop}%` : ''}</div></div>`;
      }).join('')}</div>
    </section>
    <p class="muted small">Activity-aware suggestions (like "soccer at 5:30 and rain is expected") arrive once the calendar is connected.</p>`;
}

export const actions = {
  'weather-retry': () => loadWeather(true),
};
