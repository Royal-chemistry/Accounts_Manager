// A generated artwork tile. It's decoration beside a name that's always written out, so screen readers skip it.
import { artTone, initials } from "../core/artwork.js";
import { html } from "./dom.js";

export const artwork = (name, size = "") => html`<span class="art art-${artTone(name)} ${size ? `art-${size}` : ""}" aria-hidden="true">${initials(name)}</span>`;

/** Artwork beside a cell's own content, for tables. */
export const withArt = (name, content) => html`<span class="with-art">${artwork(name)}<span class="with-art-text">${content}</span></span>`;
