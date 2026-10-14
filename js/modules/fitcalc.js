// Fitness math: categories, calorie estimates, and time formatting.
// No page code here, so it can be checked on its own.

// id → [label, icon, default intensity (MET)]
export const CATEGORIES = {
  run: ['Run', '🏃', 9.8],
  cardio: ['Cardio', '🔥', 8.0],
  abs: ['Abs', '🎯', 3.8],
  strength: ['Strength', '💪', 5.0],
  mobility: ['Mobility', '🧘', 2.5],
};
export const CATEGORY_IDS = Object.keys(CATEGORIES);
export const catLabel = c => CATEGORIES[c]?.[0] || c;
export const catIcon = c => CATEGORIES[c]?.[1] || '🏋️';

// Running intensity by pace (mph → MET), in between points is interpolated
const RUN_PACE = [[5, 8.3], [6, 9.8], [7, 11.0], [8, 11.8]];

export function runMet(miles, minutes) {
  const mi = Number(miles), min = Number(minutes);
  if (!(mi > 0) || !(min > 0)) return CATEGORIES.run[2];
  const mph = mi / (min / 60);
  if (mph <= RUN_PACE[0][0]) return RUN_PACE[0][1];
  for (let i = 1; i < RUN_PACE.length; i++) {
    const [x1, y1] = RUN_PACE[i - 1], [x2, y2] = RUN_PACE[i];
    if (mph <= x2) return Math.round((y1 + (y2 - y1) * (mph - x1) / (x2 - x1)) * 100) / 100;
  }
  return RUN_PACE[RUN_PACE.length - 1][1];
}

// Intensity for a workout: runs use pace when there's a distance;
// everything else uses the routine's own value or the category default.
export function metFor({ category, routineMet, miles, minutes }) {
  if (category === 'run') return Number(miles) > 0 ? runMet(miles, minutes) : (Number(routineMet) || CATEGORIES.run[2]);
  return Number(routineMet) || CATEGORIES[category]?.[2] || 4;
}

// calories = MET × 3.5 × kg ÷ 200 × minutes, rounded to a whole number
export function calories(met, weightLbs, minutes) {
  const kg = Number(weightLbs) * 0.4536;
  const v = Number(met) * 3.5 * kg / 200 * Number(minutes);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

// 75 → "1 h 15 min", 20 → "20 min"
export function fmtMinutes(min) {
  const m = Math.round(Number(min) || 0);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

// 45 → "45 s", 90 → "1:30", 900 → "15 min"
export function fmtSeconds(sec) {
  const s = Math.round(Number(sec) || 0);
  if (s < 60) return `${s} s`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// What a step asks for: "3 × 10 reps", "40 s", "15 min"
export function stepDose(st) {
  const sets = Number(st.sets) > 1 ? `${st.sets} × ` : '';
  if (st.reps) return `${sets}${st.reps} reps`;
  if (st.duration_sec) return `${sets}${fmtSeconds(st.duration_sec)}`;
  return '';
}
