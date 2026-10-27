/*
 * Shad3ious Docs - theme-init.js
 * Loaded synchronously in <head> so the saved theme applies before first paint.
 * Dark is the default. Only the exact string 'light' switches it (allowlist, SI-10).
 */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

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
