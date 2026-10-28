# WinRM Credential Fallback

Connect to machines that need different accounts by trying a short list of credentials in order, without locking anyone out.

## Applies to

- Windows PowerShell 5.1 and PowerShell 7
- Fleets where some machines accept your normal admin account and others need a different one (a separate domain, a workgroup machine, a local admin account)

## The idea

For each host, try the current user first, then each credential in the list, and stop at the first one that opens a session. The important part is deciding when to move on and when to stop:

| Error | Meaning | What to do |
|---|---|---|
| Access is denied | The account is valid but has no rights on this host | Try the next credential |
| Logon failure, account locked or disabled | The password is wrong or the account cannot log on | Stop using this credential for every remaining host |
| Anything else (timeout, DNS, no listener) | A problem with the host, not the account | Stop trying this host |

Dropping a credential after a logon failure matters. A wrong password tried against 200 hosts is 200 failed logons against one account, which is more than enough to lock it.

## The function

```powershell
function New-FleetSession {
    <#
    .SYNOPSIS
        Opens a PSSession to one host, trying the current user and then each credential in order.
    .DESCRIPTION
        Moves to the next credential only on Access Denied. On a logon failure, locked or
        disabled account, the credential is reported in BadCredentials so the caller can drop
        it for all remaining hosts. Any other error stops the attempts for this host.
    .PARAMETER ComputerName
        Host to connect to.
    .PARAMETER Credential
        Credentials to try after the current user, in order.
    .PARAMETER SkipCurrentUser
        Do not try the current user first.
    .EXAMPLE
        New-FleetSession -ComputerName host01 -Credential $creds
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ComputerName,
        [System.Management.Automation.PSCredential[]]$Credential = @(),
        [switch]$SkipCurrentUser
    )

    $chain = New-Object -TypeName System.Collections.Generic.List[object]
    if (-not $SkipCurrentUser) { $chain.Add($null) }
    foreach ($c in $Credential) { $chain.Add($c) }

    $attempts = New-Object -TypeName System.Collections.Generic.List[object]
    $bad = New-Object -TypeName System.Collections.Generic.List[string]

    foreach ($cred in $chain) {
        if ($cred) { $label = $cred.UserName } else { $label = '(current user)' }
        $params = @{ ComputerName = $ComputerName; ErrorAction = 'Stop' }
        if ($cred) { $params.Credential = $cred }

        try {
            $session = New-PSSession @params
            return [pscustomobject]@{
                ComputerName   = $ComputerName
                Session        = $session
                UsedCredential = $label
                Attempts       = $attempts.ToArray()
                BadCredentials = $bad.ToArray()
            }
        }
        catch {
            $code = $null
            if ($_.Exception -is [System.Management.Automation.Remoting.PSRemotingTransportException]) {
                $code = $_.Exception.ErrorCode
            }
            $fqid = [string]$_.FullyQualifiedErrorId

            if ($code -eq 5 -or $fqid -like 'AccessDenied,*') {
                $kind = 'AccessDenied'
            }
            elseif ($code -in 1326, 1331, 1909 -or $fqid -like 'LogonFailure,*') {
                $kind = 'BadCredential'
                if ($cred) { $bad.Add($cred.UserName) }
            }
            else {
                $kind = 'HostError'
            }

            $attempts.Add([pscustomobject]@{ Credential = $label; Result = $kind; Message = $_.Exception.Message })
            if ($kind -eq 'HostError') { break }
        }
    }

    [pscustomobject]@{
        ComputerName   = $ComputerName
        Session        = $null
        UsedCredential = $null
        Attempts       = $attempts.ToArray()
        BadCredentials = $bad.ToArray()
    }
}
```

## Using it across many hosts

The caller keeps the list of credentials and removes any that fail with a logon error, so the next host never tries them.

```powershell
$creds = New-Object -TypeName System.Collections.Generic.List[System.Management.Automation.PSCredential]
$creds.Add((Get-Credential -Message 'Second domain admin' -UserName 'OTHERDOMAIN\jdoe'))
$creds.Add((Get-Credential -Message 'Local admin' -UserName '.\localadmin'))

$results = foreach ($computer in Get-Content -Path .\hosts.txt) {
    $attempt = New-FleetSession -ComputerName $computer -Credential $creds.ToArray()

    foreach ($name in $attempt.BadCredentials) {
        Write-Warning "Dropping $name after a logon failure on $computer."
        $creds.RemoveAll({ param($c) $c.UserName -eq $name }) | Out-Null
    }

    if ($attempt.Session) {
        $info = Invoke-Command -Session $attempt.Session -ScriptBlock { $env:COMPUTERNAME }
        Remove-PSSession -Session $attempt.Session
        [pscustomobject]@{ ComputerName = $computer; Status = 'Connected'; Account = $attempt.UsedCredential; Reported = $info }
    }
    else {
        [pscustomobject]@{ ComputerName = $computer; Status = 'Failed'; Account = $null; Reported = ($attempt.Attempts | ForEach-Object { '{0}: {1}' -f $_.Credential, $_.Result }) -join '; ' }
    }
}

$results | Format-Table -AutoSize
```

To use the chain with [Fleet Command Runner](#/scripts/fleet-command-runner), put `New-FleetSession` inside its worker in place of the `New-PSSession` call. Each runspace then needs its own copy of the credential list, so a bad credential is only dropped within that runspace. Keep the list short and check it on a few hosts first.

## Local accounts

- Write local accounts as `.\localadmin` or `host01\localadmin`. A bare `localadmin` is treated as a domain account.
- Remote use of local admin accounts is blocked by default for accounts other than the built-in Administrator (UAC remote restrictions). If a local account gets Access Denied on every host, that is likely the reason. Prefer a domain account with rights on those hosts over relaxing that setting.
- Local accounts only work with NTLM. If the target or your workstation blocks NTLM, use a domain account.

## Keeping credentials between runs

- **Best:** type them each run with `Get-Credential`.
- **Acceptable on your own admin workstation:** save them with `Export-Clixml`. The password is encrypted with Windows DPAPI and can only be read by the same user on the same machine.

  ```powershell
  Get-Credential -UserName 'OTHERDOMAIN\jdoe' -Message 'Second domain admin' | Export-Clixml -Path "$env:USERPROFILE\creds\otherdomain.xml"
  $cred = Import-Clixml -Path "$env:USERPROFILE\creds\otherdomain.xml"
  ```

- **For unattended jobs:** use a secrets vault and fetch the password at run time. See [Vault-Backed Service Accounts](#/automation/vault-backed-service-accounts).

Never put passwords in a script, a host list, a scheduled task argument or a repository.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Account locked after a run | A wrong password was tried on many hosts | Use this pattern so a bad credential is dropped after the first failure |
| Local admin gets Access Denied everywhere | UAC remote restrictions | Use a domain account with rights on those hosts |
| Every attempt is `HostError` | WinRM not reachable | Check the host before blaming the credentials |
| `Import-Clixml` cannot decrypt the file | Different user or machine | Create the file again as the user and on the machine that will read it |
