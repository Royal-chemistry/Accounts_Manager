// Hash-based routes, so every page has its own URL and the Back button works on GitHub Pages.

export function parseHash(hash = location.hash) {
  const [path = ""] = hash.replace(/^#\/?/, "").split("?");
  const [page, ...params] = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { page: page || "dashboard", params };
}

export const navigate = (path) => {
  const target = `#/${path}`;
  if (location.hash === target) return false;
  location.hash = target;
  return true;
};

export const onRouteChange = (fn) => window.addEventListener("hashchange", () => fn(parseHash()));
