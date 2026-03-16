/* ============================================================
   CONFIG.JS — THE ONLY FILE YOU NEED TO EDIT
   ============================================================
   This file controls everything:
     - Site name, tagline, logo
     - Social links
     - Sidebar categories and pages
     - Page metadata (title, tags, which .md file to load)

   The three sections are:
     SITE_CONFIG  — branding and social links
     NAV          — sidebar categories and page entries
     PAGES        — metadata for each written page

   You never need to touch index.html, app.js, or renderer.js
   for routine content management.
   ============================================================ */

'use strict';

/* ── SITE SETTINGS ──────────────────────────────────────────
   Paste your real URLs in the socials array.
   Only https:// URLs are accepted — anything else is blocked.
   The FIRST social entry is always the main GitHub button.
   ──────────────────────────────────────────────────────────── */
const SITE_CONFIG = {
  siteName:   'Shad3ious',
  siteTagline: 'Technical guides, runbooks, and how-tos for Windows, Homelab, Networking, and more.',
  logoEmoji:  '⚙️',

  socials: [
    { icon: '🐙', label: 'GitHub',   url: 'https://github.com/Shad3ious' },
    { icon: '💼', label: 'LinkedIn', url: 'https://linkedin.com/in/yourprofile' },
    { icon: '🐦', label: 'Twitter',  url: 'https://twitter.com/yourhandle'     },
    { icon: '🤖', label: 'Reddit',   url: 'https://reddit.com/u/yourhandle'    },
  ],
};


/* ── NAVIGATION ─────────────────────────────────────────────
   Each category has:
     id     — internal identifier, lowercase no spaces
     label  — display name
     icon   — emoji
     items  — array of pages in this category

   Each page item has:
     label  — display name in sidebar
     icon   — emoji
     page   — ID that matches a key in PAGES below,
               OR null to show "Coming Soon"

   To add a page:
     1. Add { label, icon, page: 'your-id' } to items
     2. Add a matching entry to PAGES below
     3. Create the .md file at the path you specify in PAGES

   To temporarily hide a page without deleting it:
     Set page: null — it shows "Coming Soon"
   ──────────────────────────────────────────────────────────── */
const NAV = [
  {
    id: 'windows', label: 'Windows', icon: '🪟',
    items: [
      { label: 'Active Directory',   icon: '📁', page: 'active-directory' },
      { label: 'Domain Controllers', icon: '🖥️', page: null              },
      { label: 'Exchange',           icon: '📧', page: null              },
      { label: 'WSUS',               icon: '🔄', page: null              },
      { label: 'Chocolatey',         icon: '🍫', page: null              },
      { label: 'Imaging',            icon: '💿', page: null              },
      { label: 'Hyper-V',            icon: '⚡', page: null              },
    ],
  },
  {
    id: 'homelab', label: 'Homelab', icon: '🏠',
    items: [
      { label: 'Proxmox',    icon: '🖥️', page: null },
      { label: 'Docker',     icon: '🐳', page: null },
      { label: 'pfSense',    icon: '🔥', page: null },
      { label: 'Monitoring', icon: '📊', page: null },
    ],
  },
  {
    id: 'networking', label: 'Networking', icon: '🔧',
    items: [
      { label: 'VLANs',      icon: '🔀', page: null },
      { label: 'DNS & DHCP', icon: '🌐', page: null },
      { label: 'VPN Setup',  icon: '🔒', page: null },
    ],
  },
  {
    id: 'scripts', label: 'Scripts', icon: '📜',
    items: [
      { label: 'PowerShell', icon: '💙', page: 'powershell-basics' },
      { label: 'Bash',       icon: '🟩', page: null                },
    ],
  },
];


/* ── PAGES ──────────────────────────────────────────────────
   Each key must match the `page` value in NAV above.

   Fields:
     title       — H1 shown at top of the page
     category    — breadcrumb trail (use › as separator)
     meta        — date/read time/author line under the title
     tags        — array of tag strings
     markdownPath— path to the .md file, relative to repo root
     githubPath  — same path, used to build the "View on GitHub" link
     toc         — OPTIONAL: if omitted, headings are auto-extracted
                   from the markdown file. Provide manually only if
                   you want a custom TOC order.

   Example of adding a new page:
   ─────────────────────────────
   'my-new-page': {
     title:        'My New Page Title',
     category:     'Windows › Active Directory',
     meta:         '📅 April 2026 · ⏱ 5 min read · ✏️ Shad3ious',
     tags:         ['Active Directory', 'PowerShell'],
     markdownPath: 'docs/windows/my-new-page.md',
     githubPath:   'docs/windows/my-new-page.md',
   },
   ──────────────────────────────────────────────────────────── */
const PAGES = {

  'active-directory': {
    title:        'Active Directory Setup',
    category:     'Windows › Active Directory',
    meta:         '📅 March 2026 · ⏱ 10 min read · ✏️ Shad3ious',
    tags:         ['Active Directory', 'Windows Server', 'Runbook'],
    markdownPath: 'docs/windows/active-directory.md',
    githubPath:   'docs/windows/active-directory.md',
  },

  'powershell-basics': {
    title:        'PowerShell Basics & Snippets',
    category:     'Scripts › PowerShell',
    meta:         '📅 March 2026 · ⏱ 7 min read · ✏️ Shad3ious',
    tags:         ['PowerShell', 'Scripting', 'Reference'],
    markdownPath: 'docs/scripts/powershell-basics.md',
    githubPath:   'docs/scripts/powershell-basics.md',
  },

  // ── Add more pages here following the pattern above ──────

};
