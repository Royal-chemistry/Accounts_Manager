// Runs before the page paints, so dark mode users never see a flash of white.
(function () {
  var saved = null;
  try { saved = localStorage.getItem("accounts-manager:theme"); } catch (e) { /* storage may be blocked */ }
  var dark = saved === "dark" || (saved !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
