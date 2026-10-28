# PowerShell 5.1 and Non-ASCII Text

Why a script with a single dash or curly quote in it breaks in Windows PowerShell 5.1, and how to keep it from happening.

## Applies to

- Windows PowerShell 5.1 (the `powershell.exe` that ships with Windows)
- Scripts written in an editor that saves UTF-8 without a byte order mark (BOM), which includes VS Code's default

PowerShell 7 reads files as UTF-8 by default and does not have this problem.

## Symptoms

A script that ran fine in your editor fails on a server with errors that make no sense for the line they point at:

```text
The string is missing the terminator: ".
Missing closing '}' in statement block or type definition.
Unexpected token in expression or statement.
```

Or it runs, but text it writes shows two or three odd characters, often starting with a lowercase "a" with a circumflex, where a dash, apostrophe or accented letter should be.

## Why it happens

Windows PowerShell 5.1 decides how to read a `.ps1` file by looking for a BOM. With no BOM, it reads the file in the system's legacy code page, which is Windows-1252 on English systems.

Take an em dash. In UTF-8 it is three bytes: `E2 80 94`. Read as Windows-1252, those bytes become three characters: a lowercase "a" with a circumflex (`U+00E2`), a euro sign (`U+20AC`) and a right double quotation mark (`U+201D`).

PowerShell treats curly quotation marks as real quote characters. So a dash inside a string ends the string early, and everything after it is parsed as code. A curly apostrophe does the same thing to single-quoted strings.

That is why the error is often several lines below the actual character, and why the same file works in PowerShell 7 or in an editor that guessed the encoding correctly.

## Fix: keep scripts ASCII

The most reliable fix is to have no non-ASCII characters in scripts at all, including comments and strings:

| Instead of | Use |
|---|---|
| Em or en dash | `-` or `:` |
| Curly quotes | `'` and `"` |
| Ellipsis character | `...` |
| Arrows | `->` |
| Non-breaking space | A normal space |

### Find them

```powershell
Select-String -Path .\*.ps1, .\*.psm1, .\*.psd1 -Pattern '[^\x00-\x7F]' |
    Select-Object -Property Filename, LineNumber, Line
```

Any result is a character to replace. The pattern matches anything outside 7-bit ASCII, however the file is decoded.

### Replace the common ones

```powershell
$map = [ordered]@{
    ([char]0x2014) = '-'     # em dash
    ([char]0x2013) = '-'     # en dash
    ([char]0x2018) = "'"     # left single quote
    ([char]0x2019) = "'"     # right single quote
    ([char]0x201C) = '"'     # left double quote
    ([char]0x201D) = '"'     # right double quote
    ([char]0x2026) = '...'   # ellipsis
    ([char]0x00A0) = ' '     # non-breaking space
}

Get-ChildItem -Path .\*.ps1 | ForEach-Object {
    $text = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)
    foreach ($key in $map.Keys) { $text = $text.Replace([string]$key, $map[$key]) }
    [IO.File]::WriteAllText($_.FullName, $text, (New-Object -TypeName Text.UTF8Encoding -ArgumentList $false))
}
```

The replacement map uses `[char]` codes so the fixing script is plain ASCII itself. Run the find command again afterwards to catch anything not in the map.

## Fix: save with a BOM

If a script must contain non-ASCII text (a localized message, a name with an accent), save it as UTF-8 **with** BOM. Windows PowerShell 5.1 then reads it correctly.

In VS Code, add this to your `settings.json` (merge it with what is already there) so PowerShell files are always saved that way:

```json
{
    "[powershell]": {
        "files.encoding": "utf8bom"
    }
}
```

## Writing files from 5.1

Output encoding has its own surprises in Windows PowerShell 5.1:

| Command | Default encoding |
|---|---|
| `Out-File` and `>` | UTF-16 LE with BOM |
| `Set-Content`, `Add-Content` | The legacy code page |
| `Export-Csv` | ASCII |
| `-Encoding UTF8` on any of them | UTF-8 **with** BOM |

When another tool needs UTF-8 without a BOM, write the file with .NET:

```powershell
$utf8NoBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText('C:\Temp\Example\out.json', $json, $utf8NoBom)
```

## Catch it before it ships

- Run the find command above in a pre-commit hook or a CI step, and fail when it finds anything.
- Turn on your editor's display of invisible and unusual characters. VS Code highlights ambiguous Unicode characters by default.
- Watch text pasted from chat tools, web pages, word processors and ticket systems. They replace straight quotes with curly ones as you type.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Parse error several lines below the real problem | A curly quote or dash ended a string early | Run the find command and replace the characters |
| Works in VS Code, fails in `powershell.exe` | VS Code saved UTF-8 without BOM | Remove non-ASCII characters, or save with BOM |
| Output file has odd characters at the start | UTF-8 BOM read by a tool that does not expect it | Write with `UTF8Encoding($false)` |
| Output file looks double-spaced or has null bytes | `Out-File` wrote UTF-16 | Add `-Encoding UTF8` or use `Set-Content` |
