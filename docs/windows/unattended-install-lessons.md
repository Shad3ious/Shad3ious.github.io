# Unattended Install Lessons

Problems that come up when building an `autounattend.xml` for a Windows install from USB, and how to avoid them.

## Applies to

- Windows 10 and Windows 11 installed from USB or ISO with an `autounattend.xml` answer file
- Answer files built with Windows System Image Manager (part of the Windows ADK) or by hand

## Know which pass you are in

Most surprises come from running a command in a pass where the environment is not what you expect.

| Pass | Runs in | Runs as | Good for |
|---|---|---|---|
| windowsPE | Windows Setup's WinPE, before Windows is installed | SYSTEM | Disk layout, picking the image, product key |
| specialize | The installed Windows, before any user exists | SYSTEM | Machine settings, registry under HKLM, copying files |
| oobeSystem (FirstLogonCommands) | The installed Windows, at the first sign-in | The user signing in | Per-user settings for that user |
| `SetupComplete.cmd` | The installed Windows, after setup and before the first sign-in | SYSTEM | Longer scripts, installs |

## Lesson 1: Setup's WinPE has no PowerShell

The WinPE that Windows Setup boots from (`boot.wim` on the install media) does not include PowerShell. A `RunSynchronous` command in the windowsPE pass that calls `powershell.exe` fails, and setup either stops or carries on without the step.

In the windowsPE pass, use what is there: `cmd.exe`, `diskpart`, `reg`, `wpeutil`. Move anything that needs PowerShell to specialize or `SetupComplete.cmd`, where the full OS is running.

## Lesson 2: HKCU under SYSTEM is the wrong user

In specialize and in `SetupComplete.cmd`, commands run as SYSTEM. A `reg add HKCU\...` there writes to SYSTEM's own profile, not to any user. Nothing fails, the setting just never shows up.

Ways to get per-user settings in:

- **Edit the Default user profile** in specialize. Every new profile is copied from it.

  ```bat
  reg load HKU\DefaultUser C:\Users\Default\NTUSER.DAT
  reg add "HKU\DefaultUser\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v HideFileExt /t REG_DWORD /d 0 /f
  reg unload HKU\DefaultUser
  ```

- **Use FirstLogonCommands** in the oobeSystem pass. They run as the user who signs in first, so HKCU is that user.
- **Use Group Policy** for domain-joined machines, which is easier to change later than an image.

Always `reg unload` after `reg load`. A hive left loaded keeps `NTUSER.DAT` locked, and new profiles can fail to load.

## Lesson 3: Do not guess the USB drive letter

The USB drive gets one letter in WinPE and often a different one in the installed OS. Hardcoding `D:\` works on one machine and fails on the next.

Put a marker file in the root of the USB drive (for example `usb-marker.txt`) and search for it:

```bat
@echo off
set "USB="
for %%d in (C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
    if exist %%d:\usb-marker.txt set "USB=%%d:"
)
if not defined USB (
    echo USB drive not found.
    exit /b 1
)
echo USB drive is %USB%
```

Then copy what you need off the USB drive early (in specialize) into a local folder such as `C:\Windows\Setup\Scripts`. Later steps run from the local copy and do not care if the drive was removed or got a new letter.

> [!TIP]
> Files under `sources\$OEM$\$$\` on the install media are copied into `C:\Windows\` during setup. `sources\$OEM$\$$\Setup\Scripts\SetupComplete.cmd` lands in the right place without any copy step. Test it with your media, since it depends on how the media was built.

## Lesson 4: Passwords in the answer file are not encrypted

Account passwords in an answer file are only Base64-encoded, even when `PlainText` is `false`. Anyone with the USB drive can read them.

- Use a temporary password in the answer file and change it with LAPS or a post-install step.
- Keep the USB drive with your other secrets, and wipe old answer files.
- Windows Setup removes password values from the copy it caches in `C:\Windows\Panther`, but not from the USB drive.

## Lesson 5: Test in a VM first

Each change to an answer file means another full install. Do those in a VM.

- Build the answer file in Windows System Image Manager. It validates the XML against the image, which catches typos in component names before you boot anything.
- Put `autounattend.xml` on its own small ISO and attach it as a second DVD drive. Setup searches removable drives for the file, so you can change it without rebuilding the install ISO.
- Take a checkpoint right after the windowsPE pass if you are iterating on later passes.

## Where to look when it fails

| Log | Covers |
|---|---|
| `X:\Windows\Panther\setupact.log` (in WinPE) | windowsPE pass |
| `C:\Windows\Panther\setupact.log` and `setuperr.log` | specialize and later |
| `C:\Windows\Panther\UnattendGC\setupact.log` | `RunSynchronous` commands in specialize and oobeSystem |
| `C:\Windows\Setup\Scripts\` output you redirect yourself | `SetupComplete.cmd` |

Press **Shift+F10** during setup for a command prompt. You can read the logs from there while setup is still running.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| A windowsPE command does nothing | It calls PowerShell | Use `cmd` tools, or move the step to specialize |
| Per-user setting never appears | Written to HKCU as SYSTEM | Edit the Default profile or use FirstLogonCommands |
| Files not found on some machines | Hardcoded drive letter | Search for a marker file |
| Setup ignores the answer file | Wrong file name, or it is not on a drive setup searches | Name it `autounattend.xml` and put it in the root of the USB drive |
| Setup stops with "could not parse or process unattend answer file" | Invalid XML or wrong component for the architecture | Validate in Windows System Image Manager |
