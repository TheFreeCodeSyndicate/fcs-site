/*
 * js/theme.js
 * ------------------------------------------------------------------
 * The initial theme is already applied by the inline script in <head>,
 * which runs before first paint so there is no flash of the wrong
 * theme. This file only handles the toggle and keeps aria in sync.
 * ---------------------------------------------------------------- */
(function () {
  var STORAGE_KEY = "fcs-theme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }

  function syncButton(theme) {
    var button = document.getElementById("theme-toggle");
    if (!button) return;
    var isDark = theme === "dark";
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", "Switch to " + (isDark ? "light" : "dark") + " mode");
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    syncButton(theme);
  }

  window.FCSTheme = {
    apply: apply,
    current: currentTheme,
    toggle: function () {
      apply(currentTheme() === "dark" ? "light" : "dark");
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("theme-toggle");
    syncButton(currentTheme());
    if (!button) return;

    button.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        /* storage unavailable — the theme still applies for this page view */
      }
      apply(next);
    });
  });
})();
