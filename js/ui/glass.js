// Light catches floating glass near the pointer. Purely decorative, so it stays off on touch screens
// and for anyone who has asked for less motion.
export function trackGlassLight() {
  const calm = window.matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)");
  let pending = null;
  document.addEventListener("pointermove", (e) => {
    if (calm.matches) return;
    const glass = e.target.closest?.(".glass, .glass-side");
    if (!glass) return;
    pending = { glass, x: e.clientX, y: e.clientY };
    requestAnimationFrame(() => {
      if (!pending) return;
      const box = pending.glass.getBoundingClientRect();
      pending.glass.style.setProperty("--glass-x", `${pending.x - box.left}px`);
      pending.glass.style.setProperty("--glass-y", `${pending.y - box.top}px`);
      pending = null;
    });
  }, { passive: true });
}
