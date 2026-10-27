# Security Policy

## Reporting a problem

If you find a security issue in this site, please report it privately with
GitHub's **Report a vulnerability** button on the repository's Security tab.
Please do not open a public issue for it.

## What this site is

A static documentation site on GitHub Pages. There is no server code, no database,
no login, no forms, no cookies, and no analytics. Visitors' browsers download
HTML, CSS, JavaScript, fonts, and Markdown files from this repository and nothing
else.

## How it is protected

| Risk | Control |
|------|---------|
| Script injection (XSS) through guide content | Markdown is parsed by marked, then sanitized by DOMPurify, which returns DOM nodes so sanitized markup is never re-parsed (mXSS). Text from config and the URL is written with textContent only. |
| Injected or third-party scripts | Content-Security-Policy allows scripts, styles, fonts, and fetch only from this origin. No inline script or style. Trusted Types are enforced in supporting browsers. |
| Compromised CDN or library | No CDNs. marked and DOMPurify are self-hosted, pinned by version in the filename, and were checked against the npm registry's published sha512 integrity values. |
| Visitor tracking through embedded images | Images load only from this repository (img-src 'self'). |
| Clickjacking | The site hides itself when loaded inside any frame, and shows nothing when framed with scripts disabled. |
| Reverse tabnabbing | External links open with rel="noopener noreferrer". |
| Referrer leakage | referrer policy is no-referrer. |
| Open redirects and spoofed pages | Page routes are an allowlist built from config.js. Unknown links show a fixed "Page not found" message and never echo the URL. |
| Fetching unexpected files | Guide paths must match docs/<path>.md with no "..". |
| DOM clobbering | id and name attributes are stripped from guide HTML. |
| Prototype pollution | Lookup tables use objects with no prototype. |
| Regular-expression DoS | Search input is capped at 100 characters and escaped before use in a regex. |
| Jekyll / Liquid processing | Disabled with a .nojekyll file; files are served exactly as committed. |
| Leaking secrets or internal details | tools/pre-publish-scan_v1.sh runs as a pre-commit hook and blocks known secret formats and terms from a private denylist. GitHub secret scanning and push protection are enabled. |

## Known limits

GitHub Pages cannot send custom HTTP headers. The policy above is delivered in a
`<meta>` tag, which browsers honor for most directives but not for
frame-ancestors, X-Content-Type-Options, or Permissions-Policy. The frame check in
theme-init.js covers clickjacking instead. Moving the site behind a proxy such as
Cloudflare (requires a custom domain) would allow real headers.
