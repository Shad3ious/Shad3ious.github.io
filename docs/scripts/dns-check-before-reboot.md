# DNS Check Before Reboot

Make sure the machine you are about to restart is the machine you meant, by checking forward and reverse DNS and asking the machine its own name first.

## Applies to

- Windows PowerShell 5.1 with the DnsClient module (included in Windows 8 and Server 2012 and later)
- Any script that restarts machines by name

## Why

A stale DNS record can point `host01` at an address that now belongs to `host02`. Restart "host01" by name and you restart someone else's machine. Kerberos usually catches this, because `host02` cannot accept a ticket meant for `host01`. But if authentication falls back to NTLM, or you connect by IP, nothing stops it.

Three checks close the gap:

1. **Forward:** the name resolves to exactly one IPv4 address.
2. **Reverse:** that address has a PTR record, and the PTR points back to the same name.
3. **Identity:** a remote session to the name reports the expected computer name.

Restart only when all three pass.

## The check

```powershell
function Test-HostDnsConsistency {
    <#
    .SYNOPSIS
        Checks that a host's A and PTR records agree.
    .DESCRIPTION
        Resolves the name to IPv4 addresses, then resolves each address back to a name.
        Status is Clean only when there is exactly one address and its PTR matches the name.
    .PARAMETER ComputerName
        Short name or FQDN. Short names get DnsSuffix appended.
    .PARAMETER DnsSuffix
        Domain suffix for short names. Defaults to the current user's DNS domain.
    .EXAMPLE
        Test-HostDnsConsistency -ComputerName host01
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ComputerName,
        [string]$DnsSuffix = $env:USERDNSDOMAIN
    )

    if ($ComputerName.Contains('.')) { $fqdn = $ComputerName } else { $fqdn = '{0}.{1}' -f $ComputerName, $DnsSuffix }
    $fqdn = $fqdn.TrimEnd('.').ToLowerInvariant()

    $result = [ordered]@{
        ComputerName = $ComputerName
        Fqdn         = $fqdn
        Addresses    = @()
        PtrNames     = @()
        Status       = 'Unknown'
        Detail       = ''
    }

    try {
        $a = @(Resolve-DnsName -Name $fqdn -Type A -DnsOnly -NoHostsFile -ErrorAction Stop |
            Where-Object { $_.Type -eq 'A' } | Select-Object -ExpandProperty IPAddress -Unique)
    }
    catch {
        $result.Status = 'NoARecord'
        $result.Detail = $_.Exception.Message
        return [pscustomobject]$result
    }
    $result.Addresses = $a

    if ($a.Count -eq 0) { $result.Status = 'NoARecord'; return [pscustomobject]$result }
    if ($a.Count -gt 1) {
        $result.Status = 'MultipleA'
        $result.Detail = 'More than one A record. Remove the stale one before rebooting by name.'
        return [pscustomobject]$result
    }

    try {
        $ptr = @(Resolve-DnsName -Name $a[0] -Type PTR -DnsOnly -NoHostsFile -ErrorAction Stop |
            Where-Object { $_.Type -eq 'PTR' } | ForEach-Object { $_.NameHost.TrimEnd('.').ToLowerInvariant() })
    }
    catch {
        $result.Status = 'NoPtr'
        $result.Detail = 'The address has no PTR record.'
        return [pscustomobject]$result
    }
    $result.PtrNames = $ptr

    if ($ptr.Count -eq 0) {
        $result.Status = 'NoPtr'
        $result.Detail = 'The address has no PTR record.'
    }
    elseif ($ptr -contains $fqdn -and $ptr.Count -eq 1) {
        $result.Status = 'Clean'
    }
    else {
        $result.Status = 'PtrMismatch'
        $result.Detail = 'The address points back to: {0}' -f ($ptr -join ', ')
    }
    [pscustomobject]$result
}
```

`-DnsOnly` and `-NoHostsFile` make sure the answer comes from DNS, not from a hosts file entry or a NetBIOS broadcast that would hide a bad record.

## Reboot only when it is clean

```powershell
function Restart-HostSafely {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)][string]$ComputerName,
        [ValidateRange(0, 3600)][int]$DelaySeconds = 60
    )

    $dns = Test-HostDnsConsistency -ComputerName $ComputerName
    if ($dns.Status -ne 'Clean') {
        Write-Warning ('{0}: {1}. {2} Not rebooting.' -f $ComputerName, $dns.Status, $dns.Detail)
        return $dns
    }

    $session = New-PSSession -ComputerName $dns.Fqdn -ErrorAction Stop
    try {
        $reported = Invoke-Command -Session $session -ScriptBlock { $env:COMPUTERNAME }
        $expected = $dns.Fqdn.Split('.')[0]
        if ($reported -ne $expected) {
            Write-Warning ('{0}: the machine at that address says it is {1}. Not rebooting.' -f $ComputerName, $reported)
            $dns.Status = 'IdentityMismatch'
            return $dns
        }

        if ($PSCmdlet.ShouldProcess($dns.Fqdn, "Restart in $DelaySeconds seconds")) {
            Invoke-Command -Session $session -ScriptBlock {
                param($delay)
                shutdown.exe /r /t $delay /d p:0:0 /c 'Planned restart by IT'
            } -ArgumentList $DelaySeconds
            $dns.Status = 'RestartScheduled'
        }
        return $dns
    }
    finally {
        Remove-PSSession -Session $session -ErrorAction SilentlyContinue
    }
}
```

```powershell
Get-Content -Path .\hosts.txt | ForEach-Object { Restart-HostSafely -ComputerName $_ -WhatIf } |
    Format-Table -Property ComputerName, Status, Addresses, PtrNames, Detail -AutoSize
```

Run it with `-WhatIf` first. Every host that is not `Clean` is a DNS record to fix, whether or not you reboot today.

> [!NOTE]
> `$env:COMPUTERNAME` is the NetBIOS name, which is limited to 15 characters. If your host names are longer, compare against the first 15 characters, or read `(Get-CimInstance Win32_ComputerSystem).DNSHostName` instead.

## Status values

| Status | Meaning | Fix |
|---|---|---|
| `Clean` | One A record, PTR matches | Nothing to fix |
| `NoARecord` | Name does not resolve | Check the name, or register the host in DNS |
| `MultipleA` | More than one address for the name | Delete the stale A record |
| `NoPtr` | Address has no reverse record | Create the PTR, or turn on PTR updates for DHCP clients |
| `PtrMismatch` | Address belongs to a different name | Fix or delete the stale PTR. Check whether the address was reused |
| `IdentityMismatch` | DNS looks fine but a different machine answered | Stop and investigate. Something is answering for that address |

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Every host is `NoPtr` | No reverse lookup zone for that subnet | Create the reverse zone, then let clients or DHCP register PTRs |
| PTR has the right name but a different case or a trailing dot | Formatting only | The function lower-cases and trims both sides |
| `Resolve-DnsName` is not recognized | Running on an old OS or in PowerShell Core on Linux | Run from Windows with the DnsClient module |
