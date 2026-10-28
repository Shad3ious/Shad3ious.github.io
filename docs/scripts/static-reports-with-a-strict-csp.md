# Static Reports with a Strict CSP

Turn a script's JSON output into an HTML report that runs no inline code, loads nothing from other sites, and cannot be tricked into running code from the data.

## Applies to

- Reports opened in a current browser, either from a web server or straight from disk
- Data produced by PowerShell (or anything else) as JSON

## The pattern

Keep data and page apart:

- The **script** writes `report.json` and nothing else. It never builds HTML.
- The **page** is three static files, `index.html`, `report.js` and `report.css`, which never change between runs.
- The page loads the JSON and builds the table with DOM methods and `textContent`, so a hostname or error message that contains `<script>` shows up as text.
- A **Content Security Policy** in the page blocks inline scripts, inline styles and every outside host, so even a mistake in the page cannot load or run anything else.

The same three files work for every run. Copy a new `report.json` next to them and refresh.

## The policy

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
```

| Directive | Effect |
|---|---|
| `default-src 'none'` | Anything not listed below is blocked |
| `script-src 'self'` | Only script files from the same place as the page. No inline `<script>`, no `eval` |
| `style-src 'self'` | Only stylesheet files. No `style=` attributes, no `<style>` blocks |
| `connect-src 'self'` | `fetch` can only reach the same origin |
| `base-uri 'none'`, `form-action 'none'` | Blocks two ways of redirecting links and forms |

A `<meta>` policy cannot set `frame-ancestors`. If the report is served by a web server, send the policy as an HTTP header as well, with `frame-ancestors 'none'` added.

## The page

`index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <title>Fleet report</title>
  <link rel="stylesheet" href="report.css">
  <script defer src="report.js"></script>
</head>
<body>
  <header>
    <h1>Fleet report</h1>
    <p id="summary">Loading report.json...</p>
    <label class="picker">Open a report file <input id="file" type="file" accept=".json,application/json"></label>
  </header>
  <main>
    <table>
      <thead><tr><th>Computer</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </main>
</body>
</html>
```

`report.js`:

```javascript
(function () {
  'use strict';

  var MAX_BYTES = 20 * 1024 * 1024;
  var STATUS_CLASS = {
    Success: 'ok',
    VerifyFailed: 'bad',
    Error: 'bad',
    Unreachable: 'warn',
    WinRMFailed: 'warn'
  };

  var summary = document.getElementById('summary');
  var rows = document.getElementById('rows');

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text === null || text === undefined ? '' : String(text);
    return td;
  }

  function render(items) {
    rows.textContent = '';
    var counts = {};
    items.forEach(function (item) {
      var status = String(item.Status || 'Unknown');
      counts[status] = (counts[status] || 0) + 1;

      var tr = document.createElement('tr');
      tr.appendChild(cell(item.ComputerName));
      var statusCell = cell(status);
      if (Object.prototype.hasOwnProperty.call(STATUS_CLASS, status)) {
        statusCell.className = STATUS_CLASS[status];
      }
      tr.appendChild(statusCell);
      tr.appendChild(cell(item.Error || item.Output || ''));
      rows.appendChild(tr);
    });
    summary.textContent = items.length + ' machines: ' + Object.keys(counts).map(function (k) {
      return k + ' ' + counts[k];
    }).join(', ');
  }

  function parse(text) {
    var data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    if (!Array.isArray(data)) { data = [data]; }
    return data.filter(function (x) { return x && typeof x === 'object'; });
  }

  function fail(message) {
    rows.textContent = '';
    summary.textContent = message;
  }

  document.getElementById('file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) { return; }
    if (file.size > MAX_BYTES) { fail('That file is too large to be a report.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try { render(parse(reader.result)); } catch (err) { fail('That file is not valid report JSON.'); }
    };
    reader.onerror = function () { fail('Could not read that file.'); };
    reader.readAsText(file);
  });

  fetch('report.json', { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) { throw new Error('HTTP ' + res.status); }
      return res.text();
    })
    .then(function (text) { render(parse(text)); })
    .catch(function () {
      fail('No report.json found next to this page. Use "Open a report file" instead.');
    });
}());
```

`report.css`:

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff; --fg: #1d2125; --muted: #5c646d; --line: #d8dde2;
  --ok: #1a7f5a; --warn: #9a6700; --bad: #c62828;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111416; --fg: #e3e6e8; --muted: #98a1a9; --line: #2a3035;
    --ok: #4cc38a; --warn: #e3b341; --bad: #f47067;
  }
}
body { margin: 0; padding: 1.5rem; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
h1 { margin: 0 0 0.25rem; font-size: 1.4rem; }
#summary { margin: 0 0 1rem; color: var(--muted); }
.picker { display: inline-block; margin-bottom: 1rem; color: var(--muted); }
main { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
td:last-child { white-space: pre-wrap; word-break: break-word; }
.ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); font-weight: 600; }
```

This example reads the JSON report from [Fleet Command Runner](#/scripts/fleet-command-runner). Change the columns in `render` to fit your own data.

## Writing the JSON from PowerShell

```powershell
ConvertTo-Json -InputObject @($results) -Depth 4 | Set-Content -LiteralPath .\report.json -Encoding UTF8
```

- Wrap the results in `@()` and pass them with `-InputObject`. In Windows PowerShell 5.1, a single result piped to `ConvertTo-Json` comes out as an object instead of an array.
- Set `-Depth` high enough. The default of 2 turns nested objects into type names.
- Windows PowerShell 5.1 writes UTF-8 with a BOM. The page strips it, so that is fine here.
- Convert dates to strings first (`.ToString('yyyy-MM-dd HH:mm')`). Windows PowerShell 5.1 writes dates as `/Date(...)/`.

## Opening from disk

- Served from a web server (even `python -m http.server` on your workstation), the page loads `report.json` on its own.
- Opened straight from disk (`file://`), most browsers block `fetch` of local files. The page says so, and the **Open a report file** button reads the JSON from disk instead. Nothing is uploaded anywhere.

## Rules that keep it safe

- Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` with data. Use `textContent` and `createElement`.
- Map data to CSS classes through a fixed lookup, as `STATUS_CLASS` does. Never put data straight into `className`.
- If the data includes links, only allow `https:` URLs and set `rel="noopener noreferrer"`.
- No inline event handlers (`onclick=`) and no inline styles. The policy blocks them anyway, so they would only show up as console errors.
- Keep every library local. If you need a charting library, copy a pinned version next to the page instead of loading it from a CDN.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Page stays on "Loading" | Script blocked or failed | Open the browser console and look for CSP or script errors |
| Console shows "Refused to apply inline style" | A `style=` attribute or `<style>` block | Move it into `report.css` |
| "No report.json found" when opened from disk | Browser blocks `fetch` on `file://` | Use the button, or serve the folder over HTTP |
| Table shows `System.Object[]` or type names | `-Depth` too low | Raise `ConvertTo-Json -Depth` |
| Only one row, and it looks wrong | Single result not wrapped in an array | Use `ConvertTo-Json -InputObject @($results)` |
