// Light, dark, or follow the system.
const KEY = "accounts-manager:theme";
const system = () => window.matchMedia("(prefers-color-scheme: dark)");

export function themePreference() {
  try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; }
}

function apply(pref) {
  const dark = pref === "dark" || (pref !== "light" && system().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setTheme(pref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* the choice just won't be remembered */ }
  apply(pref);
}

export function watchSystemTheme() {
  system().addEventListener("change", () => { if (themePreference() === "system") apply("system"); });
}

// How see-through the glass is, from 0 (most transparent) to 1 (most tinted), like the slider in iOS 27.
const GLASS_KEY = "accounts-manager:glass";
export const GLASS_DEFAULT = 0.45;

export function glassStrength() {
  try {
    const saved = Number.parseFloat(localStorage.getItem(GLASS_KEY));
    return Number.isFinite(saved) ? saved : GLASS_DEFAULT;
  } catch { return GLASS_DEFAULT; }
}

export function setGlassStrength(value) {
  document.documentElement.style.setProperty("--glass-strength", String(value));
  try { localStorage.setItem(GLASS_KEY, String(value)); } catch { /* the choice just won't be remembered */ }
}

export const THEME_OPTIONS = [
  { id: "system", label: "Match system", icon: "monitor" },
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
];
