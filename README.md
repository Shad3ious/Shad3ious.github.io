# Shad3ious Docs

Personal technical documentation site — guides, runbooks, and how-tos for Windows, Homelab, Networking, and more.

**Live site:** https://Shad3ious.github.io

---

## Project Structure

```
.
├── index.html              # Site shell — never needs editing
├── LICENSE
├── assets/
│   ├── css/
│   │   └── styles.css      # All styles — edit for visual tweaks only
│   └── js/
│       ├── config.js       # ← YOUR FILE. Add pages, categories, links here.
│       └── app.js          # Application engine — never needs editing
└── docs/                   # Drop your .md files here
    ├── windows/
    │   └── exchange.md
    ├── homelab/
    ├── networking/
    └── scripts/
```

---

## Adding a Page

1. Write your doc as a Markdown file and save it under `docs/`
2. Open `assets/js/config.js`
3. Add one entry to the matching category's `items` array:

```js
{ label: 'My Guide', icon: '📄', file: 'docs/windows/my-guide.md', tags: ['Windows'], meta: '📅 2026' }
```

4. Push to GitHub — the page appears automatically.

Set `file: null` for pages not written yet (shows "Coming Soon").

---

## Tech Stack

- Vanilla ES Modules (no build step, no framework)
- [marked](https://github.com/markedjs/marked) — Markdown parsing
- [DOMPurify](https://github.com/cure53/DOMPurify) — XSS sanitization
- GitHub Pages for hosting

## License

MIT License + Commons Clause. See [LICENSE](./LICENSE) for full terms.
Commercial use is not permitted without written permission.
