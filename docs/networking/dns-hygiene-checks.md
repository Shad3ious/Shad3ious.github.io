# DNS Hygiene Checks

Find stale, duplicate and mismatched records in an Active Directory DNS zone before they cause a failed login, a broken Kerberos ticket or a reboot of the wrong machine.

## Applies to

- Windows Server DNS with Active Directory-integrated zones
- Windows PowerShell 5.1 with the DnsServer module (RSAT DNS Server Tools), and optionally the ActiveDirectory module
- An account that can read the DNS server, such as a member of DnsAdmins

## What goes wrong

DNS in a Windows domain is mostly written by clients and DHCP, and nothing removes old records unless aging and scavenging are set up. Over time you get:

| Problem | Effect |
|---|---|
| Stale A records | A name still points at an address that now belongs to another machine |
| Missing or wrong PTR records | Reverse lookups fail or return the wrong name, which confuses tools and logs |
| One address with several names | Two machines claim the same address, or old names were never removed |
| One name with several addresses | Clients get a random answer, half of them wrong |
| CNAMEs pointing at nothing | Aliases that fail to resolve |
| Records for deleted or disabled computers | Leftovers from machines that are gone |

## The checks

`Get-DnsHygieneReport_v1.ps1` is read-only. It changes nothing in DNS.

| Check | Severity | Flags |
|---|---|---|
| `AgingOff` | Info | Aging is not enabled on the zone |
| `StaleRecord` | Warning | A dynamic A record not refreshed in `StaleDays` days |
| `MultipleA` | Info | A name with more than one IPv4 address |
| `DuplicateIp` | Warning | An address used by more than one name |
| `MissingPtr` | Info | An A record whose address has no PTR record |
| `PtrMismatch` | Warning | The address's PTR points to a different name |
| `OrphanPtr` | Info | A PTR to a name in this zone that has no matching A record |
| `DanglingCname` | Warning | A CNAME pointing at a name in this zone that does not exist |
| `NotInAd`, `DisabledInAd` | Info, Warning | With `-CheckActiveDirectory`: no computer account, or a disabled one |

Static records have no timestamp and are never reported as stale.

## The allowlist

Some findings are expected: a cluster name sharing an address with its nodes, a load-balanced name with several addresses. List those in a text file so they stop showing up.

```text
# allowlist.txt
# One pattern per line. Wildcards (*, ?) are allowed.
# "Check:pattern" applies to one check only. A bare pattern applies to every check.
DuplicateIp:10.0.0.50
MultipleA:app.contoso.local
*cluster*
NotInAd:printer*
```

Patterns are matched against both the record name and its data (the address, or the list of names for `DuplicateIp`). Suppressed findings are counted in the report so nothing disappears silently.

## The script

```powershell
#Requires -Version 5.1
#Requires -Modules DnsServer
<#
.SYNOPSIS
    Reports stale, duplicate and mismatched records in one forward DNS zone.
.DESCRIPTION
    Read-only. Compares A, CNAME and PTR records, checks zone aging, and optionally
    compares names with Active Directory computer accounts. Findings matching the
    allowlist are counted but not shown. Writes a JSON report.
.PARAMETER ZoneName
    Forward lookup zone to check, for example contoso.local.
.PARAMETER DnsServer
    DNS server to query. Defaults to the local machine.
.PARAMETER StaleDays
    Dynamic records older than this are reported as stale.
.PARAMETER AllowListPath
    Optional allowlist file. See the guide for the format.
.PARAMETER CheckActiveDirectory
    Also compare record names with AD computer accounts. Needs the ActiveDirectory module.
.PARAMETER ReportPath
    JSON report location.
.EXAMPLE
    .\Get-DnsHygieneReport_v1.ps1 -ZoneName contoso.local -DnsServer dc01 -AllowListPath .\allowlist.txt
.NOTES
    Version: 1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ZoneName,
    [string]$DnsServer = $env:COMPUTERNAME,
    [ValidateRange(1, 3650)][int]$StaleDays = 30,
    [string]$AllowListPath,
    [switch]$CheckActiveDirectory,
    [string]$ReportPath = (Join-Path -Path $PWD.Path -ChildPath ('DnsHygiene_{0}.json' -f (Get-Date -Format 'yyyyMMdd_HHmmss')))
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$zone = $ZoneName.TrimEnd('.').ToLowerInvariant()
$cutoff = (Get-Date).AddDays(-$StaleDays)
$skipPattern = '^(@|domaindnszones|forestdnszones)$|(^|\.)_'
$findings = New-Object -TypeName System.Collections.Generic.List[object]

function Add-Finding {
    param([string]$Check, [string]$Severity, [string]$Name, [string]$Data, [string]$Detail)
    $findings.Add([pscustomobject]@{ Check = $Check; Severity = $Severity; Name = $Name; Data = $Data; Detail = $Detail })
}

function Get-Fqdn {
    param([string]$HostName)
    if ($HostName -eq '@') { return $zone }
    return ('{0}.{1}' -f $HostName, $zone).ToLowerInvariant()
}

function Add-ToMap {
    param([hashtable]$Map, [string]$Key, [string]$Value)
    if (-not $Map.ContainsKey($Key)) { $Map[$Key] = New-Object -TypeName System.Collections.Generic.List[string] }
    if (-not $Map[$Key].Contains($Value)) { $Map[$Key].Add($Value) }
}

function Test-InZone {
    param([string]$Name)
    return ($Name -eq $zone -or $Name.EndsWith('.' + $zone))
}

# Allowlist
$allow = @()
if ($AllowListPath) {
    $allow = @(foreach ($line in Get-Content -LiteralPath $AllowListPath) {
        $entry = $line.Trim()
        if (-not $entry -or $entry.StartsWith('#')) { continue }
        if ($entry -match '^([A-Za-z]+):(.+)$') {
            [pscustomobject]@{ Check = $Matches[1]; Pattern = $Matches[2].Trim() }
        } else {
            [pscustomobject]@{ Check = '*'; Pattern = $entry }
        }
    })
}

# Zone aging
$aging = Get-DnsServerZoneAging -ComputerName $DnsServer -Name $ZoneName
if (-not $aging.AgingEnabled) {
    Add-Finding -Check 'AgingOff' -Severity 'Info' -Name $zone -Data '' -Detail 'Aging is off, so stale dynamic records are never scavenged.'
}

# Forward records
Write-Host "Reading A and CNAME records from $ZoneName on $DnsServer."
$ipsByName = @{}
$namesByIp = @{}
foreach ($r in Get-DnsServerResourceRecord -ComputerName $DnsServer -ZoneName $ZoneName -RRType A) {
    if ($r.HostName -match $skipPattern) { continue }
    $fqdn = Get-Fqdn -HostName $r.HostName
    $ip = $r.RecordData.IPv4Address.IPAddressToString
    Add-ToMap -Map $ipsByName -Key $fqdn -Value $ip
    Add-ToMap -Map $namesByIp -Key $ip -Value $fqdn
    if ($null -ne $r.Timestamp -and $r.Timestamp -lt $cutoff) {
        Add-Finding -Check 'StaleRecord' -Severity 'Warning' -Name $fqdn -Data $ip -Detail ('Last refreshed {0:yyyy-MM-dd}' -f $r.Timestamp)
    }
}

$cnameTargets = @{}
foreach ($c in Get-DnsServerResourceRecord -ComputerName $DnsServer -ZoneName $ZoneName -RRType CName) {
    if ($c.HostName -match $skipPattern) { continue }
    $cnameTargets[(Get-Fqdn -HostName $c.HostName)] = $c.RecordData.HostNameAlias.TrimEnd('.').ToLowerInvariant()
}

# Reverse records from every IPv4 reverse zone on the server
Write-Host 'Reading PTR records from reverse lookup zones.'
$ptrsByIp = @{}
$reverseZones = @(Get-DnsServerZone -ComputerName $DnsServer | Where-Object { $_.IsReverseLookupZone -and $_.ZoneName -like '*.in-addr.arpa' })
foreach ($rz in $reverseZones) {
    foreach ($p in Get-DnsServerResourceRecord -ComputerName $DnsServer -ZoneName $rz.ZoneName -RRType Ptr) {
        if ($p.HostName -eq '@') { continue }
        $labels = ('{0}.{1}' -f $p.HostName, $rz.ZoneName).Split('.')
        if ($labels.Count -ne 6) { continue }   # skips classless delegations
        $ip = '{0}.{1}.{2}.{3}' -f $labels[3], $labels[2], $labels[1], $labels[0]
        Add-ToMap -Map $ptrsByIp -Key $ip -Value ($p.RecordData.PtrDomainName.TrimEnd('.').ToLowerInvariant())
    }
}
if ($reverseZones.Count -eq 0) { Write-Warning 'No IPv4 reverse lookup zones found on this server. PTR checks will report every address.' }

# Compare
foreach ($fqdn in $ipsByName.Keys) {
    $ips = $ipsByName[$fqdn]
    if ($ips.Count -gt 1) {
        Add-Finding -Check 'MultipleA' -Severity 'Info' -Name $fqdn -Data ($ips -join ', ') -Detail ('{0} addresses' -f $ips.Count)
    }
    foreach ($ip in $ips) {
        if (-not $ptrsByIp.ContainsKey($ip)) {
            Add-Finding -Check 'MissingPtr' -Severity 'Info' -Name $fqdn -Data $ip -Detail 'No PTR record for this address'
        }
        elseif (-not $ptrsByIp[$ip].Contains($fqdn)) {
            Add-Finding -Check 'PtrMismatch' -Severity 'Warning' -Name $fqdn -Data $ip -Detail ('PTR points to {0}' -f ($ptrsByIp[$ip] -join ', '))
        }
    }
}

foreach ($ip in $namesByIp.Keys) {
    if ($namesByIp[$ip].Count -gt 1) {
        Add-Finding -Check 'DuplicateIp' -Severity 'Warning' -Name $ip -Data ($namesByIp[$ip] -join ', ') -Detail ('{0} names share this address' -f $namesByIp[$ip].Count)
    }
}

foreach ($ip in $ptrsByIp.Keys) {
    foreach ($target in $ptrsByIp[$ip]) {
        if (-not (Test-InZone -Name $target)) { continue }
        if (-not $ipsByName.ContainsKey($target) -or -not $ipsByName[$target].Contains($ip)) {
            Add-Finding -Check 'OrphanPtr' -Severity 'Info' -Name $target -Data $ip -Detail 'PTR has no matching A record'
        }
    }
}

foreach ($alias in $cnameTargets.Keys) {
    $target = $cnameTargets[$alias]
    if ((Test-InZone -Name $target) -and -not $ipsByName.ContainsKey($target) -and -not $cnameTargets.ContainsKey($target)) {
        Add-Finding -Check 'DanglingCname' -Severity 'Warning' -Name $alias -Data $target -Detail 'Target has no A or CNAME record in this zone'
    }
}

if ($CheckActiveDirectory) {
    Import-Module -Name ActiveDirectory
    Write-Host 'Reading computer accounts from Active Directory.'
    $enabledByName = @{}
    foreach ($computer in Get-ADComputer -Filter *) {
        $enabledByName[$computer.Name.ToLowerInvariant()] = [bool]$computer.Enabled
    }
    foreach ($fqdn in $ipsByName.Keys) {
        $short = $fqdn.Split('.')[0]
        if (-not $enabledByName.ContainsKey($short)) {
            Add-Finding -Check 'NotInAd' -Severity 'Info' -Name $fqdn -Data ($ipsByName[$fqdn] -join ', ') -Detail 'No computer account with this name'
        }
        elseif (-not $enabledByName[$short]) {
            Add-Finding -Check 'DisabledInAd' -Severity 'Warning' -Name $fqdn -Data ($ipsByName[$fqdn] -join ', ') -Detail 'Computer account is disabled'
        }
    }
}

# Apply the allowlist
$shown = New-Object -TypeName System.Collections.Generic.List[object]
$suppressed = 0
foreach ($f in $findings) {
    $hit = $false
    foreach ($a in $allow) {
        if (($a.Check -eq '*' -or $a.Check -eq $f.Check) -and ($f.Name -like $a.Pattern -or $f.Data -like $a.Pattern)) { $hit = $true; break }
    }
    if ($hit) { $suppressed++ } else { $shown.Add($f) }
}

$shown | Group-Object -Property Check | Sort-Object -Property Name | Format-Table -Property Name, Count -AutoSize
$shown | Sort-Object -Property Severity, Check, Name | Format-Table -Property Severity, Check, Name, Data, Detail -AutoSize
Write-Host ('{0} finding(s) shown, {1} suppressed by the allowlist.' -f $shown.Count, $suppressed)

$report = [pscustomobject]@{
    Zone         = $zone
    DnsServer    = $DnsServer
    GeneratedUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    StaleDays    = $StaleDays
    Suppressed   = $suppressed
    Findings     = $shown.ToArray()
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Host "Report: $ReportPath"

if (@($shown | Where-Object { $_.Severity -eq 'Warning' }).Count -gt 0) { exit 1 }
exit 0
```

The script exits with `1` when any warning is left after the allowlist, so a scheduled run can alert on it.

## Run it

```powershell
.\Get-DnsHygieneReport_v1.ps1 -ZoneName contoso.local -DnsServer dc01 -AllowListPath .\allowlist.txt
.\Get-DnsHygieneReport_v1.ps1 -ZoneName contoso.local -DnsServer dc01 -CheckActiveDirectory -StaleDays 14
```

The JSON report has the same shape every run. The [Static Reports with a Strict CSP](#/scripts/static-reports-with-a-strict-csp) guide shows how to put a page in front of it.

## Fixing what it finds

- **Stale records and DuplicateIp:** delete the old record after checking which machine really has the address (`ping -a`, the DHCP lease table, or the switch's MAC table). Then set up aging and scavenging so it does not build up again.
- **MissingPtr and PtrMismatch:** create the reverse zone if it is missing. For DHCP clients, set the DHCP server to register both A and PTR records on behalf of clients, with a dedicated account for DNS updates.
- **DanglingCname:** delete the alias, or recreate the target if it is still needed.
- **NotInAd:** many of these are fine (printers, appliances, service names). Add them to the allowlist once you have checked them.

### Aging and scavenging

Turn on aging for the zone first, then wait at least one full no-refresh plus refresh period before you turn on scavenging, so every active client has had a chance to refresh its record:

```powershell
Set-DnsServerZoneAging -ComputerName dc01 -Name 'contoso.local' -Aging $true -NoRefreshInterval 7.00:00:00 -RefreshInterval 7.00:00:00
# Two weeks or more later, on one DNS server only:
Set-DnsServerScavenging -ComputerName dc01 -ScavengingState $true -ScavengingInterval 7.00:00:00
```

> [!WARNING]
> Scavenging deletes records. Run this report first, fix anything that should be static but was registered dynamically (servers, appliances), and make sure DHCP lease times are shorter than the no-refresh plus refresh interval.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `Get-DnsServerResourceRecord` access denied | Account cannot read the DNS server | Use an account in DnsAdmins or with delegated read rights |
| Every address shows `MissingPtr` | Reverse zones on a different server | Point `-DnsServer` at a server that hosts the reverse zones too |
| Many `NotInAd` for real computers | Computer names longer than 15 characters | AD stores the 15-character name. Allowlist them or compare on `DNSHostName` |
| `DanglingCname` for a name with only an AAAA record | The script checks A records only | Add it to the allowlist |
| Cluster or load balancer names flagged | Expected shared addresses | Add them to the allowlist |
