# WinRM Stuck on Public Profile

Fix domain-joined machines that come up on the Public network profile after a reboot and stop answering WinRM.

## Applies to

- Domain-joined Windows 10, Windows 11 and Windows Server
- WinRM firewall rules scoped to the Domain profile, which is the usual setup when the rules come from Group Policy

## Symptoms

- `Enter-PSSession` or `Invoke-Command` fails after a reboot, but works again after someone signs in or the network cable is replugged.
- `Test-WSMan host01` times out from the admin workstation.
- On the machine itself, `Get-NetConnectionProfile` shows `NetworkCategory : Public` (or `Private`) instead of `DomainAuthenticated`.

## Why it happens

The Network Location Awareness service (NlaSvc) decides which profile a network gets. It marks a network as `DomainAuthenticated` only after it reaches a domain controller.

At boot, NLA can run before the adapter has an address, before DNS answers, or before a slow switch port starts forwarding. If it cannot reach a domain controller at that moment, it picks Public or Private and may not check again. Firewall rules scoped to the Domain profile then stop applying, and WinRM traffic is dropped.

> [!NOTE]
> You cannot set `DomainAuthenticated` yourself. `Set-NetConnectionProfile` only accepts Public and Private. Only Windows can assign the domain profile, after it reaches a domain controller. Do not switch the network to Private as a workaround, and do not widen the WinRM firewall rules to other profiles. Both hide the cause and leave WinRM open on networks where it should be closed.

## Check one machine

Run these on the affected machine, in an elevated session.

```powershell
Get-NetConnectionProfile | Select-Object InterfaceAlias, InterfaceIndex, NetworkCategory
nltest /dsgetdc:contoso.local
```

If `nltest` fails, the problem is DNS or connectivity, not NLA. Fix that first.

## Quick fix

If `nltest` finds a domain controller, restart NLA and check again:

```powershell
Restart-Service -Name NlaSvc -Force
Start-Sleep -Seconds 10
Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory
```

If it still shows Public, restarting the adapter usually works. This drops the connection, so do it from the console, not over a remote session.

```powershell
Restart-NetAdapter -Name 'Ethernet' -Confirm:$false
```

## Durable fix: wait for the network at startup

Make Windows wait for the network before it finishes booting. NLA then runs once the network is actually up.

In a GPO linked to the affected computers, enable:

`Computer Configuration > Policies > Administrative Templates > System > Logon > Always wait for the network at computer startup and logon`

Run `gpupdate /force` on a test machine, reboot it twice, and check the profile after each boot.

> [!TIP]
> If the problem started after a switch change, check whether the access ports run spanning tree without PortFast (or your vendor's equivalent edge-port setting). A port that takes 30 seconds to start forwarding causes exactly this.

## In MDT and other task sequences

Steps that run right after a reboot inside a task sequence can hit the same race. Add a step before anything that needs WinRM or the domain profile, which waits for a domain controller and then restarts NLA:

```bat
@echo off
rem Wait up to 5 minutes for a domain controller, then reclassify the network.
for /L %%i in (1,1,30) do (
    nltest /dsgetdc:contoso.local >nul 2>&1 && goto :found
    timeout /t 10 /nobreak >nul
)
echo No domain controller found after 5 minutes.
exit /b 1
:found
net stop NlaSvc /y
net start NlaSvc
net start netprofm
exit /b 0
```

`net stop NlaSvc /y` also stops the services that depend on it, so the script starts `netprofm` again afterwards.

## Repair script

`Repair-WinRmNetworkProfile_v1.ps1` does the quick fix in a safe order and confirms WinRM afterwards:

1. It checks that the machine is domain-joined and that `nltest` can find a domain controller.
2. It finds the interface used to reach that domain controller, so other adapters (VPN, Hyper-V switches) are left alone.
3. It restarts NLA and waits for that interface to become `DomainAuthenticated`.
4. With `-RestartAdapter`, it restarts the adapter as a last resort.
5. It makes sure the WinRM service is running and set to start automatically, then runs `Test-WSMan` locally.

Run it locally as an administrator. It is not meant to run over WinRM, since WinRM is what is broken.

```powershell
#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Moves a domain-joined machine off the Public network profile so WinRM firewall rules apply again.
.DESCRIPTION
    Finds the interface used to reach a domain controller, restarts the Network Location
    Awareness service, and waits for Windows to classify that network as DomainAuthenticated.
    Optionally restarts the adapter as a last resort. Then checks the WinRM service.
    Run locally, not over a remote session.
.PARAMETER TimeoutSeconds
    How long to wait for the domain profile after each repair step.
.PARAMETER RestartAdapter
    Restart the network adapter if restarting NLA is not enough. Drops the connection briefly.
.EXAMPLE
    .\Repair-WinRmNetworkProfile_v1.ps1
.EXAMPLE
    .\Repair-WinRmNetworkProfile_v1.ps1 -RestartAdapter -TimeoutSeconds 90
.NOTES
    Version: 1
#>
[CmdletBinding()]
param(
    [ValidateRange(10, 600)][int]$TimeoutSeconds = 60,
    [switch]$RestartAdapter
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Wait-DomainProfile {
    param(
        [Parameter(Mandatory = $true)][int]$InterfaceIndex,
        [Parameter(Mandatory = $true)][int]$Seconds
    )
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $current = Get-NetConnectionProfile -InterfaceIndex $InterfaceIndex -ErrorAction SilentlyContinue
        if ($current -and $current.NetworkCategory -eq 'DomainAuthenticated') { return $true }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    return $false
}

$computerSystem = Get-CimInstance -ClassName Win32_ComputerSystem
if (-not $computerSystem.PartOfDomain) { throw 'This computer is not joined to a domain.' }
$domain = $computerSystem.Domain
Write-Host "Domain: $domain"

$nltestOutput = (& nltest.exe "/dsgetdc:$domain" 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) {
    throw "No domain controller found for $domain. Fix DNS or connectivity first.`n$nltestOutput"
}
$match = [regex]::Match($nltestOutput, 'Address:\s*\\\\(\S+)')
if (-not $match.Success) { throw 'Could not read the domain controller address from nltest output.' }
$dcAddress = $match.Groups[1].Value
Write-Host "Domain controller address: $dcAddress"

$route = Find-NetRoute -RemoteIPAddress $dcAddress | Select-Object -First 1
$ifIndex = $route.InterfaceIndex
$netProfile = Get-NetConnectionProfile -InterfaceIndex $ifIndex
Write-Host ('Interface {0} (index {1}) is {2}' -f $netProfile.InterfaceAlias, $ifIndex, $netProfile.NetworkCategory)

if ($netProfile.NetworkCategory -ne 'DomainAuthenticated') {
    Write-Host 'Restarting the Network Location Awareness service.'
    Restart-Service -Name NlaSvc -Force
    $fixed = Wait-DomainProfile -InterfaceIndex $ifIndex -Seconds $TimeoutSeconds

    if (-not $fixed -and $RestartAdapter) {
        Write-Host ('Restarting adapter {0}.' -f $netProfile.InterfaceAlias)
        Restart-NetAdapter -Name $netProfile.InterfaceAlias -Confirm:$false
        $fixed = Wait-DomainProfile -InterfaceIndex $ifIndex -Seconds $TimeoutSeconds
    }

    if (-not $fixed) {
        Write-Warning 'The interface is still not DomainAuthenticated.'
        if (-not $RestartAdapter) { Write-Warning 'Run again with -RestartAdapter, or apply the startup GPO described in the guide.' }
        exit 1
    }
}
Write-Host 'Network profile: DomainAuthenticated'

$winrm = Get-Service -Name WinRM
if ($winrm.StartType -ne 'Automatic') {
    Write-Host 'Setting WinRM to start automatically.'
    Set-Service -Name WinRM -StartupType Automatic
}
if ($winrm.Status -ne 'Running') {
    Write-Host 'Starting WinRM.'
    Start-Service -Name WinRM
}

try {
    $null = Test-WSMan -ComputerName localhost -ErrorAction Stop
    Write-Host 'WinRM answers locally.'
    exit 0
}
catch {
    Write-Warning ('WinRM did not answer locally: {0}' -f $_.Exception.Message)
    exit 1
}
```

## Verify

From the admin workstation:

```powershell
Test-WSMan -ComputerName host01
Invoke-Command -ComputerName host01 -ScriptBlock { Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory }
```

Reboot the machine at least twice and check again. A fix that only lasts until the next boot did not address the cause.

## Roll back

- The script changes nothing permanent except setting WinRM to start automatically. Set it back with `Set-Service -Name WinRM -StartupType Manual` if that was intended.
- To undo the GPO, set "Always wait for the network at computer startup and logon" back to Not Configured.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `nltest` fails | DNS or connectivity problem | Check the DNS servers on the adapter and that the machine can reach a domain controller |
| Profile goes back to Public on every boot | Network not ready when NLA runs | Apply the startup GPO and check switch port settings |
| Profile is DomainAuthenticated but WinRM still fails | Firewall rule or listener missing | Run `winrm enumerate winrm/config/listener` and check the inbound WinRM rules |
| Only one adapter is wrong | A VPN or virtual adapter took the default route | Check the route to the domain controller with `Find-NetRoute` |
