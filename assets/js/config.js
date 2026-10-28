/**
 * Shad3ious Docs - site configuration
 * This is the only file to edit for content changes. Plain ASCII only.
 *
 * ADD A PAGE
 *   1. Save the guide as Markdown under docs/<category>/, for example
 *      docs/windows/example-guide.md. Start it with "# Title" matching the label.
 *   2. Add one entry to that category's items below:
 *        { label: 'Example Guide', file: 'docs/windows/example-guide.md',
 *          tags: ['Windows'], meta: 'Updated 2026-10 - 5 min read' },
 *   3. Bump ?v= on config.js in index.html, then push.
 *
 *   The URL comes from the category id and the label:
 *   'Example Guide' in windows -> #/windows/example-guide
 *   Renaming a label changes its URL and breaks old links.
 *
 *   file: null shows the page as "soon". Add pages only when they are written.
 *
 * ITEM FIELDS
 *   label  Display name in the sidebar and search. Also builds the URL.
 *   file   Path to the .md file from the repo root. Case-sensitive.
 *   tags   Shown under the title and used by search. Use only these:
 *          Windows, WSUS, WinRM, PowerShell, Chocolatey, Docker, Linux,
 *          DNS, Ansible, Runbook, Script, Troubleshooting
 *   meta   'Updated YYYY-MM - N min read'
 *
 * ADD A CATEGORY
 *   Copy a category block and change id, label and items.
 *   id must be unique, lowercase letters, digits and hyphens only.
 *   Order here is the order on the site.
 */

// -- SITE SETTINGS ----------------------------------------------------------
const SITE_CONFIG = {
  siteName: 'Shad3ious',

  // Repo that holds this site. Powers the "Edit on GitHub" link on each guide.
  // Must be an https://github.com/ URL. Remove the line to hide the link.
  repoUrl: 'https://github.com/Shad3ious/Shad3ious.github.io',

  // License file linked from the copyright line in the footer.
  // Only https:// URLs are accepted. Remove the line to show plain text.
  licenseUrl: 'https://github.com/Shad3ious/Shad3ious.github.io/blob/main/LICENSE',

  // First entry is the text link in the top bar. All entries are listed in
  // the footer. Only https:// URLs are accepted; anything else is dropped.
  socials: [
    { label: 'GitHub',  url: 'https://github.com/Shad3ious' },
    { label: 'Twitter', url: 'https://twitter.com/Shad3ious' },
    { label: 'Reddit',  url: 'https://reddit.com/u/Shad3ious' },
    { label: 'YouTube', url: 'https://www.youtube.com/@shad3ious' },
  ],
};

// -- NAVIGATION -------------------------------------------------------------
// Each category is one group in the sidebar and one chip under the
// homepage search.
const NAV = [
  {
    id: 'windows',
    label: 'Windows',
    items: [
      {
        label: 'WSUS Database Cleanup',
        file: 'docs/windows/wsus-database-cleanup.md',
        tags: ['WSUS', 'PowerShell', 'Runbook'],
        meta: 'Updated 2026-10 - 7 min read',
      },
      {
        label: 'WinRM Stuck on Public Profile',
        file: 'docs/windows/winrm-stuck-on-public-profile.md',
        tags: ['WinRM', 'PowerShell', 'Troubleshooting'],
        meta: 'Updated 2026-10 - 7 min read',
      },
      {
        label: 'Orphaned CBS Update Failures',
        file: 'docs/windows/orphaned-cbs-update-failures.md',
        tags: ['Windows', 'Troubleshooting'],
        meta: 'Updated 2026-10 - 5 min read',
      },
      {
        label: 'Packaging Difficult Installers',
        file: 'docs/windows/packaging-difficult-installers.md',
        tags: ['Chocolatey', 'PowerShell'],
        meta: 'Updated 2026-10 - 7 min read',
      },
      {
        label: 'Offline Chocolatey Repository',
        file: 'docs/windows/offline-chocolatey-repository.md',
        tags: ['Chocolatey', 'Runbook'],
        meta: 'Updated 2026-10 - 5 min read',
      },
      {
        label: 'BitLocker TPM and PIN',
        file: 'docs/windows/bitlocker-tpm-and-pin.md',
        tags: ['Windows', 'PowerShell', 'Runbook'],
        meta: 'Updated 2026-10 - 6 min read',
      },
      {
        label: 'Offline Defender Updates',
        file: 'docs/windows/offline-defender-updates.md',
        tags: ['Windows', 'PowerShell', 'Script'],
        meta: 'Updated 2026-10 - 8 min read',
      },
      {
        label: 'Windows Build and UBR Numbers',
        file: 'docs/windows/windows-build-and-ubr-numbers.md',
        tags: ['Windows', 'PowerShell'],
        meta: 'Updated 2026-10 - 4 min read',
      },
      {
        label: 'Unattended Install Lessons',
        file: 'docs/windows/unattended-install-lessons.md',
        tags: ['Windows', 'Troubleshooting'],
        meta: 'Updated 2026-10 - 5 min read',
      },
      {
        label: 'Hyper-V Logon Right After STIG',
        file: 'docs/windows/hyper-v-logon-right-after-stig.md',
        tags: ['Windows', 'Troubleshooting'],
        meta: 'Updated 2026-10 - 4 min read',
      },
    ],
  },

  {
    id: 'scripts',
    label: 'Scripts',
    items: [
      {
        label: 'Fleet Command Runner',
        file: 'docs/scripts/fleet-command-runner.md',
        tags: ['PowerShell', 'WinRM', 'Script'],
        meta: 'Updated 2026-10 - 9 min read',
      },
      {
        label: 'WinRM Credential Fallback',
        file: 'docs/scripts/winrm-credential-fallback.md',
        tags: ['PowerShell', 'WinRM', 'Script'],
        meta: 'Updated 2026-10 - 6 min read',
      },
      {
        label: 'DNS Check Before Reboot',
        file: 'docs/scripts/dns-check-before-reboot.md',
        tags: ['PowerShell', 'DNS', 'Script'],
        meta: 'Updated 2026-10 - 5 min read',
      },
      {
        label: 'Finding Active Users',
        file: 'docs/scripts/finding-active-users.md',
        tags: ['PowerShell', 'Script'],
        meta: 'Updated 2026-10 - 5 min read',
      },
      {
        label: 'PowerShell 5.1 and Non-ASCII Text',
        file: 'docs/scripts/powershell-5-1-and-non-ascii-text.md',
        tags: ['PowerShell', 'Troubleshooting'],
        meta: 'Updated 2026-10 - 5 min read',
      },
      {
        label: 'Static Reports with a Strict CSP',
        file: 'docs/scripts/static-reports-with-a-strict-csp.md',
        tags: ['PowerShell', 'Script'],
        meta: 'Updated 2026-10 - 7 min read',
      },
    ],
  },

  {
    id: 'automation',
    label: 'Automation',
    items: [
      {
        label: 'Ansible on Windows with Kerberos',
        file: 'docs/automation/ansible-on-windows-with-kerberos.md',
        tags: ['Ansible', 'WinRM', 'Runbook'],
        meta: 'Updated 2026-10 - 5 min read',
      },
      {
        label: 'Semaphore Scheduled Templates',
        file: 'docs/automation/semaphore-scheduled-templates.md',
        tags: ['Ansible', 'Runbook'],
        meta: 'Updated 2026-10 - 6 min read',
      },
      {
        label: 'Vault-Backed Service Accounts',
        file: 'docs/automation/vault-backed-service-accounts.md',
        tags: ['Ansible', 'Linux', 'Script'],
        meta: 'Updated 2026-10 - 5 min read',
      },
    ],
  },

  {
    id: 'networking',
    label: 'Networking',
    items: [
      {
        label: 'DNS Hygiene Checks',
        file: 'docs/networking/dns-hygiene-checks.md',
        tags: ['DNS', 'PowerShell', 'Script'],
        meta: 'Updated 2026-10 - 10 min read',
      },
    ],
  },

  {
    id: 'linux',
    label: 'Linux',
    items: [
      {
        label: 'Bash Aliases',
        file: 'docs/linux/bash-aliases.md',
        tags: ['Linux'],
        meta: 'Updated 2026-10 - 4 min read',
      },
      {
        label: 'Recovering From a Recursive chown',
        file: 'docs/linux/recovering-from-a-recursive-chown.md',
        tags: ['Linux', 'Troubleshooting'],
        meta: 'Updated 2026-10 - 7 min read',
      },
    ],
  },

  {
    id: 'homelab',
    label: 'Homelab',
    items: [
      {
        label: 'Game Servers Without Port Forwarding',
        file: 'docs/homelab/game-servers-without-port-forwarding.md',
        tags: ['Docker', 'Linux'],
        meta: 'Updated 2026-10 - 6 min read',
      },
      {
        label: 'Minecraft Servers in Docker',
        file: 'docs/homelab/minecraft-servers-in-docker.md',
        tags: ['Docker', 'Linux'],
        meta: 'Updated 2026-10 - 8 min read',
      },
    ],
  },
];
