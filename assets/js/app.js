'use strict';

/**
 * ============================================================
 *  Shad3ious Docs — Application Engine
 *
 *  Security (NIST SP 800-53 / OWASP):
 *  - All user text written via textContent only (XSS prevention)
 *  - Markdown pipeline: raw text → marked → DOMPurify → hardenLinks → DOM
 *  - All external URLs validated (https:// only, SI-10)
 *  - localStorage values checked against allowlist before use (SI-10)
 *  - Regex input escaped before use (ReDoS prevention)
 *  - Search input capped at 100 chars
 *  - No eval(), Function(), document.write(), or inline handlers
 * ============================================================
 */


// ── CONSTANTS ─────────────────────────────────────────────────
const THEME_ALLOWLIST = Object.freeze(['light', 'dark']);

const DOMPURIFY_CONFIG = Object.freeze({
  ALLOWED_TAGS: [
    'h1','h2','h3','h4','h5','h6',
    'p','br','hr',
    'ul','ol','li',
    'strong','em','b','i','s','del','ins','mark','small',
    'a','pre','code','blockquote',
    'table','thead','tbody','tfoot','tr','th','td',
    'div','span','details','summary','img',
  ],
  ALLOWED_ATTR: ['href','id','class','src','alt','width','height','title','colspan','rowspan'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script','style','iframe','form','input','button','select','textarea','object','embed','svg'],
  FORBID_ATTR: ['onerror','onload','onclick','onmouseover','style','xmlns'],
});

// ── SECURITY HELPERS ──────────────────────────────────────────

/** Only accept https:// URLs. Blocks javascript:, data:, http:// */
function safeUrl(url) {
  if (typeof url !== 'string') return '#';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : '#';
  } catch { return '#'; }
}

/** Escape special regex characters to prevent ReDoS attacks */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escape HTML entities for safe insertion into code blocks */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** DOM-based toast notification — replaces alert() */
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── MARKDOWN ENGINE ───────────────────────────────────────────

function configureMarked() {
  if (!window.marked) return;
  // Set options only — no custom renderers.
  // Post-processing handles heading IDs, copy buttons, and callouts
  // after sanitization so we never fight marked's internal token API.
  window.marked.use({ gfm: true, breaks: false });
}

/**
 * Markdown pipeline:
 * raw text → marked.parse → DOMPurify.sanitize → postProcess → hardenLinks
 *
 * innerHTML is only assigned sanitized content. The postProcess step
 * uses DOM methods exclusively — no string concatenation with user data.
 */
function renderMarkdown(rawText) {
  if (!window.marked) {
    console.error('[Shad3ious Docs] marked.js not loaded');
    return '<p class="doc-error">Markdown parser unavailable — check your connection.</p>';
  }
  if (!window.DOMPurify) {
    console.error('[Shad3ious Docs] DOMPurify not loaded');
    return '<p class="doc-error">Content sanitizer unavailable — check your connection.</p>';
  }

  let rawHtml;
  try {
    rawHtml = typeof window.marked.parse === 'function'
      ? window.marked.parse(rawText)
      : window.marked(rawText);
  } catch (err) {
    console.error('[Shad3ious Docs] marked parse error:', err);
    return '<p class="doc-error">Parse error: ' + escapeHtml(err.message) + '</p>';
  }

  let cleanHtml;
  try {
    cleanHtml = window.DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
  } catch (err) {
    console.error('[Shad3ious Docs] DOMPurify error:', err);
    return '<p class="doc-error">Sanitize error: ' + escapeHtml(err.message) + '</p>';
  }

  const tmp = document.createElement('div');
  tmp.innerHTML = cleanHtml;
  postProcess(tmp);
  hardenLinks(tmp);
  return tmp.innerHTML;
}

/**
 * DOM post-processing after sanitization.
 * Adds heading IDs, wraps code blocks with a Copy button,
 * styles inline code, and turns blockquotes into callout boxes.
 * All done with DOM methods — no innerHTML with dynamic data.
 */
function postProcess(container) {
  // Add anchor IDs to all headings for TOC scroll linking
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
    const id = 'h-' + (h.textContent || '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60);
    h.id = id || ('h-' + h.tagName);
  });

  // Wrap <pre><code> blocks with a copy button
  container.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');

    // Add doc-code class for styling
    pre.classList.add('doc-code');

    // Carry language class from code → pre (e.g. language-bash → lang-bash)
    if (code) {
      Array.from(code.classList).forEach(cls => {
        if (cls.startsWith('language-')) {
          pre.classList.add('lang-' + cls.replace('language-', ''));
        }
      });
    }

    // Wrap in doc-code-wrap and prepend the Copy button
    const wrap = document.createElement('div');
    wrap.className = 'doc-code-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    const btn = document.createElement('button');
    btn.className = 'doc-code-copy';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Copy code');
    btn.textContent = 'Copy';
    wrap.insertBefore(btn, pre);
  });

  // Style inline code (not inside pre blocks)
  container.querySelectorAll('code').forEach(code => {
    if (!code.closest('pre')) {
      code.classList.add('doc-inline-code');
    }
  });

  // Turn blockquotes into callout boxes based on content
  container.querySelectorAll('blockquote').forEach(bq => {
    const t = bq.textContent || '';
    const isWarn = /⚠️|warning|warn|danger/i.test(t);
    const isTip  = /💡|tip|note|info/i.test(t);
    bq.className = isWarn ? 'callout warn' : isTip ? 'callout tip' : 'doc-blockquote';
  });
}

/** Post-sanitization: harden all external links */
function hardenLinks(container) {
  container.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    // Same-origin links are fine as-is
    if (href.startsWith('#') || href.startsWith('/') ||
        href.startsWith('./') || href.startsWith('../')) return;
    // External: validate protocol and add security attributes
    a.setAttribute('href', safeUrl(href));
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('referrerpolicy', 'no-referrer');
  });
}

/** Extract h2/h3 headings from rendered content for the right-hand TOC */
function extractToc(container) {
  return Array.from(container.querySelectorAll('h2, h3')).map(h => ({
    label: h.textContent.trim(),
    id:    h.id,
    level: parseInt(h.tagName[1], 10),
  }));
}

// ── SEARCH INDEX ──────────────────────────────────────────────
// Built once at startup from config — no runtime mutation
const searchIndex = [];
NAV.forEach(cat => {
  cat.items.forEach((item, idx) => {
    searchIndex.push({
      title:   item.label,
      category: cat.label,
      icon:    item.icon,
      file:    item.file,
      groupId: cat.id,
      itemIdx: idx,
      catRef:  cat,
      itemRef: item,
    });
  });
});

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  configureMarked();
  applyConfig();
  buildNavSocials();
  buildSidebarSocials();
  buildSidebar();
  buildOverviewCards();
  restoreTheme();
  bindEvents();
});

function applyConfig() {
  const g = id => document.getElementById(id);
  if (g('nav-logo-icon')) g('nav-logo-icon').textContent = SITE_CONFIG.logoEmoji;
  if (g('nav-site-name')) g('nav-site-name').textContent = SITE_CONFIG.siteName;
  if (g('ov-title'))      g('ov-title').textContent      = '👋 Welcome to ' + SITE_CONFIG.siteName + ' Docs';
  if (g('ov-sub'))        g('ov-sub').textContent        = SITE_CONFIG.siteTagline;
  document.title = SITE_CONFIG.siteName + ' Docs';
}

// ── THEME ─────────────────────────────────────────────────────
function restoreTheme() {
  const saved = localStorage.getItem('theme');
  // Validate against allowlist before trusting stored value (NIST SI-10)
  applyTheme(THEME_ALLOWLIST.includes(saved) ? saved : 'dark', true);
}

function applyTheme(mode, skipSave) {
  if (!THEME_ALLOWLIST.includes(mode)) mode = 'dark';
  document.body.classList.toggle('dark', mode === 'dark');
  ['light', 'dark'].forEach(m => {
    const el = document.getElementById('opt-' + m);
    if (!el) return;
    el.classList.toggle('active', mode === m);
    el.setAttribute('aria-pressed', String(mode === m));
  });
  if (!skipSave) localStorage.setItem('theme', mode);
}

// ── SOCIAL BUTTONS ────────────────────────────────────────────
function buildNavSocials() {
  const wrap = document.getElementById('nav-social');
  if (!wrap) return;
  SITE_CONFIG.socials.forEach((s, i) => {
    const a = document.createElement('a');
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    a.href = safeUrl(s.url);
    a.title = s.label;
    a.referrerPolicy = 'no-referrer';
    if (i === 0) {
      a.className = 'nav-github-btn';
      a.textContent = s.icon + ' ' + s.label;
    } else {
      a.className = 'nav-icon-btn';
      a.textContent = s.icon;
      a.setAttribute('aria-label', s.label);
    }
    wrap.appendChild(a);
  });
}

function buildSidebarSocials() {
  const wrap = document.getElementById('sb-social');
  if (!wrap) return;
  SITE_CONFIG.socials.forEach(s => {
    const a = document.createElement('a');
    a.className = 'sb-social-btn';
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    a.href = safeUrl(s.url);
    a.title = s.label;
    a.referrerPolicy = 'no-referrer';
    a.textContent = s.icon;
    a.setAttribute('aria-label', s.label);
    wrap.appendChild(a);
  });
}

// ── SIDEBAR ───────────────────────────────────────────────────
// Built entirely with DOM methods — no innerHTML with dynamic data
function buildSidebar() {
  const wrap = document.getElementById('sb-groups');
  if (!wrap) return;

  NAV.forEach(cat => {
    const group = document.createElement('div');
    group.className = 'sb-group';
    group.id = 'grp-' + cat.id;
    group.setAttribute('role', 'treeitem');
    group.setAttribute('aria-expanded', 'false');

    const header = document.createElement('div');
    header.className = 'sb-group-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-label', cat.label + ' section');

    const txt = document.createElement('span');
    txt.textContent = cat.icon + ' ' + cat.label;
    const chv = document.createElement('span');
    chv.className = 'sb-chevron';
    chv.setAttribute('aria-hidden', 'true');
    chv.textContent = '▶';

    header.appendChild(txt);
    header.appendChild(chv);
    header.addEventListener('click', () => toggleGroup(group));
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(group); }
    });

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'sb-items';
    itemsWrap.setAttribute('role', 'group');

    cat.items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'sb-item';
      el.id = 'sb-' + cat.id + '-' + idx;
      el.textContent = item.label;
      el.setAttribute('role', 'treeitem');
      el.setAttribute('tabindex', '0');
      el.addEventListener('click',   () => navigateTo(cat, item, el));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo(cat, item, el); }
      });
      itemsWrap.appendChild(el);
    });

    group.appendChild(header);
    group.appendChild(itemsWrap);
    wrap.appendChild(group);
  });
}

// ── OVERVIEW CARDS ────────────────────────────────────────────
function buildOverviewCards() {
  const wrap = document.getElementById('ov-cards');
  if (!wrap) return;
  wrap.innerHTML = '';

  NAV.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'ov-card';
    card.setAttribute('role', 'listitem');

    const iconEl  = document.createElement('div');
    iconEl.className = 'ov-card-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = cat.icon;

    const titleEl = document.createElement('div');
    titleEl.className = 'ov-card-title';
    titleEl.textContent = cat.label;

    const countEl = document.createElement('div');
    countEl.className = 'ov-card-count';
    countEl.textContent = cat.items.length + ' guide' + (cat.items.length !== 1 ? 's' : '');

    const topicsEl = document.createElement('div');
    topicsEl.className = 'ov-card-topics';

    cat.items.forEach((item, idx) => {
      const link = document.createElement('div');
      link.className = 'ov-topic-link';
      link.textContent = item.label;
      link.setAttribute('role', 'button');
      link.setAttribute('tabindex', '0');
      const go = () => {
        const sbEl = document.getElementById('sb-' + cat.id + '-' + idx);
        navigateTo(cat, item, sbEl);
      };
      link.addEventListener('click', e => { e.stopPropagation(); go(); });
      link.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(); }
      });
      topicsEl.appendChild(link);
    });

    card.append(iconEl, titleEl, countEl, topicsEl);
    card.addEventListener('click', () => {
      const g = document.getElementById('grp-' + cat.id);
      if (g) toggleGroup(g);
    });
    wrap.appendChild(card);
  });
}

// ── NAVIGATION ────────────────────────────────────────────────
function toggleGroup(groupEl) {
  if (!groupEl) return;
  groupEl.classList.toggle('open');
  groupEl.setAttribute('aria-expanded', String(groupEl.classList.contains('open')));
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

function showOverview() {
  showPage('page-overview');
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  buildOverviewCards();
  buildRtoc([], null);
  const gh = document.getElementById('rtoc-github');
  if (gh) gh.href = safeUrl(SITE_CONFIG.socials[0].url);
}

function navigateTo(cat, item, sbEl) {
  const grp = document.getElementById('grp-' + cat.id);
  if (grp && !grp.classList.contains('open')) toggleGroup(grp);

  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  if (sbEl) sbEl.classList.add('active');

  if (!item.file) {
    showPage('page-wip');
    buildRtoc([], null);
    return;
  }

  loadDocPage(cat, item);
}

// ── DYNAMIC MARKDOWN LOADING ──────────────────────────────────
async function loadDocPage(cat, item) {
  showPage('page-loading');
  buildRtoc([], null);

  let rawText;
  try {
    // 8 second timeout — prevents infinite loading spinner if fetch hangs
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    let res;
    try {
      res = await fetch(item.file, {
        method: 'GET',
        headers: { 'Accept': 'text/plain, text/markdown' },
        // no-cache: always revalidate with server (uses 304 if unchanged).
        // Prevents stale markdown content without hammering bandwidth.
        cache: 'no-cache',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error('HTTP ' + res.status + ' — file not found or server error.');

    // GitHub Pages can return text/plain or text/html for .md files.
    // We accept any text/* content type and validate the content itself.
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('text/') && !ct.includes('markdown') && !ct.includes('octet-stream')) {
      throw new Error('Unexpected content type: ' + ct.split(';')[0]);
    }

    rawText = await res.text();

    // If GitHub served an HTML 404 page instead of the file, catch it here
    if (rawText.trim().startsWith('<!DOCTYPE') || rawText.trim().startsWith('<html')) {
      throw new Error('File not found — check the path in config.js matches the file location exactly.');
    }

  } catch (err) {
    console.error('[Shad3ious Docs] Failed to load:', item.file, err);
    const msg = document.getElementById('error-msg');
    if (msg) {
      msg.textContent = err.name === 'AbortError'
        ? 'Request timed out loading "' + item.label + '". Check your connection and try again.'
        : 'Could not load "' + item.label + '". ' + err.message;
    }
    showPage('page-error');
    return;
  }

  try {
    renderDocPage(cat, item, rawText);
  } catch (err) {
    console.error('[Shad3ious Docs] renderDocPage failed:', err);
    const msg = document.getElementById('error-msg');
    if (msg) msg.textContent = 'Failed to render "' + item.label + '". ' + err.message;
    showPage('page-error');
  }
}

function renderDocPage(cat, item, rawMarkdown) {
  const docPage = document.getElementById('page-doc');
  if (!docPage) return;
  docPage.innerHTML = '';

  // Breadcrumb — DOM only, textContent only
  const bc = document.createElement('nav');
  bc.className = 'doc-breadcrumb';
  bc.setAttribute('aria-label', 'Breadcrumb');

  const crumbBtn = (text, fn) => {
    const s = document.createElement('span');
    s.className = 'doc-breadcrumb-item';
    s.textContent = text;
    if (fn) s.addEventListener('click', fn);
    return s;
  };
  const sep = () => {
    const s = document.createElement('span');
    s.className = 'doc-breadcrumb-sep';
    s.textContent = ' › ';
    s.setAttribute('aria-hidden', 'true');
    return s;
  };
  const cur = document.createElement('span');
  cur.className = 'doc-breadcrumb-cur';
  cur.textContent = item.label;
  cur.setAttribute('aria-current', 'page');

  bc.append(crumbBtn('Home', showOverview), sep(), crumbBtn(cat.label), sep(), cur);

  // Title
  const h1 = document.createElement('h1');
  h1.className = 'doc-title';
  h1.textContent = item.label;

  // Meta line
  const metaEl = document.createElement('div');
  metaEl.className = 'doc-meta';
  if (item.meta) metaEl.textContent = item.meta;

  // Tags
  const tagsWrap = document.createElement('div');
  tagsWrap.className = 'doc-tags';
  (item.tags || []).forEach(t => {
    const tag = document.createElement('span');
    tag.className = 'doc-tag';
    tag.textContent = t;
    tagsWrap.appendChild(tag);
  });

  // Markdown body — only place external data touches innerHTML,
  // protected by the full marked → DOMPurify → hardenLinks pipeline
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'doc-body';
  bodyWrap.innerHTML = renderMarkdown(rawMarkdown);

  docPage.appendChild(bc);
  docPage.appendChild(h1);
  if (item.meta) docPage.appendChild(metaEl);
  if (item.tags && item.tags.length) docPage.appendChild(tagsWrap);
  docPage.appendChild(bodyWrap);

  showPage('page-doc');

  // Auto-generate right-hand TOC from rendered headings
  const tocItems = extractToc(bodyWrap);
  const ghBase = safeUrl(SITE_CONFIG.socials[0].url);
  const ghPath = ghBase !== '#'
    ? ghBase + '/blob/main/' + encodeURIComponent(item.file)
    : '#';
  buildRtoc(tocItems, ghPath);

  // Scroll content area back to top
  const content = document.getElementById('content');
  if (content) content.scrollTop = 0;
}

// ── RIGHT TOC ──────────────────────────────────────────────────
function buildRtoc(items, githubPath) {
  const wrap = document.getElementById('rtoc-items');
  if (!wrap) return;
  wrap.innerHTML = '';

  items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'rtoc-item' + (i === 0 ? ' active' : '');
    el.setAttribute('role', 'listitem');
    if (item.level === 3) el.classList.add('rtoc-sub');
    el.textContent = item.label;

    if (item.id) {
      el.addEventListener('click', () => {
        const target = document.getElementById(item.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        wrap.querySelectorAll('.rtoc-item').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
      });
    }
    wrap.appendChild(el);
  });

  const gh = document.getElementById('rtoc-github');
  if (gh) gh.href = githubPath || safeUrl(SITE_CONFIG.socials[0].url);
}

// ── SEARCH ─────────────────────────────────────────────────────
function openSearch() {
  const overlay = document.getElementById('search-overlay');
  if (overlay) overlay.classList.add('open');
  setTimeout(() => document.getElementById('search-input')?.focus(), 50);
}

function closeSearch() {
  const overlay = document.getElementById('search-overlay');
  if (overlay) overlay.classList.remove('open');
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  resetSearchResults();
}

function resetSearchResults() {
  const wrap = document.getElementById('search-results');
  if (!wrap) return;
  wrap.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'search-empty';
  empty.textContent = 'Start typing to search all docs...';
  wrap.appendChild(empty);
}

function runSearch() {
  const raw = (document.getElementById('search-input')?.value || '').slice(0, 100);
  const q   = raw.toLowerCase().trim();
  const wrap = document.getElementById('search-results');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!q) { resetSearchResults(); return; }

  const matches = searchIndex.filter(r =>
    r.title.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
  );

  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'No results for "' + raw + '"';
    wrap.appendChild(empty);
    return;
  }

  matches.forEach(r => {
    const row = document.createElement('div');
    row.className = 'search-result';
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '0');

    const iconEl  = document.createElement('div');
    iconEl.className = 'search-result-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = r.icon;

    const infoEl  = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'search-result-title';
    highlightText(titleEl, r.title, q);

    const metaEl = document.createElement('div');
    metaEl.className = 'search-result-meta';
    metaEl.textContent = r.category;

    const badgeEl = document.createElement('div');
    badgeEl.className = 'search-result-badge' + (r.file ? '' : ' badge-wip');
    badgeEl.textContent = r.file ? '✅ Available' : '🚧 Coming soon';

    infoEl.append(titleEl, metaEl, badgeEl);
    row.append(iconEl, infoEl);

    const go = () => {
      closeSearch();
      const sbEl = document.getElementById('sb-' + r.groupId + '-' + r.itemIdx);
      navigateTo(r.catRef, r.itemRef, sbEl);
    };
    row.addEventListener('click', go);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });

    wrap.appendChild(row);
  });
}

/** Safe text highlight using DOM nodes and <mark> — never innerHTML */
function highlightText(container, text, query) {
  if (!query) { container.textContent = text; return; }
  const re = new RegExp('(' + escapeRegex(query) + ')', 'gi');
  text.split(re).forEach(part => {
    if (re.test(part)) {
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = part;
      container.appendChild(mark);
    } else {
      container.appendChild(document.createTextNode(part));
    }
    re.lastIndex = 0;
  });
}

// ── CODE BLOCK COPY ───────────────────────────────────────────
// Event delegation on document — handles dynamically rendered code blocks
document.addEventListener('click', e => {
  if (!e.target?.classList.contains('doc-code-copy')) return;
  const pre = e.target.closest('.doc-code-wrap')?.querySelector('pre');
  if (!pre) return;
  navigator.clipboard.writeText(pre.innerText.trim())
    .then(() => {
      e.target.textContent = '✓ Copied';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
    })
    .catch(() => showToast('Copy failed — please copy manually.'));
});

// ── EVENT BINDING ─────────────────────────────────────────────
function bindEvents() {
  // Helper: bind click + Enter/Space keydown to the same handler
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  };

  bind('nav-logo',        showOverview);
  bind('sb-overview-btn', showOverview);
  bind('wip-back-btn',    showOverview);
  bind('error-back-btn',  showOverview);

  document.getElementById('opt-light')?.addEventListener('click',   () => applyTheme('light'));
  document.getElementById('opt-dark')?.addEventListener('click',    () => applyTheme('dark'));
  document.getElementById('opt-light')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyTheme('light'); }
  });
  document.getElementById('opt-dark')?.addEventListener('keydown',  e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyTheme('dark'); }
  });

  document.getElementById('nav-search-btn')?.addEventListener('click', openSearch);
  document.getElementById('search-close-btn')?.addEventListener('click', closeSearch);
  document.getElementById('search-input')?.addEventListener('input', runSearch);
  document.getElementById('search-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSearch();
  });

  document.getElementById('rtoc-copy-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => showToast('🔗 Link copied!'))
      .catch(() => showToast('Copy failed — please copy the URL manually.'));
  });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape') closeSearch();
  });
}