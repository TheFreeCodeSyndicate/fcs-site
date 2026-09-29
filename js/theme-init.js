/*
 * js/theme-init.js
 * ------------------------------------------------------------------
 * Loaded as a normal, blocking <script> in <head> of every page, so it
 * runs before first paint and the page never flashes the wrong theme.
 * It lives in its own file (not inline) so the Content-Security-Policy
 * can allow scripts from this site only, with no inline exceptions.
 * ------------------------------------------------------------------
 */
(function () {
  try {
    var stored = localStorage.getItem("fcs-theme");
    document.documentElement.setAttribute(
      "data-theme",
      stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    );
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
