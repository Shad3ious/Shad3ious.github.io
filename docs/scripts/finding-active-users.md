# Finding Active Users

Tell whether someone is actually using a Windows machine right now, ignoring disconnected sessions, idle sessions and locked screens.

## Applies to

- Windows 10, Windows 11 and Windows Server, English language
- Checks before a reboot, an install or anything else that interrupts the person at the keyboard

## Why `quser` alone is not enough

`quser` (the same as `query user`) lists sessions, but "a session exists" is not "someone is working":

| What `quser` shows | Reality |
|---|---|
| `Disc` | Disconnected. Nobody is looking at it. |
| `Active` with a large idle time | Signed in, walked away hours ago |
| `Active` with no idle time, screen locked | Signed in, but locked. Usually means away. |
| `Active`, low idle time, not locked | Someone is working |

This page combines the `quser` state, the idle time, and a lock check into one answer.

## Parsing `quser`

Typical output:

```text
 USERNAME              SESSIONNAME        ID  STATE   IDLE TIME  LOGON TIME
>jdoe                  console             1  Active      none   10/27/2026 7:58 AM
 asmith                                    2  Disc        1:05   10/27/2026 6:30 AM
```

Things to handle:

- The current session has `>` in front of the user name.
- Disconnected sessions have no session name, so the columns shift left.
- Idle time comes as `none` or `.` (under a minute), a number of minutes (`5`), hours and minutes (`1:05`), or days, hours and minutes (`2+03:15`).
- With no users signed in, `quser` writes "No User exists for *" to the error stream and exits with code 1.
- The state words are localized. `Active` and `Disc` are the English values.

## Detecting a locked screen

When a session is locked, Windows runs `LogonUI.exe` inside that session. If `LogonUI.exe` exists with the same session ID as the user, the screen is locked.

This is a heuristic, not an API, but it is reliable on current Windows versions and needs no extra tools.

## The function

```powershell
function Get-InteractiveUser {
    <#
    .SYNOPSIS
        Lists user sessions and decides whether each one is in use right now.
    .DESCRIPTION
        Parses quser, converts idle time to minutes, and checks for LogonUI.exe in each
        session to detect a locked screen. InUse is true only for an Active, unlocked
        session idle for less than IdleThresholdMinutes.
    .PARAMETER IdleThresholdMinutes
        Sessions idle longer than this are not counted as in use.
    .EXAMPLE
        Get-InteractiveUser -IdleThresholdMinutes 30
    #>
    [CmdletBinding()]
    param([ValidateRange(1, 1440)][int]$IdleThresholdMinutes = 30)

    function ConvertTo-IdleMinutes {
        param([string]$Text)
        if ($Text -in 'none', '.') { return 0 }
        if ($Text -match '^(\d+)\+(\d+):(\d+)$') { return [int]$Matches[1] * 1440 + [int]$Matches[2] * 60 + [int]$Matches[3] }
        if ($Text -match '^(\d+):(\d+)$') { return [int]$Matches[1] * 60 + [int]$Matches[2] }
        if ($Text -match '^\d+$') { return [int]$Text }
        return $null
    }

    $lines = & quser.exe 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $lines) { return }

    $lockedSessions = @(Get-Process -Name LogonUI -ErrorAction SilentlyContinue | ForEach-Object { $_.SessionId })
    $pattern = '^\s*>?(?<user>\S+)\s+(?:(?<session>\S+)\s+)?(?<id>\d+)\s+(?<state>\S+)\s+(?<idle>\S+)\s+(?<logon>.+?)\s*$'

    foreach ($line in $lines | Select-Object -Skip 1) {
        if ($line -notmatch $pattern) { continue }
        $id = [int]$Matches['id']
        $state = $Matches['state']
        $idle = ConvertTo-IdleMinutes -Text $Matches['idle']
        $locked = $lockedSessions -contains $id

        $inUse = ($state -eq 'Active') -and (-not $locked) -and ($null -ne $idle) -and ($idle -lt $IdleThresholdMinutes)

        [pscustomobject]@{
            UserName    = $Matches['user']
            SessionId   = $id
            State       = $state
            IdleMinutes = $idle
            Locked      = $locked
            LogonTime   = $Matches['logon']
            InUse       = $inUse
        }
    }
}
```

## Run it on one or many machines

Locally:

```powershell
Get-InteractiveUser | Format-Table -AutoSize
```

Remotely, by sending the function itself:

```powershell
$computers = Get-Content -Path .\hosts.txt
Invoke-Command -ComputerName $computers -ScriptBlock ${function:Get-InteractiveUser} -ArgumentList 30 |
    Format-Table -Property PSComputerName, UserName, State, IdleMinutes, Locked, InUse -AutoSize
```

Machines with no sessions return nothing. To list every machine with a yes or no answer:

```powershell
$sessions = Invoke-Command -ComputerName $computers -ScriptBlock ${function:Get-InteractiveUser} -ArgumentList 30
foreach ($computer in $computers) {
    $active = @($sessions | Where-Object { $_.PSComputerName -eq $computer -and $_.InUse })
    [pscustomobject]@{
        ComputerName = $computer
        InUse        = $active.Count -gt 0
        Users        = ($active | ForEach-Object { $_.UserName }) -join ', '
    }
}
```

`PSComputerName` holds the name exactly as you passed it, so keep the host list consistent (all short names or all FQDNs).

## Choosing the idle threshold

- **15 to 30 minutes** is a reasonable default for "do not interrupt".
- Idle time counts keyboard and mouse input only. Someone watching a long video or reading a document can look idle. For reboots, combine this check with a warning message and a delay rather than relying on it alone.
- Server sessions over RDP are often left `Active` for days. Treat those by policy, not by idle time.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Every machine returns nothing | `quser` not found or no sessions | Run `quser` on one machine by hand to check |
| Sessions never match the pattern | Non-English Windows | Adjust the state values (`Active`, `Disc`) to the local language |
| A locked machine shows `InUse` | `LogonUI.exe` not running in that session | Some remote tools keep the session unlocked. Check idle time as well |
| `Invoke-Command` cannot find `quser.exe` | Running on Server Core without Remote Desktop components | Use `query user` or check that `C:\Windows\System32\quser.exe` exists |
