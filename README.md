# Shad3ious Docs

Personal technical documentation site - guides, runbooks, and how-tos for Windows, Homelab, Networking, and more.

**Live site:** https://Shad3ious.github.io

---

## Project Structure

```
.
|-- index.html                 # Site shell - no editing needed
|-- LICENSE
|-- assets/
|   |-- css/
|   |   `-- styles.css         # All styles and color tokens (dark default, light opt-in)
|   |-- js/
|   |   |-- config.js          # <- YOUR FILE. Add pages, categories, links here.
|   |   |-- app.js             # Application engine - no editing needed
|   |   `-- theme-init.js      # Applies the saved theme before first paint
|   |-- fonts/                 # Onest + DM Mono (self-hosted, SIL OFL 1.1)
|   `-- vendor/                # marked + DOMPurify (self-hosted, version in filename)
`-- docs/                      # Drop your .md files here
    |-- windows/
    |-- linux/
    |-- homelab/
    |-- networking/
    `-- scripts/
```

---

## Adding a Page

1. Write your doc as a Markdown file and save it under `docs/`
2. Open `assets/js/config.js`
3. Add one entry to the matching category's `items` array:

```js
{ label: 'My Guide', file: 'docs/windows/my-guide.md', tags: ['Windows'], meta: 'Updated March 2026' }
```

4. Push to GitHub - the page appears automatically.

Set `file: null` for pages not written yet (they show as "soon").

**Page URLs** come from the category id and the label: `Bash Aliases` in `linux` becomes
`#/linux/bash-aliases`. Headings get deep links too: `#/linux/bash-aliases/how-aliases-work`.
Renaming a label changes its URL.

**Page title:** if the Markdown file starts with `# Some Title`, that becomes the page title.
Otherwise the `label` from config.js is used.

**Callouts:** start a blockquote with `> [!TIP]`, `> [!NOTE]`, or `> [!WARNING]`
(GitHub style). The older emoji-prefixed Tip and Warning blockquotes still work.

---

## Updating After Edits

Bump the `?v=` value on `config.js`, `app.js`, `theme-init.js`, and `styles.css` in
`index.html` after editing them, so browsers fetch the new copy. Today's date (YYYYMMDD) works.

---

## Tech Stack

- Vanilla JavaScript, no build step, no framework
- [marked](https://github.com/markedjs/marked) 18.1.1 - Markdown parsing (MIT)
- [DOMPurify](https://github.com/cure53/DOMPurify) 3.4.17 - HTML sanitization (Apache-2.0 / MPL-2.0)
- [Onest](https://github.com/simpals/onest) and [DM Mono](https://github.com/googlefonts/dm-mono) - SIL OFL 1.1
- GitHub Pages for hosting

Every script, style, and font is served from this repo. The Content-Security-Policy in
`index.html` allows only `'self'` for scripts, styles, fonts, and fetch.

### Updating vendor libraries

Vendor files were taken from the npm registry and checked against the registry's published
sha512 integrity values. To update one:

1. `npm pack <name>@<version>` (pick a release at least two weeks old)
2. Compare the tarball's sha512 with `npm view <name>@<version> dist.integrity`
3. Copy the built file into `assets/vendor/` with the version in its filename
4. Update the `<script>` tag in `index.html`

## License

MIT + Commons Clause. Check [LICENSE](./LICENSE) for the full text. Commercial use isn't allowed.
Third-party licenses are kept next to the files they cover in `assets/fonts/` and `assets/vendor/`.
