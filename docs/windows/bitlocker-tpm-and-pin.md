# BitLocker TPM and PIN

Turn on BitLocker with a TPM and startup PIN, escrow the recovery key to Active Directory, and find the policy settings that block it.

## Applies to

- Windows 10 and Windows 11 Pro, Enterprise and Education
- Domain-joined machines with a TPM (2.0 preferred) and UEFI firmware
- Recovery keys stored in Active Directory Domain Services

## Before you start

- Run everything below in an elevated PowerShell session on the target machine.
- Make sure the GPO settings in the next section are in place. Without them, adding a PIN fails.
- Suspend or plan around anything that reboots the machine unattended. With a PIN set, every boot waits at the PIN prompt.

## Group Policy settings

All of these are under `Computer Configuration > Policies > Administrative Templates > Windows Components > BitLocker Drive Encryption`.

| Setting | Value |
|---|---|
| Operating System Drives > Require additional authentication at startup | Enabled. Configure TPM startup PIN: **Require startup PIN with TPM**. Configure TPM startup: **Do not allow TPM** or **Allow TPM** (not Require) |
| Operating System Drives > Configure minimum PIN length for startup | Enabled, with the length your policy requires |
| Operating System Drives > Choose how BitLocker-protected operating system drives can be recovered | Enabled. Save recovery information to AD DS. Do not enable BitLocker until recovery information is stored in AD DS |
| Choose drive encryption method and cipher strength (Windows 10 [Version 1511] and later) | Enabled. Operating system drives: **XTS-AES 256-bit** |

> [!WARNING]
> "Configure TPM startup: Require TPM" means TPM-only. With that set, Windows refuses a TPM+PIN protector. This is the most common reason the PIN step fails.

## Check the TPM

```powershell
Get-Tpm | Select-Object TpmPresent, TpmReady, TpmEnabled, TpmActivated, TpmOwned
Get-CimInstance -Namespace 'root\cimv2\Security\MicrosoftTpm' -ClassName Win32_Tpm | Select-Object SpecVersion
```

All five values should be `True`. If `TpmReady` is `False`, run `Initialize-Tpm`; some machines also need TPM enabled in the firmware setup.

## Check the current state

```powershell
Get-BitLockerVolume -MountPoint 'C:' |
    Select-Object VolumeStatus, EncryptionPercentage, EncryptionMethod, ProtectionStatus
(Get-BitLockerVolume -MountPoint 'C:').KeyProtector | Select-Object KeyProtectorType, KeyProtectorId

manage-bde -status C:
```

In the `manage-bde` output, **Conversion Status** tells you whether the whole disk is encrypted (`Fully Encrypted`) or only the used space (`Used Space Only Encrypted`). `Get-BitLockerVolume` reports both as `FullyEncrypted`.

## Check for policy conflicts

The GPO settings above land in `HKLM:\SOFTWARE\Policies\Microsoft\FVE`. Read them directly to see what the machine actually received:

```powershell
$fve = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\FVE' -ErrorAction SilentlyContinue
$fve | Select-Object UseAdvancedStartup, UseTPM, UseTPMPIN, MinimumPIN, EncryptionMethodWithXtsOs, OSActiveDirectoryBackup, OSRequireActiveDirectoryBackup
```

| Value | Meaning | Needed for TPM+PIN |
|---|---|---|
| `UseAdvancedStartup` | Additional authentication at startup is configured | `1` |
| `UseTPM` | TPM-only startup. 0 = do not allow, 1 = require, 2 = allow | `0` or `2` |
| `UseTPMPIN` | TPM+PIN startup. 0 = do not allow, 1 = require, 2 = allow | `1` or `2` |
| `EncryptionMethodWithXtsOs` | 6 = XTS-AES 128, 7 = XTS-AES 256 | `7` |
| `OSActiveDirectoryBackup` | Store recovery info in AD DS | `1` |

If a value is wrong, fix the GPO, not the registry. Local changes under `Policies` are overwritten at the next policy refresh. Use `gpresult /h C:\Temp\Example\gp.html` to find which GPO set the wrong value, then run `gpupdate /force` and check again.

## Turn it on

Add the recovery password first, so a recovery key exists and is escrowed before anything is encrypted. Then turn on BitLocker with the TPM and PIN.

```powershell
$mount = 'C:'

# 1. Recovery password, escrowed to AD DS
$null = Add-BitLockerKeyProtector -MountPoint $mount -RecoveryPasswordProtector
$recovery = (Get-BitLockerVolume -MountPoint $mount).KeyProtector |
    Where-Object { $_.KeyProtectorType -eq 'RecoveryPassword' } | Select-Object -Last 1
Backup-BitLockerKeyProtector -MountPoint $mount -KeyProtectorId $recovery.KeyProtectorId

# 2. TPM and PIN. The PIN is typed, never stored.
$pin = Read-Host -Prompt 'Startup PIN' -AsSecureString
Enable-BitLocker -MountPoint $mount -EncryptionMethod XtsAes256 -TpmAndPinProtector -Pin $pin
```

Without `-UsedSpaceOnly`, `Enable-BitLocker` encrypts the whole disk. Windows runs a hardware test at the next restart, asks for the PIN, and starts encrypting after a successful boot.

> [!NOTE]
> If a GPO sets the encryption method, the GPO wins over `-EncryptionMethod`. Set XTS-AES 256 in the GPO so every machine gets the same method.

## Change the PIN

```powershell
manage-bde -changepin C:
```

It prompts for the new PIN twice. Run it on the machine itself; it does not work over a non-interactive remote session.

## Escrow an existing recovery key

For machines that were encrypted before the AD DS policy existed:

```powershell
(Get-BitLockerVolume -MountPoint 'C:').KeyProtector |
    Where-Object { $_.KeyProtectorType -eq 'RecoveryPassword' } |
    ForEach-Object { Backup-BitLockerKeyProtector -MountPoint 'C:' -KeyProtectorId $_.KeyProtectorId }
```

## Verify

On the machine:

```powershell
Get-BitLockerVolume -MountPoint 'C:' | Select-Object VolumeStatus, EncryptionMethod, ProtectionStatus
(Get-BitLockerVolume -MountPoint 'C:').KeyProtector | Select-Object KeyProtectorType
```

Expect `XtsAes256`, `ProtectionStatus` `On`, and protectors `TpmPin` and `RecoveryPassword`.

From an admin workstation with the ActiveDirectory module, confirm the key is in AD without displaying it:

```powershell
$computer = Get-ADComputer -Identity 'host01'
Get-ADObject -SearchBase $computer.DistinguishedName -Filter "objectClass -eq 'msFVE-RecoveryInformation'" -Properties whenCreated |
    Select-Object Name, whenCreated
```

The object name starts with the date it was created and contains the recovery password ID, which you can match against `KeyProtectorId`.

## Roll back

- `Disable-BitLocker -MountPoint 'C:'` decrypts the drive. The protectors are removed once decryption finishes.
- To change the protector type, change the GPO first, or the next policy refresh puts the requirement back. Then add the new protector, for example `manage-bde -protectors -add C: -tpm`, and confirm with `manage-bde -protectors -get C:` that only the protectors you expect are left.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Adding the TPM+PIN protector fails with a policy error | TPM-only required, or PIN not allowed | Set Configure TPM startup to Allow or Do not allow, and the PIN to Require |
| `Enable-BitLocker` refuses to start | AD DS backup required but not done | Run `Backup-BitLockerKeyProtector` first and check the machine can reach a domain controller |
| PIN shorter than expected is rejected | Minimum PIN length policy | Check `MinimumPIN` in the FVE key |
| Encryption method is XTS-AES 128 | GPO or default won over the parameter | Set the method in the GPO and re-encrypt if it must change |
| Machine boots straight to recovery | Firmware or boot change after encryption | Enter the recovery key, then `Suspend-BitLocker -RebootCount 1` before planned firmware updates |
