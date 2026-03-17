/**
 * ============================================================
 *  Shad3ious Docs — Site Configuration
 *  This is the ONLY file you need to edit for content changes.
 * ============================================================
 *
 *  HOW TO ADD A PAGE
 *  -----------------
 *  1. Write your guide as a .md file and drop it in docs/
 *     e.g. docs/windows/wsus-setup.md
 *
 *  2. Add one line to the right category's items array:
 *     { label: 'WSUS Setup', icon: '🔄', file: 'docs/windows/wsus-setup.md' }
 *
 *  3. Push to GitHub. Done. The page shows up automatically.
 *
 *  Set file: null for pages not ready yet — shows "Coming Soon".
 *
 *  HOW TO ADD A CATEGORY
 *  ---------------------
 *  Copy any existing category block, change id/label/icon/items.
 *  id must be unique, lowercase, no spaces or special characters.
 *
 *  HOW TO REORDER
 *  --------------
 *  Cut and paste category blocks — order here = order on site.
 * ============================================================
 */

// ── SITE SETTINGS ────────────────────────────────────────────
const SITE_CONFIG = {
  siteName:    'Shad3ious',
  siteTagline: 'Technical guides, runbooks, and how-tos for Windows, Homelab, Networking, and more.',
  logoEmoji:   '⚙️',

  // First entry = the labelled GitHub button in the top nav.
  // All others = icon-only buttons.
  // Only https:// URLs are accepted — anything else is blocked.
  socials: [
    { icon: '🐙', label: 'GitHub',   url: 'https://github.com/Shad3ious' },
    { icon: '🐦', label: 'Twitter',  url: 'https://twitter.com/Shad3ious' },
    { icon: '🤖', label: 'Reddit',   url: 'https://reddit.com/u/Shad3ious' },
    { icon: '🖥️', label: 'Youtube',   url: 'https://www.youtube.com/@shad3ious' },
  ],
};

// ── NAVIGATION ───────────────────────────────────────────────
// Each category = one accordion group in the sidebar
//              + one card on the Overview page.
//
// Item fields:
//   label  — display name in sidebar and search results
//   icon   — emoji next to the label
//   file   — path to your .md file relative to the repo root
//            must match the actual file location exactly (case-sensitive)
//   tags   — optional: pill badges shown on the doc page
//   meta   — optional: date / read time shown under the title
const NAV = [
  {
    id:    'windows',
    label: 'Windows',
    icon:  '🪟',
    items: [
      { label: 'Active Directory',   icon: '📁', file: null },
      { label: 'Domain Controllers', icon: '🖥️', file: null },
      {
        label: 'Example (Exchange)',
        icon:  '📧',
        file:  null,
        tags:  ['Exchange', 'PowerShell', 'Runbook'],
        meta:  '📅 March 2026 · ⏱ 5 min read',
      },
      { label: 'WSUS',       icon: '🔄', file: null },
      { label: 'Chocolatey', icon: '🍫', file: null },
      { label: 'Imaging',    icon: '💿', file: null },
      { label: 'Hyper-V',   icon: '⚡', file: null },
    ],
  },

  {
    id:    'homelab',
    label: 'Homelab',
    icon:  '🏠',
    items: [
      { label: 'Proxmox',    icon: '🖥️', file: null },
      { label: 'Docker',     icon: '🐳', file: null },
      { label: 'pfSense',    icon: '🔥', file: null },
      { label: 'Monitoring', icon: '📊', file: null },
    ],
  },

  {
    id:    'networking',
    label: 'Networking',
    icon:  '🔧',
    items: [
      { label: 'VLANs',      icon: '🔀', file: null },
      { label: 'DNS & DHCP', icon: '🌐', file: null },
      { label: 'VPN Setup',  icon: '🔒', file: null },
    ],
  },

  {
    id:    'scripts',
    label: 'Scripts',
    icon:  '📜',
    items: [
      { label: 'PowerShell', icon: '💙', file: null },
      { label: 'Bash',       icon: '🟩', file: null },
    ],
  },

  {
    id:    'linux',
    label: 'Linux',
    icon:  '🐧',
    items: [
      { label: 'User Management',  icon: '👤', file: null },
      { label: 'File Permissions', icon: '🔐', file: null },
      { label: 'Package Management', icon: '📦', file: null },
      { label: 'Systemd Services', icon: '⚙️', file: null },
      { label: 'Networking',       icon: '🌐', file: null },
      { label: 'Cron Jobs',        icon: '⏰', file: null },
      { label: 'Bash Aliases',  icon: '⚙️', file: 'docs/linux/bash-aliases.md'},
    ],
  },
];