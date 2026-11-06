// Logo upload. Browser storage is small, so images are shrunk here before they're saved.
import { html, setHTML } from "./dom.js";
import { icon } from "./icons.js";

const MAX_SIDE = 256;
const MAX_LENGTH = 140_000; // about 100 KB once stored as text

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image couldn't be read")); };
    img.src = url;
  });
}

/** Resizes an image file to at most 256 pixels and about 100 KB. Returns a data URL. */
export async function shrinkLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Please choose a PNG, JPEG or WebP image");
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  let out = canvas.toDataURL("image/png");
  for (const quality of [0.9, 0.75, 0.6, 0.45]) {
    if (out.length <= MAX_LENGTH) break;
    out = canvas.toDataURL("image/webp", quality);
  }
  if (out.length > MAX_LENGTH) throw new Error("That image is too detailed to store. Please try a simpler one");
  return out;
}

/** A form field for the logo. Use with type: "custom". */
export function logoField({ k = "logo", label = "Logo", hint = "PNG, JPEG or WebP. It's shrunk to fit, and kept in this browser." } = {}) {
  return {
    k, label, type: "custom", full: true, hint,
    read: (el) => el.dataset.value || "",
    mount(el, api) {
      el.dataset.value = api.values()[k] || "";
      const paint = () => {
        setHTML(el, html`
          <div class="logo-field">
            ${el.dataset.value ? html`<img class="logo-preview" src="${el.dataset.value}" alt="Your logo">` : html`<span class="logo-preview logo-empty">${icon("building")}</span>`}
            <label class="btn">
              ${icon("upload")}${el.dataset.value ? "Change logo" : "Upload logo"}
              <input class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" data-logo-input aria-label="${label}">
            </label>
            ${el.dataset.value ? html`<button type="button" class="btn btn-ghost" data-logo-remove>Remove</button>` : ""}
          </div>`);
      };
      el.addEventListener("change", async (e) => {
        if (!e.target.matches("[data-logo-input]") || !e.target.files[0]) return;
        e.stopPropagation();
        try {
          el.dataset.value = await shrinkLogo(e.target.files[0]);
          api.setError(k, "");
          paint();
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } catch (err) {
          api.setError(k, err.message);
        }
      });
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-logo-remove]")) {
          el.dataset.value = "";
          paint();
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      paint();
    },
  };
}
