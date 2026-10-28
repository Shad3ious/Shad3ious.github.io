/*
 * Shad3ious Docs - app.js
 * Application engine. You should not need to edit this file; content lives in config.js.
 *
 * Security (NIST SP 800-53 SI-10, SC-18 / OWASP):
 * - Text from config and the URL is written with textContent only.
 * - Markdown pipeline: fetch -> marked -> DOMPurify (returns a DOM fragment) ->
 *   DOM post-processing. Sanitized HTML is never re-serialized and re-parsed,
 *   which closes the mutation-XSS (mXSS) gap. No innerHTML anywhere.
 * - Trusted Types are enforced by the CSP in supporting browsers, so any
 *   future innerHTML-style sink without sanitizing fails closed.
 * - Raw HTML <input> in Markdown is reduced to disabled checkboxes (task lists).
 * - The page refuses to render inside another site's frame (clickjacking).
 * - Routes are an allowlist built from config.js; unknown hashes are rejected.
 * - Doc paths must match docs/<path>.md with no "..", so fetch() cannot be
 *   pointed anywhere else.
 * - External URLs must be https://. Stored theme is checked against an allowlist.
 * - Search input is capped at 100 chars; regex input is escaped.
 * - No eval, Function, document.write, inline handlers, or inline styles.
 */
(function () {
  'use strict';

  // -- CONSTANTS ---------------------------------------------------------
  var THEMES = Object.freeze(['dark', 'light']);
  var MAX_QUERY = 100;
  var FETCH_TIMEOUT_MS = 8000;
  var SUGGESTED_SOON = 4;
  var DOC_PATH_RE = /^docs\/[A-Za-z0-9_\-\/]+\.md$/;
  var ANCHOR_RE = /^[a-z0-9-]{1,80}$/;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var DOMPURIFY_CONFIG = Object.freeze({
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
      'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'kbd',
      'a', 'pre', 'code', 'blockquote',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'div', 'span', 'details', 'summary', 'img', 'input'
    ],
    ALLOWED_ATTR: ['href', 'class', 'src', 'alt', 'width', 'height', 'title', 'colspan', 'rowspan', 'align', 'type', 'checked', 'disabled'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'button', 'select', 'textarea', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'id', 'name', 'xmlns', 'srcset', 'formaction', 'form'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    RETURN_DOM_FRAGMENT: true,
    RETURN_TRUSTED_TYPE: false
  });

  // -- STATE -------------------------------------------------------------
  var GUIDES = [];
  var ROUTES = Object.create(null);
  var docCache = Object.create(null);
  var navToken = 0;
  var tocObserver = null;
  var currentGuide = null;
  var openGroups = Object.create(null);
  var lastFocus = null;
  var homeLauncher = null;
  var paletteLauncher = null;

  // -- SMALL HELPERS -----------------------------------------------------
  function byId(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function icon(paths, className) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (className ? ' ' + className : ''));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function safeUrl(url) {
    if (typeof url !== 'string') { return null; }
    try {
      var u = new URL(url);
      return u.protocol === 'https:' ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function slugify(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = byId('toast');
    if (!t) { return; }
    t.textContent = msg;
    t.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-shown'); }, 2200);
  }

  function copyText(text) {
    if (!navigator.clipboard || !window.isSecureContext) {
      return Promise.reject(new Error('Clipboard unavailable'));
    }
    return navigator.clipboard.writeText(text);
  }

  // -- INDEX (built once from config.js) ---------------------------------
  function buildIndex() {
    NAV.forEach(function (cat) {
      if (!cat || typeof cat.id !== 'string' || !/^[a-z0-9-]+$/.test(cat.id)) {
        console.warn('[docs] Skipping category with invalid id:', cat && cat.id);
        return;
      }
      cat.items.forEach(function (item) {
        var slug = slugify(item.label);
        var key = cat.id + '/' + slug;
        var file = null;
        if (item.file !== null && item.file !== undefined) {
          if (typeof item.file === 'string' && DOC_PATH_RE.test(item.file) && item.file.indexOf('..') === -1) {
            file = item.file;
          } else {
            console.warn('[docs] Rejected file path in config.js:', item.file);
          }
        }
        if (!slug || ROUTES[key]) {
          console.warn('[docs] Duplicate or empty guide label in config.js:', item.label);
          return;
        }
        var g = {
          key: key,
          cat: cat,
          item: item,
          label: item.label,
          catLabel: cat.label,
          file: file,
          live: !!file,
          search: (item.label + ' ' + cat.label + ' ' + (item.tags || []).join(' ')).toLowerCase()
        };
        ROUTES[key] = g;
        GUIDES.push(g);
      });
    });
  }

  function findGuides(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      var live = GUIDES.filter(function (g) { return g.live; });
      var soon = GUIDES.filter(function (g) { return !g.live; }).slice(0, SUGGESTED_SOON);
      return { label: 'Suggested', list: live.concat(soon) };
    }
    var hits = GUIDES.filter(function (g) { return g.search.indexOf(q) !== -1; });
    hits.sort(function (a, b) {
      var as = a.label.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      var bs = b.label.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      if (as !== bs) { return as - bs; }
      if (a.live !== b.live) { return a.live ? -1 : 1; }
      return 0;
    });
    return { label: hits.length + (hits.length === 1 ? ' match' : ' matches'), list: hits };
  }

  /** Safe highlight: text nodes plus <mark>, never innerHTML. */
  function highlight(container, text, query) {
    var q = query.trim();
    if (!q) { container.textContent = text; return; }
    var re = new RegExp('(' + escapeRegex(q) + ')', 'ig');
    text.split(re).forEach(function (part, i) {
      if (!part) { return; }
      if (i % 2 === 1) {
        container.appendChild(el('mark', null, part));
      } else {
        container.appendChild(document.createTextNode(part));
      }
    });
  }

  // -- LAUNCHER (home search and Ctrl K palette share this) --------------
  function createLauncher(opts) {
    var input = byId(opts.input);
    var list = byId(opts.list);
    var status = byId(opts.status);
    var results = [];
    var active = 0;

    function setActive(i) {
      if (!results.length) {
        input.removeAttribute('aria-activedescendant');
        return;
      }
      active = (i + results.length) % results.length;
      Array.prototype.forEach.call(list.children, function (li, idx) {
        var on = idx === active;
        li.classList.toggle('is-active', on);
        li.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) {
          input.setAttribute('aria-activedescendant', li.id);
          li.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    function render() {
      var raw = input.value.slice(0, MAX_QUERY);
      var found = findGuides(raw);
      results = found.list;
      status.textContent = found.label;
      list.textContent = '';
      if (!results.length) {
        var empty = el('li', 'launch-empty', 'Nothing matches that yet. Try a category name like linux or windows.');
        empty.setAttribute('role', 'presentation');
        list.appendChild(empty);
        input.removeAttribute('aria-activedescendant');
        return;
      }
      results.forEach(function (g, i) {
        var li = el('li', 'launch-opt' + (g.live ? ' is-live' : ''));
        li.id = opts.list + '-opt-' + i;
        li.setAttribute('role', 'option');
        var title = el('span', 'opt-title');
        highlight(title, g.label, raw);
        li.appendChild(title);
        li.appendChild(el('span', 'opt-cat', g.catLabel));
        li.appendChild(el('span', 'opt-status', g.live ? 'read' : 'soon'));
        li.addEventListener('click', function () { opts.onPick(g); });
        li.addEventListener('mousemove', function () { if (active !== i) { setActive(i); } });
        list.appendChild(li);
      });
      setActive(0);
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (results[active]) { opts.onPick(results[active]); }
      }
    });

    return {
      input: input,
      render: render,
      setQuery: function (q) { input.value = q.slice(0, MAX_QUERY); render(); },
      clear: function () { input.value = ''; render(); }
    };
  }

  function goTo(g) { location.hash = '#/' + g.key; }

  // -- THEME -------------------------------------------------------------
  function currentTheme() {
    return document.documentElement.classList.contains('theme-light') ? 'light' : 'dark';
  }

  function applyTheme(mode, save) {
    if (THEMES.indexOf(mode) === -1) { mode = 'dark'; }
    document.documentElement.classList.toggle('theme-light', mode === 'light');
    byId('theme-label').textContent = mode === 'light' ? 'Light' : 'Dark';
    byId('theme-toggle').setAttribute('aria-label', mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    if (save) {
      try { localStorage.setItem('theme', mode); } catch (e) { /* storage blocked */ }
    }
  }

  // -- STATIC CHROME FROM CONFIG -----------------------------------------
  function buildChrome() {
    var name = String(SITE_CONFIG.siteName || 'Docs');
    byId('brand-name').textContent = name.toLowerCase();
    byId('home-kicker').textContent = name.toLowerCase() + ' docs';
    byId('home-q-label').textContent = 'Search ' + GUIDES.length + ' guides across ' + NAV.length + ' categories';
    var copy = byId('footer-copy');
    copy.textContent = '(c) ' + new Date().getFullYear() + ' ' + name + ' - MIT + Commons Clause';
    var license = safeUrl(SITE_CONFIG.licenseUrl);
    if (license) {
      copy.href = license;
      copy.setAttribute('aria-label', 'License: MIT + Commons Clause, opens on GitHub');
    } else {
      copy.removeAttribute('href');
    }

    var socials = (SITE_CONFIG.socials || []).filter(function (s) { return safeUrl(s.url); });
    var gh = byId('header-github');
    if (socials.length) {
      gh.href = safeUrl(socials[0].url);
      gh.textContent = socials[0].label;
    } else {
      gh.hidden = true;
    }

    var foot = byId('footer-links');
    socials.forEach(function (s) {
      var a = el('a', null, s.label);
      a.href = safeUrl(s.url);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.referrerPolicy = 'no-referrer';
      foot.appendChild(a);
    });

    var chips = byId('home-chips');
    NAV.forEach(function (cat) {
      var b = el('button', 'chip');
      b.type = 'button';
      b.appendChild(document.createTextNode(cat.label));
      b.appendChild(el('span', 'chip-count', cat.items.length));
      b.setAttribute('aria-label', 'Show ' + cat.label + ' guides');
      b.addEventListener('click', function () {
        homeLauncher.setQuery(cat.label);
        homeLauncher.input.focus();
      });
      chips.appendChild(b);
    });
  }

  // -- SIDEBAR -----------------------------------------------------------
  function buildSidebar() {
    var wrap = byId('side-groups');
    NAV.forEach(function (cat) {
      var group = el('div', 'side-group');
      group.dataset.cat = cat.id;

      var btn = el('button', 'side-group-btn');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      btn.appendChild(icon(['M9 6l6 6-6 6']));
      btn.appendChild(document.createTextNode(cat.label));
      var count = el('span', 'side-count', cat.items.length);
      btn.appendChild(count);

      var ul = el('ul', 'side-items');
      ul.id = 'side-items-' + cat.id;
      btn.setAttribute('aria-controls', ul.id);

      GUIDES.filter(function (g) { return g.cat === cat; }).forEach(function (g) {
        var li = el('li');
        var a = el('a', 'side-link' + (g.live ? ' is-live' : ''));
        a.href = '#/' + g.key;
        a.dataset.key = g.key;
        a.appendChild(document.createTextNode(g.label));
        if (!g.live) { a.appendChild(el('span', 'side-soon', 'soon')); }
        li.appendChild(a);
        ul.appendChild(li);
      });

      btn.addEventListener('click', function () {
        openGroups[cat.id] = !openGroups[cat.id];
        syncGroups();
      });

      group.appendChild(btn);
      group.appendChild(ul);
      wrap.appendChild(group);
    });

    byId('side-q').addEventListener('input', filterSidebar);

    var toggle = byId('sidebar-toggle');
    toggle.addEventListener('click', function () {
      var open = !byId('sidebar').classList.contains('is-open');
      byId('sidebar').classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function syncGroups() {
    var filtering = byId('side-q').value.trim() !== '';
    Array.prototype.forEach.call(document.querySelectorAll('.side-group'), function (group) {
      var open = filtering || !!openGroups[group.dataset.cat];
      group.classList.toggle('is-open', open);
      group.querySelector('.side-group-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function filterSidebar() {
    var q = byId('side-q').value.slice(0, MAX_QUERY).trim().toLowerCase();
    var anyVisible = false;
    Array.prototype.forEach.call(document.querySelectorAll('.side-group'), function (group) {
      var shown = 0;
      Array.prototype.forEach.call(group.querySelectorAll('.side-link'), function (a) {
        var g = ROUTES[a.dataset.key];
        var match = !q || g.search.indexOf(q) !== -1;
        a.parentNode.hidden = !match;
        if (match) { shown += 1; }
      });
      group.hidden = shown === 0;
      group.querySelector('.side-count').textContent = shown;
      if (shown) { anyVisible = true; }
    });
    byId('side-empty').hidden = anyVisible;
    syncGroups();
  }

  function markSidebar(g) {
    Array.prototype.forEach.call(document.querySelectorAll('.side-link'), function (a) {
      if (g && a.dataset.key === g.key) {
        a.setAttribute('aria-current', 'page');
      } else {
        a.removeAttribute('aria-current');
      }
    });
    if (g) { openGroups[g.cat.id] = true; }
    syncGroups();
    // Collapse the mobile drawer after navigating.
    byId('sidebar').classList.remove('is-open');
    byId('sidebar-toggle').setAttribute('aria-expanded', 'false');
  }

  // -- MARKDOWN PIPELINE -------------------------------------------------
  function renderMarkdown(raw) {
    if (!window.marked || !window.DOMPurify) {
      throw new Error('The Markdown renderer did not load. Refresh the page to try again.');
    }
    var html = window.marked.parse(raw, { gfm: true, breaks: false, async: false });
    // RETURN_DOM_FRAGMENT: DOMPurify hands back DOM nodes, so the sanitized
    // markup is never turned back into a string and parsed a second time.
    var clean = window.DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
    var frag = el('div', 'prose');
    frag.appendChild(document.importNode(clean, true));
    postProcess(frag);
    return frag;
  }

  function postProcess(root) {
    // Heading ids: readable, unique, used for TOC and deep links.
    var used = Object.create(null);
    Array.prototype.forEach.call(root.querySelectorAll('h1, h2, h3, h4, h5, h6'), function (h) {
      var base = slugify(h.textContent) || 'section';
      var id = base;
      var n = 2;
      // Skip ids already used on the page (sidebar, toc, etc.) so byId() stays reliable.
      while (used[id] || document.getElementById(id)) { id = base + '-' + n; n += 1; }
      used[id] = true;
      h.id = id;
    });

    // Code blocks: wrap with a copy button.
    Array.prototype.forEach.call(root.querySelectorAll('pre'), function (pre) {
      var wrap = el('div', 'code-block');
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      pre.tabIndex = 0; // lets keyboard users scroll wide code
      var btn = el('button', 'code-copy');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Copy code');
      btn.appendChild(icon(['M8 8h12v12H8z', 'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3'], 'icon-copy'));
      btn.appendChild(icon(['M5 12l5 5 9-10'], 'icon-done'));
      wrap.appendChild(btn);
    });

    // Tables: horizontal scroll box.
    Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
      var wrap = el('div', 'table-wrap');
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });

    // Blockquotes: callouts. Supports "> [!TIP]" style and the older emoji style.
    Array.prototype.forEach.call(root.querySelectorAll('blockquote'), function (bq) {
      var first = bq.querySelector('p');
      var text = (first ? first.textContent : bq.textContent) || '';
      var marker = text.match(/^\s*\[!(NOTE|TIP|INFO|IMPORTANT|WARNING|CAUTION|DANGER)\]\s*/i);
      var kind = null;
      if (marker) {
        kind = /WARNING|CAUTION|DANGER/i.test(marker[1]) ? 'warn' : 'tip';
        stripLeadingText(first, marker[0].length);
        prependLabel(first || bq, marker[1].charAt(0).toUpperCase() + marker[1].slice(1).toLowerCase() + ':');
      } else if (/^\s*(\u26A0|warning\b|warn\b|danger\b|caution\b)/i.test(text)) {
        kind = 'warn';
      } else if (/^\s*(\uD83D\uDCA1|tip\b|note\b|info\b)/i.test(text)) {
        kind = 'tip';
      }
      bq.className = kind ? 'callout callout-' + kind : 'quote';
    });

    // Inputs: only GitHub task-list checkboxes survive, and they are inert.
    Array.prototype.forEach.call(root.querySelectorAll('input'), function (inp) {
      if ((inp.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
        inp.remove();
        return;
      }
      inp.setAttribute('disabled', '');
    });

    // Links: harden external, keep internal.
    Array.prototype.forEach.call(root.querySelectorAll('a[href]'), function (a) {
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#') { return; }
      // Same-site relative links stay as-is. "//host" is protocol-relative and
      // would leave the site, so it falls through to the https check below.
      if (/^(\.{1,2}\/|\/(?!\/)|docs\/)/.test(href)) { return; }
      if (href.indexOf('//') === 0) { href = 'https:' + href; }
      if (/^mailto:[^\s<>"]+$/i.test(href)) { return; }
      var safe = safeUrl(href);
      if (!safe) {
        a.removeAttribute('href');
        return;
      }
      a.setAttribute('href', safe);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.setAttribute('referrerpolicy', 'no-referrer');
    });

    // Images: lazy load, no referrer.
    Array.prototype.forEach.call(root.querySelectorAll('img'), function (img) {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('referrerpolicy', 'no-referrer');
      if (!img.getAttribute('alt')) { img.setAttribute('alt', ''); }
    });
  }

  function stripLeadingText(node, count) {
    if (!node) { return; }
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    var left = count;
    while (left > 0 && walker.nextNode()) {
      var t = walker.currentNode;
      var take = Math.min(left, t.nodeValue.length);
      t.nodeValue = t.nodeValue.slice(take);
      left -= take;
    }
  }

  function prependLabel(node, label) {
    node.insertBefore(el('strong', 'callout-label', label), node.firstChild);
  }

  // -- FETCH -------------------------------------------------------------
  function fetchDoc(path) {
    if (docCache[path]) { return Promise.resolve(docCache[path]); }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
    return fetch(path, {
      method: 'GET',
      cache: 'no-cache',
      credentials: 'same-origin',
      headers: { 'Accept': 'text/markdown, text/plain' },
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) { throw new Error('The file returned HTTP ' + res.status + '. Check that the path in config.js matches the file.'); }
      var ct = res.headers.get('content-type') || '';
      if (ct && ct.indexOf('text/') !== 0 && ct.indexOf('markdown') === -1 && ct.indexOf('octet-stream') === -1) {
        throw new Error('The server sent ' + ct.split(';')[0] + ' instead of Markdown.');
      }
      return res.text();
    }).then(function (text) {
      var head = text.trim().slice(0, 15).toLowerCase();
      if (head.indexOf('<!doctype') === 0 || head.indexOf('<html') === 0) {
        throw new Error('The file was not found. Check that the path in config.js matches the file exactly.');
      }
      docCache[path] = text;
      return text;
    }).finally(function () {
      clearTimeout(timer);
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Loading took longer than ' + (FETCH_TIMEOUT_MS / 1000) + ' seconds. Check your connection and try again.');
      }
      throw err;
    });
  }

  // -- VIEWS -------------------------------------------------------------
  function setView(name) {
    document.documentElement.setAttribute('data-view', name);
    byId('view-home').hidden = name !== 'home';
    byId('view-doc').hidden = name !== 'doc';
  }

  function showHome() {
    navToken += 1;
    currentGuide = null;
    setView('home');
    disconnectToc();
    document.title = SITE_CONFIG.siteName + ' Docs';
    homeLauncher.render();
    window.scrollTo(0, 0);
  }

  function crumbs(g) {
    var nav = el('nav', 'crumbs');
    nav.setAttribute('aria-label', 'Breadcrumb');
    var home = el('a', null, 'docs');
    home.href = '#/';
    nav.appendChild(home);
    nav.appendChild(el('span', null, '/'));
    nav.appendChild(el('span', null, g ? g.catLabel.toLowerCase() : 'not found'));
    if (g) {
      nav.appendChild(el('span', null, '/'));
      var cur = el('span', null, g.label.toLowerCase());
      cur.setAttribute('aria-current', 'page');
      nav.appendChild(cur);
    }
    return nav;
  }

  function metaLine(item) {
    var parts = [];
    if (item.meta) { parts.push(String(item.meta)); }
    if (item.tags && item.tags.length) { parts.push(item.tags.join(', ')); }
    return parts.join(' - ');
  }

  function showDoc(g, anchor) {
    var token = ++navToken;
    currentGuide = g;
    setView('doc');
    markSidebar(g);
    disconnectToc();
    byId('toc-list').textContent = '';

    var doc = byId('doc');
    doc.textContent = '';
    doc.appendChild(crumbs(g));

    var h1 = el('h1', 'doc-title', g.label);
    h1.tabIndex = -1;
    doc.appendChild(h1);
    var meta = metaLine(g.item);
    if (meta) { doc.appendChild(el('p', 'doc-meta', meta)); }

    document.title = g.label + ' - ' + SITE_CONFIG.siteName + ' Docs';
    setEditLink(g);
    window.scrollTo(0, 0);

    if (!g.live) {
      var notice = el('div', 'doc-notice');
      notice.appendChild(el('p', null, 'This guide is not written yet.'));
      notice.appendChild(el('p', null, 'Pick another guide from the list, or press Ctrl K to search.'));
      doc.appendChild(notice);
      byId('toc').hidden = true;
      return;
    }

    byId('toc').hidden = false;
    var status = el('p', 'doc-status', 'Loading...');
    doc.appendChild(status);

    fetchDoc(g.file).then(function (raw) {
      if (token !== navToken) { return; }
      var body = renderMarkdown(raw);
      // A leading "# Title" in the Markdown replaces the config label as the page title.
      var first = body.firstElementChild;
      if (first && first.tagName === 'H1') {
        h1.textContent = first.textContent;
        body.removeChild(first);
      }
      status.remove();
      doc.appendChild(body);
      buildToc(body);
      if (anchor) { scrollToAnchor(anchor, false); }
    }).catch(function (err) {
      if (token !== navToken) { return; }
      console.error('[docs] Could not load', g.file, err);
      status.remove();
      var box = el('div', 'doc-error');
      box.appendChild(el('p', null, 'Could not load this guide. ' + (err && err.message ? err.message : '')));
      doc.appendChild(box);
    });
  }

  function showNotFound() {
    navToken += 1;
    currentGuide = null;
    setView('doc');
    markSidebar(null);
    disconnectToc();
    byId('toc').hidden = true;
    var doc = byId('doc');
    doc.textContent = '';
    doc.appendChild(crumbs(null));
    var h1 = el('h1', 'doc-title', 'Page not found');
    h1.tabIndex = -1;
    doc.appendChild(h1);
    var notice = el('div', 'doc-notice');
    notice.appendChild(el('p', null, 'That link does not match any guide.'));
    notice.appendChild(el('p', null, 'Pick a guide from the list, or press Ctrl K to search.'));
    doc.appendChild(notice);
    document.title = 'Not found - ' + SITE_CONFIG.siteName + ' Docs';
  }

  function setEditLink(g) {
    var link = byId('toc-edit');
    var repo = safeUrl(SITE_CONFIG.repoUrl);
    if (!repo || !g.file || repo.indexOf('https://github.com/') !== 0) {
      link.hidden = true;
      return;
    }
    link.href = repo.replace(/\/+$/, '') + '/blob/main/' + g.file.split('/').map(encodeURIComponent).join('/');
    link.hidden = false;
  }

  // -- ON THIS PAGE ------------------------------------------------------
  function disconnectToc() {
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
  }

  function buildToc(body) {
    var list = byId('toc-list');
    list.textContent = '';
    var heads = Array.prototype.slice.call(body.querySelectorAll('h2, h3'));
    if (heads.length < 2) {
      byId('toc-title').hidden = true;
      return;
    }
    byId('toc-title').hidden = false;
    var links = Object.create(null);
    heads.forEach(function (h) {
      var li = el('li');
      var a = el('a', 'toc-link' + (h.tagName === 'H3' ? ' is-sub' : ''), h.textContent.trim());
      a.href = '#/' + currentGuide.key + '/' + h.id;
      a.dataset.anchor = h.id;
      li.appendChild(a);
      list.appendChild(li);
      links[h.id] = a;
    });

    if (!('IntersectionObserver' in window)) { return; }
    var visible = Object.create(null);
    tocObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var activeId = null;
      for (var i = 0; i < heads.length; i += 1) {
        if (visible[heads[i].id]) { activeId = heads[i].id; break; }
      }
      if (!activeId) { return; }
      Object.keys(links).forEach(function (id) { links[id].classList.toggle('is-active', id === activeId); });
    }, { rootMargin: '-80px 0px -65% 0px' });
    heads.forEach(function (h) { tocObserver.observe(h); });
    links[heads[0].id].classList.add('is-active');
  }

  function scrollToAnchor(anchor, updateHash) {
    if (!ANCHOR_RE.test(anchor)) { return; }
    var target = byId(anchor);
    if (!target || !byId('doc').contains(target)) { return; }
    target.scrollIntoView({ block: 'start' });
    if (updateHash && currentGuide) {
      history.replaceState(null, '', '#/' + currentGuide.key + '/' + anchor);
    }
  }

  // -- ROUTER ------------------------------------------------------------
  function route() {
    var hash = location.hash || '';
    if (hash === '' || hash === '#' || hash === '#/') { showHome(); return; }
    if (hash.indexOf('#/') !== 0) {
      // Plain fragments (like the skip link) are not routes.
      if (!document.documentElement.getAttribute('data-view')) { showHome(); }
      return;
    }
    var parts = hash.slice(2).split('/').map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return ''; }
    });
    var key = (parts[0] || '') + '/' + (parts[1] || '');
    var g = ROUTES[key];
    if (!g) { showNotFound(); focusTitle(); return; }

    var anchor = parts[2] && ANCHOR_RE.test(parts[2]) ? parts[2] : null;
    if (currentGuide === g && document.documentElement.getAttribute('data-view') === 'doc') {
      if (anchor) { scrollToAnchor(anchor, false); }
      return;
    }
    showDoc(g, anchor);
    if (!anchor) { focusTitle(); }
  }

  var firstRoute = true;
  function focusTitle() {
    if (firstRoute) { return; } // do not steal focus on initial page load
    var h1 = document.querySelector('#doc .doc-title');
    if (h1) { h1.focus({ preventScroll: true }); }
  }

  // -- PALETTE -----------------------------------------------------------
  function openPalette() {
    var p = byId('palette');
    if (!p.hidden) { return; }
    lastFocus = document.activeElement;
    p.hidden = false;
    document.documentElement.classList.add('is-locked');
    paletteLauncher.clear();
    paletteLauncher.input.focus();
  }

  function closePalette() {
    var p = byId('palette');
    if (p.hidden) { return; }
    p.hidden = true;
    document.documentElement.classList.remove('is-locked');
    if (lastFocus && typeof lastFocus.focus === 'function') { lastFocus.focus(); }
  }

  // -- EVENTS ------------------------------------------------------------
  function bindEvents() {
    byId('theme-toggle').addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    });

    byId('jump-btn').addEventListener('click', openPalette);
    byId('palette-close').addEventListener('click', closePalette);
    byId('palette').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) { closePalette(); }
    });
    byId('palette').addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') { return; }
      // Keep focus inside the dialog: input <-> close button.
      var input = byId('palette-q');
      var close = byId('palette-close');
      if (e.shiftKey && document.activeElement === input) { e.preventDefault(); close.focus(); }
      else if (!e.shiftKey && document.activeElement === close) { e.preventDefault(); input.focus(); }
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (document.documentElement.getAttribute('data-view') === 'home') {
          homeLauncher.input.focus();
          homeLauncher.input.select();
        } else {
          openPalette();
        }
      } else if (e.key === 'Escape') {
        closePalette();
      }
    });

    // Copy buttons on code blocks (delegated, since docs render later).
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.code-copy') : null;
      if (!btn) { return; }
      var pre = btn.parentNode.querySelector('pre');
      if (!pre) { return; }
      copyText(pre.textContent.replace(/\n$/, '')).then(function () {
        btn.classList.add('is-copied');
        btn.setAttribute('aria-label', 'Copied');
        setTimeout(function () {
          btn.classList.remove('is-copied');
          btn.setAttribute('aria-label', 'Copy code');
        }, 1800);
      }).catch(function () { toast('Copy failed. Select the code and copy it manually.'); });
    });

    // In-page links: TOC entries and "#heading" links inside a guide.
    byId('view-doc').addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) { return; }
      var href = a.getAttribute('href');
      var anchor = null;
      if (a.dataset.anchor) {
        anchor = a.dataset.anchor;
      } else if (href.charAt(0) === '#' && href.charAt(1) !== '/' && byId('doc').contains(a)) {
        anchor = href.slice(1);
      }
      if (!anchor) { return; }
      e.preventDefault();
      scrollToAnchor(anchor, true);
    });

    byId('toc-copy').addEventListener('click', function () {
      copyText(location.href)
        .then(function () { toast('Link copied'); })
        .catch(function () { toast('Copy failed. Copy the address bar instead.'); });
    });

    window.addEventListener('hashchange', function () {
      closePalette();
      route();
    });
  }

  // -- INIT --------------------------------------------------------------
  function init() {
    if (typeof SITE_CONFIG === 'undefined' || typeof NAV === 'undefined') {
      console.error('[docs] config.js did not load.');
      return;
    }
    if (window.marked) { window.marked.use({ gfm: true, breaks: false }); }

    buildIndex();
    homeLauncher = createLauncher({ input: 'home-q', list: 'home-results', status: 'home-status', onPick: goTo });
    paletteLauncher = createLauncher({ input: 'palette-q', list: 'palette-results', status: 'palette-status', onPick: goTo });
    buildChrome();
    buildSidebar();
    applyTheme(currentTheme(), false);
    bindEvents();
    route();
    firstRoute = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
