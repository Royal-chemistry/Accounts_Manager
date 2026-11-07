// Runs before the page paints, so dark mode users never see a flash of white.
(function () {
  var saved = null;
  var glass = null;
  try {
    saved = localStorage.getItem("accounts-manager:theme");
    glass = localStorage.getItem("accounts-manager:glass");
  } catch (e) { /* storage may be blocked */ }
  var dark = saved === "dark" || (saved !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (glass !== null) document.documentElement.style.setProperty("--glass-strength", glass);
})();
