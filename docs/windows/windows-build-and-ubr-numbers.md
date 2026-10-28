# Windows Build and UBR Numbers

Read a Windows version number and tell which feature release a machine runs and which month it was last patched.

## Applies to

- Windows 10, Windows 11 and Windows Server 2016 or later

## The four parts

A full version looks like `10.0.26100.4652`.

| Part | Example | Meaning |
|---|---|---|
| Major.Minor | `10.0` | The same for every current Windows release. Ignore it. |
| Build | `26100` | The feature release. It only changes with an upgrade. |
| UBR | `4652` | Update Build Revision. It goes up with every cumulative update. |

So the build tells you **what** a machine runs, and the UBR tells you **how current** it is.

## Common builds

| Build | Release |
|---|---|
| 26200 | Windows 11 25H2 |
| 26100 | Windows 11 24H2, Windows Server 2025 |
| 22631 | Windows 11 23H2 |
| 22621 | Windows 11 22H2 |
| 20348 | Windows Server 2022 |
| 19045 | Windows 10 22H2 |
| 19044 | Windows 10 21H2, Windows 10 Enterprise LTSC 2021 |
| 17763 | Windows 10 1809, Windows Server 2019, Windows 10 Enterprise LTSC 2019 |
| 14393 | Windows 10 1607, Windows Server 2016, Windows 10 Enterprise LTSB 2016 |

Anything 22000 or higher is Windows 11 (or Server 2022 and later).

## Read it on a machine

```powershell
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' |
    Select-Object ProductName, DisplayVersion, EditionID, CurrentBuild, UBR
```

> [!WARNING]
> `ProductName` still says "Windows 10" on Windows 11. Use `CurrentBuild` to tell them apart, not the product name.

`DisplayVersion` (for example `24H2`) exists on 20H2 and later. Older builds have `ReleaseId` instead.

## Read it across a fleet

```powershell
$computers = Get-Content -Path .\hosts.txt
Invoke-Command -ComputerName $computers -ErrorAction SilentlyContinue -ErrorVariable failed -ScriptBlock {
    $cv = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    [pscustomobject]@{
        Build   = [int]$cv.CurrentBuild
        UBR     = [int]$cv.UBR
        Version = '{0}.{1}' -f $cv.CurrentBuild, $cv.UBR
        Display = $cv.DisplayVersion
        Edition = $cv.EditionID
    }
} | Sort-Object -Property Build, UBR |
    Format-Table -Property PSComputerName, Version, Display, Edition -AutoSize

$failed | ForEach-Object { Write-Warning $_.TargetObject }
```

`Invoke-Command` with a list of names connects to them in parallel (32 at a time by default), so this is fast even for a few hundred machines.

## Map a UBR to a month

Microsoft publishes every build and UBR with its release date on the release health pages:

- [Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information)
- [Windows 10 release information](https://learn.microsoft.com/en-us/windows/release-health/release-information)
- The update history page for each Windows Server version

To compare machines against those pages, keep a small table per build with one row per month:

```text
Build,ReleaseMonth,UBR
26100,2026-08,xxxx
26100,2026-09,xxxx
19045,2026-09,xxxx
```

Fill in the UBRs from the pages above. A machine is current when its UBR is equal to or higher than the latest row for its build.

Things that trip people up:

- **The second Tuesday release is the security baseline.** Microsoft also ships optional preview updates later in the month with a higher UBR. A machine on a preview UBR is ahead of the security release, not behind it.
- **Out-of-band releases** add extra UBRs in the middle of a month.
- **Some builds share UBRs.** Releases that differ only by an enablement package get the same cumulative update and the same UBR: 19044 and 19045, 22621 and 22631, 26100 and 26200.
- **Tables go stale.** Put the month you last updated the table at the top of the file. If it is older than the current month, a report should say "table out of date" rather than "up to date".

## Status values that work well in a report

| Status | When |
|---|---|
| UpToDate | UBR is at or above the latest known UBR for that build |
| Behind | UBR is lower |
| TableStale | The table has no entry for the current month |
| NoCatalogData | The build is not in the table at all |
| Unreachable | The machine did not answer |

Keep end of support as a separate flag. A machine can be fully patched on a release that is already out of support.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Windows 11 machine reports Windows 10 | `ProductName` was never updated | Use `CurrentBuild` |
| `DisplayVersion` is empty | Release older than 20H2 | Read `ReleaseId` |
| Two releases show the same UBR | Same cumulative update with an enablement package | Expected, compare per build |
