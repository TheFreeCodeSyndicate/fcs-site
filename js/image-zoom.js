/*
 * js/image-zoom.js
 * ------------------------------------------------------------------
 * Click to zoom a post's images, as in Notion: the image grows from where
 * it sits to fill the screen over a dark backdrop; a click anywhere or
 * Escape sends it back. One listener on the document, so it works on the
 * published page and in the editor's Preview alike (blog-editor.js).
 * ------------------------------------------------------------------
 */
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const TIMING = { duration: 280, easing: "cubic-bezier(.2, .8, .2, 1)" };

const zoomable = (img) => img instanceof HTMLImageElement
  && img.matches(".post .prose img:not(.emoji, .mention-avatar)")
  && !img.closest("a, .mention, .bookmark, .link-icon");

/** The transform that puts `to` exactly over `from`. */
const over = (from, to) =>
  `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width}, ${from.height / to.height})`;

function zoom(src) {
  const dialog = document.createElement("dialog");
  dialog.className = "image-zoom";
  dialog.setAttribute("aria-label", src.alt ? `Image: ${src.alt}` : "Image");
  const img = new Image();
  img.src = src.currentSrc || src.src;
  img.alt = src.alt;
  dialog.append(img);
  document.body.append(dialog);
  dialog.showModal();
  src.style.visibility = "hidden";
  const still = reduced();
  if (!still) img.animate([{ transform: over(src.getBoundingClientRect(), img.getBoundingClientRect()) }, { transform: "none" }], TIMING);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    dialog.classList.add("is-closing");
    if (!still) await img.animate([{ transform: "none" }, { transform: over(src.getBoundingClientRect(), img.getBoundingClientRect()) }], { ...TIMING, fill: "forwards" }).finished.catch(() => {});
    src.style.visibility = "";
    dialog.remove();
  };
  dialog.addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  addEventListener("scroll", close, { once: true, capture: true });
}

document.addEventListener("click", (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (!zoomable(e.target)) return;
  e.preventDefault();
  zoom(e.target);
});
