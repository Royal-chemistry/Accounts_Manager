// Accounts have no album art, so every client, supplier, person and item gets generated artwork instead:
// a colour worked out from their name, so the same name always looks the same, plus their initials.
const TONES = 8;
const NOISE = /^(pvt|private|ltd|limited|llp|llc|inc|co|company|the|and|&)\.?$/i;

export function artTone(name) {
  // FNV-1a, which spreads similar names across the colours far better than a simple sum.
  let hash = 0x811c9dc5;
  for (const char of String(name ?? "").trim().toLowerCase()) hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193);
  return ((hash ^ (hash >>> 16)) >>> 0) % TONES + 1;
}

export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const useful = words.filter((w) => !NOISE.test(w));
  const picked = (useful.length ? useful : words).slice(0, 2);
  return picked.map((w) => [...w][0].toUpperCase()).join("");
}
