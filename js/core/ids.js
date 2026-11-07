// Record IDs. Always safe to place in HTML attributes.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function uid() {
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const isSafeId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
