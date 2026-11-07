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

export const THEME_OPTIONS = [
  { id: "system", label: "Match system", icon: "monitor" },
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
];
