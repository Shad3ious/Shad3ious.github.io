# Orphaned CBS Update Failures

Fix cumulative updates that fail because the component store points at packages that are no longer there.

## Applies to

- Windows 10, Windows 11 and Windows Server
- Machines built from a shared image, especially one that was "debloated" by removing components with third-party tools or by deleting files from `C:\Windows\WinSxS`

## Symptoms

- The monthly cumulative update downloads, installs to some percentage, then rolls back.
- Windows Update or WSUS reports `0x80070490` (`ERROR_NOT_FOUND`).
- `CBS.log` shows other errors in the same run, such as `0xc015001a` and `0x80070306`.
- Every machine built from the same image fails the same way, while machines built another way install the update fine.

## Why it happens

Component Based Servicing (CBS) keeps a record of every installed package and component in the registry, and the files themselves live in the component store (`WinSxS`). A cumulative update has to find the current version of each component it replaces.

If something removed the files but left the registry entries, or removed the entries but left references to them, CBS finds a package it cannot resolve and stops with "element not found". When that happens in a gold image, every clone inherits the same broken references.

## Diagnose

Look at the end of `CBS.log` right after a failed install:

```powershell
Select-String -Path "$env:windir\Logs\CBS\CBS.log" -Pattern '0x80070490|ERROR_NOT_FOUND|0xc015001a|0x80070306' |
    Select-Object -Last 30 | ForEach-Object { $_.Line }
```

The lines just before the first error usually name the package or component CBS was looking for. Write it down; you will want it if the repair below does not work.

Then ask DISM what it thinks of the store:

```powershell
DISM /Online /Cleanup-Image /ScanHealth
```

`The component store is repairable` means the steps below should work. `No component store corruption detected` with the update still failing points at a missing package registration rather than damaged files, and the same repair still applies.

## Get a matching repair source

DISM needs a source that contains the exact component versions the machine expects. Use installation media for the same build (for example, 26100 for Windows 11 24H2) and the same edition.

```powershell
# Mount the ISO and find the index for your edition
$iso = Mount-DiskImage -ImagePath 'D:\ISO\Windows11_24H2.iso' -PassThru
$drive = ($iso | Get-Volume).DriveLetter
DISM /Get-WimInfo /WimFile:"${drive}:\sources\install.wim"
```

If the media has `install.esd` instead of `install.wim`, use `ESD:` instead of `WIM:` in the next step.

## Fix

Run the repair against the local source only. `/LimitAccess` stops DISM from trying Windows Update, which matters on a network without internet access and avoids a long timeout.

```powershell
# Replace 3 with the index for your edition from the previous step
DISM /Online /Cleanup-Image /RestoreHealth /Source:WIM:"${drive}:\sources\install.wim":3 /LimitAccess
sfc /scannow
```

Restart, then install the cumulative update again from WSUS or Windows Update.

### If RestoreHealth fails with 0x800f081f

`0x800f081f` means the source does not contain the versions DISM needs. Base media is often too old for a machine that has had many cumulative updates. Patch a copy of `install.wim` with the same cumulative update the machine already has, then point DISM at the patched copy.

```powershell
New-Item -Path 'C:\Temp\Example\Mount' -ItemType Directory -Force | Out-Null
Copy-Item -Path "${drive}:\sources\install.wim" -Destination 'C:\Temp\Example\install.wim'
Set-ItemProperty -Path 'C:\Temp\Example\install.wim' -Name IsReadOnly -Value $false

DISM /Mount-Image /ImageFile:C:\Temp\Example\install.wim /Index:3 /MountDir:C:\Temp\Example\Mount
DISM /Image:C:\Temp\Example\Mount /Add-Package /PackagePath:C:\Temp\Example\Updates\windows11.0-kb5xxxxxx-x64.msu
DISM /Unmount-Image /MountDir:C:\Temp\Example\Mount /Commit

DISM /Online /Cleanup-Image /RestoreHealth /Source:WIM:C:\Temp\Example\install.wim:3 /LimitAccess
```

Use the cumulative update that matches the machine's current UBR (see [Windows Build and UBR Numbers](#/windows/windows-build-and-ubr-numbers)).

> [!NOTE]
> On Windows 11 24H2 and later, a cumulative update can depend on an earlier checkpoint update. Put every `.msu` file Microsoft lists for that update in one folder and pass the folder to `/PackagePath`. DISM installs them in the right order.

### If the update still fails

When the store is clean but the update still fails with the same error, the remaining reference is usually in the registry and outside what DISM repairs. The reliable fix at that point is an in-place repair: run `setup.exe` from matching media on the running system and choose to keep files and apps. This rebuilds the component store and keeps installed software and settings.

## Verify

```powershell
DISM /Online /Cleanup-Image /ScanHealth
Get-HotFix | Sort-Object -Property InstalledOn -Descending | Select-Object -First 3
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' | Select-Object CurrentBuild, UBR
```

The UBR should match the cumulative update you just installed.

## Prevent it

- Do not remove components from an image by deleting files in `WinSxS` or editing the servicing registry keys. Use the supported commands instead: `Remove-AppxProvisionedPackage`, `Disable-WindowsOptionalFeature` and `Remove-WindowsCapability`.
- Before you capture a gold image, run `DISM /Online /Cleanup-Image /ScanHealth` on it.
- Deploy the image to a test VM and install the current cumulative update before using it in production. If it fails there, it will fail everywhere.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `0x800f081f` from RestoreHealth | Source is missing the needed versions | Patch a copy of `install.wim` with the current cumulative update |
| `0x800f0906` | DISM tried Windows Update | Add `/LimitAccess` |
| RestoreHealth succeeds, update still fails | Broken registration outside the component store | In-place repair with matching media |
| Only some machines fail | Different image history | Compare which image each machine came from |
