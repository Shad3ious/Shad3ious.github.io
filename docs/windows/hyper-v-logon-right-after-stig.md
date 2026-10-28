# Hyper-V Logon Right After STIG

Fix virtual machines that will not start on a hardened Hyper-V host because the VM worker process lost the "Log on as a service" right.

## Applies to

- Hyper-V on Windows Server or Windows client
- Hosts where a security baseline or STIG GPO sets the "Log on as a service" user right

## Symptoms

VMs that ran before the baseline was applied now fail to start with:

```text
'vm01' failed to start worker process: Logon failure: the user has not been granted the requested logon type at this computer. (0x80070569)
```

`0x80070569` is `ERROR_LOGON_TYPE_NOT_GRANTED`. Other Hyper-V features still look healthy.

## Why it happens

Each VM's worker process runs under its own virtual account, and those accounts belong to the group `NT VIRTUAL MACHINE\Virtual Machines` (SID `S-1-5-83-0`). Installing Hyper-V grants that group the "Log on as a service" right (`SeServiceLogonRight`).

A GPO that sets "Log on as a service" replaces the whole list on the host. If the GPO's list does not include the Virtual Machines group, the right is gone after the next policy refresh and no VM can start.

User rights from different GPOs do not merge. The GPO with the highest precedence wins and its list is the entire list.

## Confirm it

On the host:

```powershell
New-Item -Path 'C:\Temp\Example' -ItemType Directory -Force | Out-Null
secedit /export /cfg C:\Temp\Example\rights.inf /areas USER_RIGHTS | Out-Null
Select-String -Path C:\Temp\Example\rights.inf -Pattern '^SeServiceLogonRight'
Remove-Item -Path C:\Temp\Example\rights.inf
```

If the line does not contain `*S-1-5-83-0`, this is the problem. To find which GPO set it:

```powershell
gpresult /scope computer /h C:\Temp\Example\gp.html
```

Open the report and look for "Log on as a service" under User Rights Assignment. The "Winning GPO" column names it.

## Fix

Add `NT VIRTUAL MACHINE\Virtual Machines` to "Log on as a service" in the GPO that applies to your Hyper-V hosts. Do it in a GPO linked only to the Hyper-V hosts' OU, so other servers keep the stricter list.

1. Copy the current list from the winning GPO, including every account the baseline requires.
2. In the Hyper-V host GPO, set `Computer Configuration > Policies > Windows Settings > Security Settings > Local Policies > User Rights Assignment > Log on as a service` to that list plus `NT VIRTUAL MACHINE\Virtual Machines`.
3. Make sure this GPO wins over the baseline GPO for the Hyper-V OU (link order, or link it at the OU while the baseline is linked higher up).

> [!NOTE]
> The Group Policy editor can only resolve `NT VIRTUAL MACHINE\Virtual Machines` on a machine that has the Hyper-V role. If you edit the GPO elsewhere, the name is rejected. Either run the Group Policy Management Console on a Hyper-V host, or add the SID by hand in the GPO's `GptTmpl.inf` file in SYSVOL: append `,*S-1-5-83-0` to the `SeServiceLogonRight` line, then increase the GPO version so clients notice the change.

Editing the local policy on the host works for a test, but the domain GPO overwrites it at the next refresh. Security settings are also reapplied every 16 hours even when nothing changed.

## Apply and test

```powershell
gpupdate /force
Start-VM -Name 'vm01'
Get-VM -Name 'vm01' | Select-Object Name, State
```

Run the `secedit` check again and confirm `*S-1-5-83-0` is in the line.

## Keep it compliant

Granting the right to the Virtual Machines group is what Hyper-V needs to work, but it is still a change to a hardened setting. Write it down as a documented exception for the Hyper-V hosts, with the reason, and have your security team approve it. Check whether the baseline version you use already lists it for Hyper-V hosts; some do.

## Roll back

Remove `NT VIRTUAL MACHINE\Virtual Machines` from the Hyper-V host GPO and run `gpupdate /force`. VMs that are already running keep running; new starts fail again.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| The name is rejected in the GPO editor | Editing from a machine without Hyper-V | Edit on a Hyper-V host, or add `*S-1-5-83-0` to `GptTmpl.inf` |
| Fix works, then breaks a few hours later | A higher-precedence GPO sets the right again | Find the winning GPO with `gpresult` and fix the link order |
| Right is present but VMs still fail with 0x80070005 | A different problem, usually file permissions on the VM folder | Check the VM's folder permissions for the VM's virtual account |
