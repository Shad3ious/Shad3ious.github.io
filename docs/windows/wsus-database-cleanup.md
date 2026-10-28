# WSUS Database Cleanup

Shrink a bloated SUSDB and stop the WSUS console from timing out, without declining anything a client still needs.

## Applies to

- WSUS on Windows Server 2016, 2019, 2022 or 2025
- SUSDB on Windows Internal Database (WID) or SQL Server
- Symptoms: the console times out or shows "Reset Server Node", the Server Cleanup Wizard never finishes, or the WsusPool app pool keeps stopping

## Before you start

- Plan a maintenance window. Clients cannot scan while the database is being reindexed or cleaned.
- Close every WSUS console session, including ones on other admin workstations.
- Install `sqlcmd` on the WSUS server if SUSDB runs on WID. WID has no management tools of its own.
- Back up SUSDB. On WID, the WID service account needs write access to the backup folder.

```powershell
# WID on Server 2012 or later. For SQL Server, use your normal backup job instead.
New-Item -Path 'D:\Backup' -ItemType Directory -Force | Out-Null
sqlcmd -S 'np:\\.\pipe\MICROSOFT##WID\tsql\query' -E -Q "BACKUP DATABASE SUSDB TO DISK = N'D:\Backup\SUSDB.bak' WITH INIT"
```

> [!NOTE]
> The order below follows Microsoft's guidance: reindex first so the later steps can finish, then decline, then clean up, then reindex again. See [The complete guide to WSUS and Configuration Manager SUP maintenance](https://support.microsoft.com/help/4490644) for the full reference.

## Step 1: Reindex the database

Download Microsoft's `WsusDBMaintenance.sql` script from the guide linked above and copy it to the server. Run it with quoted identifiers turned on (`-I`), or it fails.

```powershell
# WID
sqlcmd -S 'np:\\.\pipe\MICROSOFT##WID\tsql\query' -E -I -i 'C:\Temp\Example\WsusDBMaintenance.sql'

# SQL Server (default instance on sql01)
sqlcmd -S 'sql01' -E -I -d SUSDB -i 'C:\Temp\Example\WsusDBMaintenance.sql'
```

The first run on a neglected database can take an hour or more. It ends with a line saying statistics have been updated.

## Step 2: Decline superseded updates safely

The built-in cleanup can decline every superseded update at once. That is risky: an update can be superseded and still be the only one a client on an older baseline can install.

The script below only declines an update when all three of these are true:

- It is superseded.
- It arrived more than 30 days ago.
- Zero computers report it as needed (not installed, downloaded, failed or pending reboot).

Anything without summary data is skipped. Run it with `-WhatIf` first.

```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
    Declines superseded WSUS updates that are old and needed by no client.
.DESCRIPTION
    An update is declined only when it is superseded, arrived more than MinAgeDays
    ago, and has a needed count of zero across all computers. Updates with no
    summary data are skipped. Each decline is checked afterwards.
.PARAMETER WsusServer
    WSUS server name. Defaults to the local machine.
.PARAMETER Port
    WSUS port. 8530 for HTTP, 8531 for HTTPS.
.PARAMETER UseSsl
    Connect over HTTPS.
.PARAMETER MinAgeDays
    Only consider updates that arrived at least this many days ago.
.PARAMETER ReportPath
    Text report location.
.EXAMPLE
    .\Decline-SupersededUpdates_v1.ps1 -WhatIf
.EXAMPLE
    .\Decline-SupersededUpdates_v1.ps1 -WsusServer wsus01.contoso.local -Port 8531 -UseSsl
.NOTES
    Version: 1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$WsusServer = $env:COMPUTERNAME,
    [ValidateRange(1, 65535)][int]$Port = 8530,
    [switch]$UseSsl,
    [ValidateRange(0, 3650)][int]$MinAgeDays = 30,
    [string]$ReportPath = (Join-Path -Path $PWD.Path -ChildPath ('DeclineSuperseded_{0}.txt' -f (Get-Date -Format 'yyyyMMdd_HHmmss')))
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Import-Module -Name UpdateServices
$wsus = Get-WsusServer -Name $WsusServer -PortNumber $Port -UseSsl:$UseSsl

$updateScope = New-Object -TypeName Microsoft.UpdateServices.Administration.UpdateScope
$updateScope.ToArrivalDate = (Get-Date).AddDays(-$MinAgeDays)

$computerScope = New-Object -TypeName Microsoft.UpdateServices.Administration.ComputerTargetScope
$computerScope.IncludeDownstreamComputerTargets = $true

Write-Host 'Reading updates. This can take several minutes on a large database.'
$candidates = @($wsus.GetUpdates($updateScope) | Where-Object { $_.IsSuperseded -and -not $_.IsDeclined })
Write-Host ('Superseded and older than {0} days: {1}' -f $MinAgeDays, $candidates.Count)

Write-Host 'Reading per-update summaries.'
$neededById = @{}
foreach ($summary in $wsus.GetSummariesPerUpdate($updateScope, $computerScope)) {
    $needed = $summary.NotInstalledCount + $summary.DownloadedCount + $summary.FailedCount + $summary.InstalledPendingRebootCount
    $neededById[$summary.UpdateId.ToString()] = $needed
}

$results = foreach ($update in $candidates) {
    $id = $update.Id.UpdateId.ToString()
    $action = 'Skipped'
    $reason = ''

    if (-not $neededById.ContainsKey($id)) {
        $reason = 'No summary data'
    }
    elseif ($neededById[$id] -gt 0) {
        $reason = 'Needed by {0} computer(s)' -f $neededById[$id]
    }
    elseif ($PSCmdlet.ShouldProcess($update.Title, 'Decline')) {
        $update.Decline()
        $update.Refresh()
        if ($update.IsDeclined) { $action = 'Declined' } else { $action = 'DeclineFailed' }
        $reason = 'Superseded, old, needed by 0'
    }
    else {
        $action = 'WouldDecline'
        $reason = 'Superseded, old, needed by 0'
    }

    [pscustomobject]@{
        Action      = $action
        ArrivalDate = $update.ArrivalDate.ToString('yyyy-MM-dd')
        Reason      = $reason
        Title       = $update.Title
    }
}

$results = @($results)
$results | Group-Object -Property Action | Sort-Object -Property Name |
    Format-Table -Property Name, Count -AutoSize

$results | Sort-Object -Property Action, ArrivalDate |
    Format-Table -Property Action, ArrivalDate, Reason, Title -AutoSize |
    Out-File -FilePath $ReportPath -Encoding UTF8 -Width 400
Write-Host "Report: $ReportPath"

if (@($results | Where-Object { $_.Action -eq 'DeclineFailed' }).Count -gt 0) { exit 1 }
exit 0
```

Review the `WouldDecline` lines in the report, then run it again without `-WhatIf`.

## Step 3: Run the Server Cleanup Wizard

Run the cleanup from PowerShell instead of the console, which times out on large databases. Leave out `-DeclineSupersededUpdates`, since Step 2 already handled that more carefully.

```powershell
$wsus = Get-WsusServer
$wsus | Invoke-WsusServerCleanup -CleanupObsoleteUpdates
$wsus | Invoke-WsusServerCleanup -CleanupObsoleteComputers -CleanupUnneededContentFiles -CompressUpdates -DeclineExpiredUpdates
```

`-CleanupObsoleteUpdates` is the slow one. It runs on its own so a timeout there does not cost you the rest.

> [!TIP]
> If `-CleanupObsoleteUpdates` times out, run the Step 1 reindex again, then retry. Each pass removes a batch, so a badly bloated database can take several rounds.

## Step 4: Reindex again

Cleanup leaves fragmented indexes behind. Run the Step 1 command one more time.

## Stop WsusPool from crashing

A WsusPool app pool that stops under load usually hits its private memory limit, and rapid-fail protection then keeps it stopped. Remove the limit and turn off rapid-fail protection.

```powershell
Import-Module -Name WebAdministration
Set-ItemProperty -Path 'IIS:\AppPools\WsusPool' -Name 'recycling.periodicRestart.privateMemory' -Value 0
Set-ItemProperty -Path 'IIS:\AppPools\WsusPool' -Name 'failure.rapidFailProtection' -Value $false
Restart-WebAppPool -Name 'WsusPool'
```

## Verify

```powershell
# App pool settings. Expect privateMemory:"0" and rapidFailProtection:"false".
& "$env:windir\System32\inetsrv\appcmd.exe" list apppool 'WsusPool' /text:* |
    Select-String -Pattern 'privateMemory|rapidFailProtection'

# Number of declined updates. It should have gone up after Step 2.
$scope = New-Object -TypeName Microsoft.UpdateServices.Administration.UpdateScope
$scope.ApprovedStates = [Microsoft.UpdateServices.Administration.ApprovedStates]::Declined
(Get-WsusServer).GetUpdateCount($scope)
```

Open the WSUS console. The Updates node should load without a timeout.

## Roll back

- A declined update can be approved again from the console. Nothing in Step 2 deletes updates.
- Cleanup and reindex cannot be undone. Restore the SUSDB backup if something goes wrong.
- To put the app pool back, set `privateMemory` to its old value and `rapidFailProtection` to `$true`.

## Keep it clean

- Every month after Patch Tuesday, run the decline script with `-WhatIf`, review the report, then run it for real.
- Run the cleanup cmdlets every month.
- Reindex at least once a month.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `sqlcmd` cannot connect to WID | Wrong pipe name | Use `\\.\pipe\MICROSOFT##WID\tsql\query` on Server 2012 and later |
| Reindex fails with a QUOTED_IDENTIFIER error | Missing `-I` | Add `-I` to the `sqlcmd` command |
| Script times out on `GetUpdates` | Database not reindexed yet | Do Step 1 first |
| Backup fails with access denied | WID cannot write to the folder | Grant `NT SERVICE\MSSQL$MICROSOFT##WID` modify rights on the backup folder |
| Cleanup times out every time | Very large backlog | Repeat reindex and cleanup in rounds |
