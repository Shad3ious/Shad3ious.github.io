# Fleet Command Runner

Run one command or one local script on a list of Windows machines in parallel, check that the change took effect, and get one result per machine.

## Applies to

- Windows PowerShell 5.1 on the admin workstation
- Targets with WinRM enabled and reachable on the network
- An account with admin rights on the targets

## What it does

`Invoke-FleetPayload_v1.ps1` reads a list of hostnames and, for each one, in parallel:

1. **Pings it.** Machines that are off are marked `Unreachable` in about a second, instead of waiting for a WinRM timeout.
2. **Checks WinRM with `Test-WSMan`.** A machine that answers ping but not WinRM is marked `WinRMFailed`.
3. **Opens one session** and runs the payload in it. A failure on one machine does not affect any other.
4. **Optionally verifies.** It runs a second script block in the same session and compares the result with what you expect.
5. **Returns one result object** with the same fields for every machine, and writes them all to a JSON report.

## Usage

The host list is a text file with one name per line. Blank lines and lines starting with `#` are skipped.

```text
# hosts.txt
host01
host02.contoso.local
host03
```

Run a command:

```powershell
.\Invoke-FleetPayload_v1.ps1 -ComputerListPath .\hosts.txt -ScriptBlock { (Get-Service -Name WinRM).Status }
```

Run a local script file on every target. The file is read on your workstation and sent over the session, so the targets do not need access to it:

```powershell
.\Invoke-FleetPayload_v1.ps1 -ComputerListPath .\hosts.txt -ScriptPath .\Set-Example_v1.ps1 -Credential (Get-Credential CONTOSO\jdoe)
```

Change a setting and confirm it:

```powershell
.\Invoke-FleetPayload_v1.ps1 -ComputerListPath .\hosts.txt `
    -ScriptBlock {
        New-Item -Path 'HKLM:\SOFTWARE\Contoso\Example' -Force | Out-Null
        Set-ItemProperty -Path 'HKLM:\SOFTWARE\Contoso\Example' -Name 'Enabled' -Value 1
    } `
    -VerifyScript { (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Contoso\Example' -Name 'Enabled').Enabled } `
    -Expected '1'
```

`-VerifyComparison` sets how the verify output is compared with `-Expected`: `Equal` (default), `Like` (wildcards) or `Match` (regex).

## The script

```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
    Runs a command or local script on a list of Windows machines in parallel over WinRM.
.DESCRIPTION
    For each host: ping, Test-WSMan, one PSSession, the payload, an optional verify step,
    and one result object. Hosts run in parallel in a runspace pool. Results are shown as
    a table and written to a JSON report.
.PARAMETER ComputerListPath
    Text file with one hostname per line. Blank lines and lines starting with # are skipped.
.PARAMETER ScriptBlock
    Command to run on each host.
.PARAMETER ScriptPath
    Local .ps1 file to run on each host. Read locally and sent over the session.
.PARAMETER ArgumentList
    Arguments passed to the script block or script.
.PARAMETER Credential
    Credential for the sessions. Defaults to the current user.
.PARAMETER VerifyScript
    Script block run after the payload. Its output is compared with Expected.
.PARAMETER Expected
    Expected verify output, compared as text.
.PARAMETER VerifyComparison
    Equal, Like or Match.
.PARAMETER ThrottleLimit
    Number of hosts handled at the same time.
.PARAMETER PingTimeoutMs
    Ping timeout in milliseconds.
.PARAMETER ReportPath
    JSON report location.
.EXAMPLE
    .\Invoke-FleetPayload_v1.ps1 -ComputerListPath .\hosts.txt -ScriptBlock { hostname }
.NOTES
    Version: 1
#>
[CmdletBinding(DefaultParameterSetName = 'Command')]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$ComputerListPath,

    [Parameter(Mandatory = $true, ParameterSetName = 'Command')]
    [scriptblock]$ScriptBlock,

    [Parameter(Mandatory = $true, ParameterSetName = 'File')]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$ScriptPath,

    [object[]]$ArgumentList,

    [System.Management.Automation.PSCredential]$Credential,

    [scriptblock]$VerifyScript,

    [string]$Expected,

    [ValidateSet('Equal', 'Like', 'Match')]
    [string]$VerifyComparison = 'Equal',

    [ValidateRange(1, 64)]
    [int]$ThrottleLimit = 16,

    [ValidateRange(100, 10000)]
    [int]$PingTimeoutMs = 1000,

    [string]$ReportPath = (Join-Path -Path $PWD.Path -ChildPath ('FleetPayload_{0}.json' -f (Get-Date -Format 'yyyyMMdd_HHmmss')))
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if ($VerifyScript -and -not $PSBoundParameters.ContainsKey('Expected')) {
    throw '-VerifyScript needs -Expected.'
}

# Read and validate the host list
$nameRule = '^[A-Za-z0-9][A-Za-z0-9.\-]{0,252}$'
$computers = New-Object -TypeName System.Collections.Generic.List[string]
foreach ($line in Get-Content -LiteralPath $ComputerListPath) {
    $name = $line.Trim()
    if (-not $name -or $name.StartsWith('#')) { continue }
    if ($name -notmatch $nameRule) { Write-Warning "Skipping invalid hostname: $name"; continue }
    if (-not $computers.Contains($name)) { $computers.Add($name) }
}
if ($computers.Count -eq 0) { throw 'The host list is empty.' }

# Script blocks are passed as text and rebuilt inside each runspace
if ($PSCmdlet.ParameterSetName -eq 'File') {
    $payloadText = Get-Content -LiteralPath $ScriptPath -Raw
} else {
    $payloadText = $ScriptBlock.ToString()
}
$verifyText = $null
if ($VerifyScript) { $verifyText = $VerifyScript.ToString() }

$worker = {
    param($ComputerName, $PayloadText, $ArgumentList, $Credential, $VerifyText, $Expected, $VerifyComparison, $PingTimeoutMs)

    $ErrorActionPreference = 'Stop'
    $start = Get-Date
    $result = [ordered]@{
        ComputerName = $ComputerName
        Status       = 'Unknown'
        Ping         = $false
        WinRM        = $false
        Verified     = $null
        Actual       = $null
        Expected     = $Expected
        Output       = $null
        Error        = $null
        Seconds      = 0
    }
    $session = $null

    try {
        $ping = New-Object -TypeName System.Net.NetworkInformation.Ping
        try {
            $reply = $ping.Send($ComputerName, $PingTimeoutMs)
            $result.Ping = ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success)
        }
        catch { $result.Ping = $false }
        finally { $ping.Dispose() }

        if (-not $result.Ping) {
            $result.Status = 'Unreachable'
        }
        else {
            try {
                $null = Test-WSMan -ComputerName $ComputerName -ErrorAction Stop
                $result.WinRM = $true
            }
            catch {
                $result.Status = 'WinRMFailed'
                $result.Error = $_.Exception.Message
            }
        }

        if ($result.WinRM) {
            $sessionParams = @{ ComputerName = $ComputerName; ErrorAction = 'Stop' }
            if ($Credential) { $sessionParams.Credential = $Credential }
            $session = New-PSSession @sessionParams

            $invokeParams = @{ Session = $session; ScriptBlock = [scriptblock]::Create($PayloadText); ErrorAction = 'Stop' }
            if ($null -ne $ArgumentList) { $invokeParams.ArgumentList = $ArgumentList }
            $output = Invoke-Command @invokeParams
            $text = ($output | Out-String).Trim()
            if ($text.Length -gt 4000) { $text = $text.Substring(0, 4000) + ' [truncated]' }
            $result.Output = $text
            $result.Status = 'Success'

            if ($VerifyText) {
                $actual = Invoke-Command -Session $session -ScriptBlock ([scriptblock]::Create($VerifyText)) -ErrorAction Stop
                $result.Actual = ($actual | Out-String).Trim()
                switch ($VerifyComparison) {
                    'Equal' { $result.Verified = ($result.Actual -eq $Expected) }
                    'Like'  { $result.Verified = ($result.Actual -like $Expected) }
                    'Match' { $result.Verified = ($result.Actual -match $Expected) }
                }
                if (-not $result.Verified) { $result.Status = 'VerifyFailed' }
            }
        }
    }
    catch {
        $result.Status = 'Error'
        $result.Error = $_.Exception.Message
    }
    finally {
        if ($session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue }
        $result.Seconds = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
    }

    [pscustomobject]$result
}

$initialState = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
$pool = [runspacefactory]::CreateRunspacePool(1, $ThrottleLimit, $initialState, $Host)
$pool.Open()

$jobs = foreach ($computer in $computers) {
    $ps = [powershell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($worker.ToString())
    [void]$ps.AddParameters(@{
        ComputerName     = $computer
        PayloadText      = $payloadText
        ArgumentList     = $ArgumentList
        Credential       = $Credential
        VerifyText       = $verifyText
        Expected         = $Expected
        VerifyComparison = $VerifyComparison
        PingTimeoutMs    = $PingTimeoutMs
    })
    [pscustomobject]@{ ComputerName = $computer; PowerShell = $ps; Handle = $ps.BeginInvoke() }
}

$results = New-Object -TypeName System.Collections.Generic.List[object]
$done = 0
foreach ($job in $jobs) {
    try {
        foreach ($item in $job.PowerShell.EndInvoke($job.Handle)) { $results.Add($item) }
    }
    catch {
        $results.Add([pscustomobject]@{
            ComputerName = $job.ComputerName; Status = 'Error'; Ping = $null; WinRM = $null
            Verified = $null; Actual = $null; Expected = $Expected; Output = $null
            Error = $_.Exception.Message; Seconds = $null
        })
    }
    finally {
        $job.PowerShell.Dispose()
    }
    $done++
    Write-Progress -Activity 'Fleet payload' -Status "$done of $($computers.Count)" -PercentComplete (100 * $done / $computers.Count)
}
Write-Progress -Activity 'Fleet payload' -Completed
$pool.Close()
$pool.Dispose()
$results = $results.ToArray()

$results | Sort-Object -Property Status, ComputerName |
    Format-Table -Property ComputerName, Status, Ping, WinRM, Verified, Seconds -AutoSize
$results | Group-Object -Property Status | Sort-Object -Property Name |
    Format-Table -Property Name, Count -AutoSize

ConvertTo-Json -InputObject @($results) -Depth 3 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Host "Report: $ReportPath"

if (@($results | Where-Object { $_.Status -ne 'Success' }).Count -gt 0) { exit 1 }
exit 0
```

## Result fields

| Field | Meaning |
|---|---|
| `Status` | `Success`, `VerifyFailed`, `Unreachable`, `WinRMFailed` or `Error` |
| `Ping`, `WinRM` | Which preflight checks passed |
| `Verified` | `True` or `False` when a verify script was given, otherwise empty |
| `Actual`, `Expected` | The verify output and what it was compared with |
| `Output` | Payload output as text, cut at 4000 characters |
| `Error` | The first error message, if any |
| `Seconds` | Time spent on that host |

The script exits with `0` when every host is `Success`, and `1` otherwise, so a scheduler can tell.

## Credentials

- Leave out `-Credential` to run as yourself. This is the safest option when your own account has the rights.
- When you need another account, pass `-Credential (Get-Credential)`. The password stays in memory as a `SecureString` and is never written to the report.
- Do not put passwords in the script, the host list or a scheduled task argument. For machines that need different accounts, see [WinRM Credential Fallback](#/scripts/winrm-credential-fallback).

## Limits

- Ping must be allowed through host firewalls. Hosts that block ICMP show as `Unreachable` even when WinRM works. Allow ICMP echo from your admin subnet, or remove the ping step for those networks.
- Output is converted to text. If you need structured data back, have the payload return JSON and parse `Output` afterwards.
- Payloads that reboot the machine end the session. Report back before the reboot, or use a delayed `shutdown.exe /r /t 60`.
- The verify step runs right after the payload. Changes that need a service restart or a reboot to show up need a verify step that accounts for that.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Every host is `Unreachable` | ICMP blocked | Allow ICMP echo from the admin subnet |
| `WinRMFailed` on hosts that worked yesterday | Network profile changed to Public | See [WinRM Stuck on Public Profile](#/windows/winrm-stuck-on-public-profile) |
| `Error` with "Access is denied" | Account is not an admin on the target | Use an account with rights, or a credential chain |
| `VerifyFailed` with the right value | Type or whitespace differences | Compare as text, or use `-VerifyComparison Match` |
