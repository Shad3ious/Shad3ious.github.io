/*
 * Shad3ious Docs - theme-init.js
 * Loaded synchronously in <head> so the saved theme applies before first paint.
 * Dark is the default. Only the exact string 'light' switches it (allowlist, SI-10).
 *
 * Also blocks clickjacking: GitHub Pages cannot send frame-ancestors or
 * X-Frame-Options headers, so if the page is loaded inside any frame, the CSS
 * hides the whole site and shows a link to open it directly instead.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  var framed = true;
  try {
    framed = window.self !== window.top;
  } catch (e) {
    framed = true; // cross-origin access errors mean we are framed
  }
  if (framed) {
    root.classList.add('is-framed');
  }

  var saved = null;
  try {
    saved = window.localStorage.getItem('theme');
  } catch (e) {
    saved = null; // storage blocked (private mode, policy) - stay dark
  }
  if (saved === 'light') {
    root.classList.add('theme-light');
  }
}());
