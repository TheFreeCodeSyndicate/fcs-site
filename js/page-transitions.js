/*
 * js/page-transitions.js
 * ------------------------------------------------------------------
 * Names the direction of a cross-page view transition (style.css):
 * going deeper (home or the blog -> a post) is "nav-forward", coming back
 * out is "nav-back", so the page slides the way you are moving, as in
 * Vercel's view transitions guide. Depth is the address's path length.
 * Loaded in <head>, not deferred: "pagereveal" fires before the first
 * frame. Browsers without the Navigation API or view transitions skip it.
 * ------------------------------------------------------------------
 */
addEventListener("pagereveal", (event) => {
  const activation = window.navigation && navigation.activation;
  if (!event.viewTransition || !activation || !activation.from || !activation.entry) return;
  const depth = (url) => new URL(url).pathname.replace(/index\.html$/, "").split("/").filter(Boolean).length;
  const from = depth(activation.from.url);
  const to = depth(activation.entry.url);
  if (to !== from) event.viewTransition.types.add(to > from ? "nav-forward" : "nav-back");
});
