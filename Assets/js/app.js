/* ============================================================
   APP.JS
   Handles: init, theme, sidebar, overview, search, navigation,
            social buttons, toast, keyboard shortcuts.

   Depends on: config.js  (SITE_CONFIG, NAV, PAGES)
               renderer.js (loadAndRenderPage, showPage, safeUrl,
                            buildRtoc, showErrorPage)
   ============================================================ */

'use strict';

/* ── SEARCH INDEX ─────────────────────────────────────────── */
const searchIndex = [];
NAV.forEach(cat => {
  cat.items.forEach((item, idx) => {
    searchIndex.push({
      title:    item.label,
      category: cat.label,
      icon:     item.icon,
      page:     item.page,
      groupId:  cat.id,
      itemIdx:  idx,
    });
  });
});


/* ── INIT ─────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nav-logo-icon').textContent = SITE_CONFIG.logoEmoji;
  document.getElementById('nav-site-name').textContent = SITE_CONFIG.siteName;
  document.getElementById('ov-title').textContent      = '👋 Welcome to ' + SITE_CONFIG.siteName + ' Docs';
  document.getElementById('ov-sub').textContent        = SITE_CONFIG.siteTagline;
  document.title = SITE_CONFIG.siteName + ' Docs';

  buildNavSocials();
  buildSidebarSocials();
  buildSidebar();
  buildOverviewCards();

  // NIST SP 800-53 SI-10: validate stored value against allowlist
  const THEME_ALLOWLIST = ['light', 'dark'];
  const saved = localStorage.getItem('theme');
  setTheme(THEME_ALLOWLIST.includes(saved) ? saved : 'light', true);

  wireEvents();
});

function wireEvents() {
  on('nav-logo',        'click',   showOverview);
  onKey('nav-logo',                showOverview);
  on('sb-overview-btn', 'click',   showOverview);
  onKey('sb-overview-btn',         showOverview);
  on('opt-light',       'click', () => setTheme('light'));
  on('opt-dark',        'click', () => setTheme('dark'));
  onKey('opt-light',             () => setTheme('light'));
  onKey('opt-dark',              () => setTheme('dark'));
  on('nav-search-btn',  'click',   openSearch);
  on('search-close-btn','click',   closeSearch);
  on('search-input',    'input',   runSearch);
  on('search-overlay',  'click', e => { if (e.target === e.currentTarget) closeSearch(); });
  on('rtoc-copy-btn',   'click',   copyPageUrl);
  on('wip-back-btn',    'click',   showOverview);
  onKey('wip-back-btn',            showOverview);
  on('error-back-btn',  'click',   showOverview);
  onKey('error-back-btn',          showOverview);

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape') closeSearch();
  });
}

function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}
function onKey(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); }
  });
}


/* ── THEME ────────────────────────────────────────────────── */
function setTheme(mode, skipSave) {
  if (mode !== 'light' && mode !== 'dark') mode = 'light';
  document.body.classList.toggle('dark', mode === 'dark');
  const optL = document.getElementById('opt-light');
  const optD = document.getElementById('opt-dark');
  optL.classList.toggle('active', mode === 'light');
  optD.classList.toggle('active', mode === 'dark');
  optL.setAttribute('aria-pressed', String(mode === 'light'));
  optD.setAttribute('aria-pressed', String(mode === 'dark'));
  if (!skipSave) localStorage.setItem('theme', mode);
}


/* ── SOCIAL BUTTONS ───────────────────────────────────────── */
function buildNavSocials() {
  const wrap = document.getElementById('nav-social');
  SITE_CONFIG.socials.forEach((s, i) => {
    const a = document.createElement('a');
    a.href           = safeUrl(s.url);
    a.target         = '_blank';
    a.rel            = 'noopener noreferrer';
    a.referrerPolicy = 'no-referrer';
    if (i === 0) {
      a.className   = 'nav-github-btn';
      a.textContent = s.icon + ' ' + s.label;
    } else {
      a.className   = 'nav-icon-btn';
      a.textContent = s.icon;
      a.setAttribute('aria-label', s.label);
    }
    wrap.appendChild(a);
  });
}

function buildSidebarSocials() {
  const wrap = document.getElementById('sb-social');
  SITE_CONFIG.socials.forEach(s => {
    const a = document.createElement('a');
    a.className      = 'sb-social-btn';
    a.href           = safeUrl(s.url);
    a.target         = '_blank';
    a.rel            = 'noopener noreferrer';
    a.referrerPolicy = 'no-referrer';
    a.textContent    = s.icon;
    a.setAttribute('aria-label', s.label);
    wrap.appendChild(a);
  });
}


/* ── SIDEBAR ──────────────────────────────────────────────── */
function buildSidebar() {
  const wrap = document.getElementById('sb-groups');
  NAV.forEach(cat => {
    const group = document.createElement('div');
    group.className = 'sb-group';
    group.id = 'grp-' + cat.id;

    const header = document.createElement('div');
    header.className = 'sb-group-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    const lbl = document.createElement('span');
    lbl.textContent = cat.icon + ' ' + cat.label;
    const chv = document.createElement('span');
    chv.className = 'sb-chevron';
    chv.setAttribute('aria-hidden', 'true');
    chv.textContent = '▶';

    header.appendChild(lbl);
    header.appendChild(chv);
    header.addEventListener('click', () => toggleGroup(group, header));
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') toggleGroup(group, header);
    });

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'sb-items';
    itemsWrap.id = 'items-' + cat.id;

    cat.items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'sb-item';
      el.id = 'sb-' + cat.id + '-' + idx;
      el.textContent = item.label;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.addEventListener('click', () => navigateTo(cat, item, el));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') navigateTo(cat, item, el);
      });
      itemsWrap.appendChild(el);
    });

    group.appendChild(header);
    group.appendChild(itemsWrap);
    wrap.appendChild(group);
  });
}


/* ── OVERVIEW CARDS ───────────────────────────────────────── */
function buildOverviewCards() {
  const wrap = document.getElementById('ov-cards');
  wrap.innerHTML = '';
  NAV.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'ov-card';
    card.setAttribute('role', 'listitem');

    const iconEl = document.createElement('div');
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
      const h = (function(c, it, i) {
        return function(e) {
          e.stopPropagation();
          navigateTo(c, it, document.getElementById('sb-' + c.id + '-' + i));
        };
      })(cat, item, idx);
      link.addEventListener('click', h);
      link.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') h(e); });
      topicsEl.appendChild(link);
    });

    card.appendChild(iconEl);
    card.appendChild(titleEl);
    card.appendChild(countEl);
    card.appendChild(topicsEl);
    card.addEventListener('click', () => {
      const grp = document.getElementById('grp-' + cat.id);
      if (grp) toggleGroup(grp, grp.querySelector('.sb-group-header'));
    });

    wrap.appendChild(card);
  });
}


/* ── NAVIGATION ───────────────────────────────────────────── */
function toggleGroup(groupEl, headerEl) {
  if (!groupEl) return;
  const isOpen = groupEl.classList.toggle('open');
  if (headerEl) headerEl.setAttribute('aria-expanded', String(isOpen));
}

window.showOverview = function() {
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  buildOverviewCards();
  showPage('page-overview');
  buildRtoc(
    [{ label: 'Browse Categories', level: 2 }, { label: 'All Topics', level: 2 }],
    null
  );
  document.getElementById('rtoc-github').href = safeUrl(SITE_CONFIG.socials[0].url);
};

function navigateTo(cat, item, el) {
  const grp = document.getElementById('grp-' + cat.id);
  if (grp && !grp.classList.contains('open')) {
    toggleGroup(grp, grp.querySelector('.sb-group-header'));
  }
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');

  if (!item.page) {
    showPage('page-wip');
    buildRtoc([], null);
    return;
  }
  const pageData = PAGES[item.page];
  if (!pageData) {
    showPage('page-wip');
    buildRtoc([], null);
    return;
  }
  loadAndRenderPage(item.page, pageData);
}


/* ── SEARCH ───────────────────────────────────────────────── */
function openSearch() {
  document.getElementById('search-overlay').classList.add('open');
  setTimeout(() => document.getElementById('search-input').focus(), 50);
}

function closeSearch() {
  document.getElementById('search-overlay').classList.remove('open');
  document.getElementById('search-input').value = '';
  const wrap = document.getElementById('search-results');
  wrap.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'search-empty';
  empty.textContent = 'Start typing to search all docs...';
  wrap.appendChild(empty);
}

function runSearch() {
  const raw = document.getElementById('search-input').value.slice(0, 100);
  const q   = raw.toLowerCase().trim();
  const wrap = document.getElementById('search-results');
  wrap.innerHTML = '';

  if (!q) {
    const e = document.createElement('div');
    e.className = 'search-empty';
    e.textContent = 'Start typing to search all docs...';
    wrap.appendChild(e);
    return;
  }

  const matches = searchIndex.filter(r =>
    r.title.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
  );

  if (!matches.length) {
    const e = document.createElement('div');
    e.className = 'search-empty';
    e.textContent = 'No results found for "' + raw + '"';
    wrap.appendChild(e);
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

    const metaEl  = document.createElement('div');
    metaEl.className  = 'search-result-meta';
    metaEl.textContent = r.category;

    const badgeEl = document.createElement('div');
    badgeEl.className  = 'search-result-badge';
    badgeEl.textContent = r.page ? '✅ Page available' : '🚧 Coming soon';
    if (!r.page) badgeEl.style.color = 'var(--muted)';

    infoEl.appendChild(titleEl);
    infoEl.appendChild(metaEl);
    infoEl.appendChild(badgeEl);
    row.appendChild(iconEl);
    row.appendChild(infoEl);

    const handler = (function(result) {
      return () => searchNavigate(result);
    })(r);
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
    wrap.appendChild(row);
  });
}

function highlightText(container, text, query) {
  if (!query) { container.textContent = text; return; }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(' + escaped + ')', 'gi');
  text.split(re).forEach(part => {
    if (re.test(part)) {
      const mark = document.createElement('mark');
      mark.textContent = part;
      container.appendChild(mark);
    } else {
      container.appendChild(document.createTextNode(part));
    }
    re.lastIndex = 0;
  });
}

function searchNavigate(result) {
  closeSearch();
  const cat  = NAV.find(c => c.id === result.groupId);
  const item = cat ? cat.items[result.itemIdx] : null;
  const sbEl = document.getElementById('sb-' + result.groupId + '-' + result.itemIdx);
  if (cat && item) navigateTo(cat, item, sbEl);
}


/* ── UTILITIES ────────────────────────────────────────────── */
window.showToast = function(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
};

function copyPageUrl() {
  navigator.clipboard.writeText(window.location.href)
    .then(() => showToast('🔗 Link copied!'))
    .catch(() => showToast('Copy failed — copy the URL from the address bar.'));
}
