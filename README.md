# Shad3ious Docs

My personal tech docs site. Runbooks, guides, and how-tos I've written for Windows, homelab stuff, networking, and scripting.

**Live:** https://Shad3ious.github.io

---

## Structure

```
.
├── index.html              # just the HTML shell, never touch this
├── LICENSE
├── assets/
│   ├── css/
│   │   └── styles.css      # all the styles
│   └── js/
│       ├── config.js       # the only file you edit
│       └── app.js          # site engine
└── docs/                   # all your .md files go here
    ├── windows/
    │   └── exchange.md
    ├── homelab/
    ├── networking/
    └── scripts/
```

---

## Adding a page

1. Write your doc as a `.md` file and put it in the right folder under `docs/`
2. Open `assets/js/config.js`
3. Add it to the matching category in the `items` array:

```js
{ label: 'WSUS Setup', icon: '🔄', file: 'docs/windows/wsus-setup.md' }
```

4. Push to GitHub and it shows up on the site automatically.

Set `file: null` if the page isn't written yet — it shows as "Coming Soon".

---

## Built with

- Vanilla JS with ES modules, no framework, no build step
- [marked](https://github.com/markedjs/marked) for Markdown parsing
- [DOMPurify](https://github.com/cure53/DOMPurify) for XSS sanitization
- GitHub Pages for hosting

## License

MIT + Commons Clause. Check [LICENSE](./LICENSE) for the full text. Commercial use isn't allowed.
