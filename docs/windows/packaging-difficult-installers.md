# Packaging Difficult Installers

Get a vendor installer that ignores silent switches into a Chocolatey package that installs the same way every time.

## Applies to

- Chocolatey packages built in-house, with the installer embedded in the package
- Vendor `setup.exe` files that wrap an MSI, show prerequisite dialogs, or refuse to run silently

## Before you start

- A test VM you can revert, matching the OS your fleet runs
- [Orca](https://learn.microsoft.com/en-us/windows/win32/msi/orca-exe) from the Windows SDK, or the PowerShell function further down, to read MSI tables
- The vendor's install documentation, if there is any. Check it for silent switches before you take anything apart.

The examples use a made-up product, `Example App`, with an installer called `ExampleApp_x64.exe`.

## Find out what the installer is

Most stubborn `setup.exe` files are a bootstrapper around one or more MSIs. If you can get the MSI out, you can install it with `msiexec` and control every option.

Try the options in this order:

1. **Ask it.** Run `ExampleApp_x64.exe /?`, `/help` and `-h`. Some print their switches.
2. **WiX Burn bundles** support a layout switch that copies every payload into a folder: `ExampleApp_x64.exe -layout C:\Temp\Example\Extract`
3. **InstallShield** bootstrappers can usually extract with an administrative install (`ExampleApp_x64.exe /a`) or cache the MSI to a folder (`ExampleApp_x64.exe /b"C:\Temp\Example\Extract"`). Cancel the wizard once the MSI appears.
4. **Grab it from TEMP.** Start the installer interactively and leave the first wizard page open. Look in `%TEMP%` and its subfolders for a fresh `.msi` and any `.cab` files next to it. Copy them out, then cancel.
5. **Open it as an archive.** 7-Zip can open many self-extracting installers directly.

Keep every `.msi`, `.cab` and `.mst` that came out together. An MSI with external cabinets will not install without them.

## Read the MSI before you install it

Two tables tell you most of what you need: `Property` (default values and the product code) and `LaunchCondition` (what must be true before it will install).

This function reads any table with the Windows Installer COM object. It works in Windows PowerShell 5.1 without extra modules.

```powershell
function Get-MsiTableRows {
    <#
    .SYNOPSIS
        Returns the rows of one MSI table as objects.
    .EXAMPLE
        Get-MsiTableRows -Path .\ExampleApp.msi -Table LaunchCondition -Columns Condition, Description
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_]+$')][string]$Table,
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_]+$')][string[]]$Columns
    )
    $fullPath = (Resolve-Path -LiteralPath $Path).Path
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($fullPath, 0))
    $query = 'SELECT {0} FROM `{1}`' -f (($Columns | ForEach-Object { '`' + $_ + '`' }) -join ', '), $Table
    $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @($query))
    [void]$view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null)
    try {
        while ($true) {
            $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
            if ($null -eq $record) { break }
            $row = [ordered]@{}
            for ($i = 0; $i -lt $Columns.Count; $i++) {
                $row[$Columns[$i]] = $record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, @($i + 1))
            }
            [pscustomobject]$row
        }
    }
    finally {
        [void]$view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($view)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($db)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
    }
}
```

```powershell
Get-MsiTableRows -Path .\ExampleApp.msi -Table LaunchCondition -Columns Condition, Description
Get-MsiTableRows -Path .\ExampleApp.msi -Table Property -Columns Property, Value |
    Where-Object { $_.Property -in 'ProductCode', 'ProductVersion', 'ALLUSERS' }
```

## Launch conditions that require the bootstrapper

A common blocker: you run the extracted MSI and it says it must be started from `setup.exe`. The `LaunchCondition` table shows why. It checks for a property that only the bootstrapper sets, such as `SETUPEXEDIR` or `ISSETUPDRIVEN`.

Set that property yourself on the command line:

```powershell
msiexec.exe /i ExampleApp.msi SETUPEXEDIR=1 /qn /norestart /l*v C:\Temp\Example\ExampleApp-install.log
```

Check the rest of the launch conditions too. If one requires a prerequisite, install that prerequisite first instead of bypassing the check.

## Prerequisites and their dialogs

Bootstrappers often check for prerequisites like the Visual C++ runtime and show a dialog even in silent mode, even when the runtime is already installed. Installing the MSI directly skips that check entirely, so you control the prerequisite yourself:

- Install the prerequisite first, silently, as its own step.
- Treat its "already installed" and "reboot needed" exit codes as success. For the Visual C++ redistributable, that is `0`, `3010` and `1638` (a newer version is already installed).

## Transforms (MST files)

A transform changes an MSI's tables at install time. Vendors sometimes ship one, and sometimes ship one that was never finished.

- Open the MSI in Orca, then use Transform > Apply Transform to view the changes. Changed rows are highlighted.
- Look in the `Property` table for placeholder values such as `CHANGEME`, `SERVERNAME` or `example`. A half-built transform installs fine and then points the app at a server that does not exist.
- If only a few properties need to change, set them on the `msiexec` command line instead of maintaining a transform.

## The package

Put the installer files in the package's `tools` folder so nothing is downloaded at install time.

```
example-app/
  example-app.nuspec
  tools/
    chocolateyInstall.ps1
    chocolateyUninstall.ps1
    vc_redist.x64.exe
    ExampleApp.msi
    ExampleApp.cab
```

`chocolateyInstall.ps1`:

```powershell
$ErrorActionPreference = 'Stop'
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Prerequisite first
$prereq = @{
    PackageName    = 'example-app-vcredist'
    FileType       = 'exe'
    File64         = Join-Path -Path $toolsDir -ChildPath 'vc_redist.x64.exe'
    SilentArgs     = '/install /quiet /norestart'
    ValidExitCodes = @(0, 1638, 3010)
}
Install-ChocolateyInstallPackage @prereq

# Then the MSI, with the property the launch condition needs
$logPath = Join-Path -Path $env:TEMP -ChildPath 'ExampleApp-install.log'
$app = @{
    PackageName    = $env:ChocolateyPackageName
    FileType       = 'msi'
    File64         = Join-Path -Path $toolsDir -ChildPath 'ExampleApp.msi'
    SilentArgs     = "/qn /norestart SETUPEXEDIR=1 /l*v `"$logPath`""
    ValidExitCodes = @(0, 1641, 3010)
}
Install-ChocolateyInstallPackage @app
```

Use `File64` for 64-bit installers. Chocolatey picks it on 64-bit systems and refuses to install it on 32-bit ones.

## Verify

Check what Windows thinks is installed, not just the exit code:

```powershell
$uninstallKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
Get-ItemProperty -Path $uninstallKeys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'Example App*' } |
    Select-Object DisplayName, DisplayVersion, PSChildName
```

`PSChildName` is the product code for MSI installs. Use it in `chocolateyUninstall.ps1`:

```powershell
$ErrorActionPreference = 'Stop'
$productCode = '{00000000-0000-0000-0000-000000000000}'   # from the Property table or the check above
Start-ChocolateyProcessAsAdmin -Statements "/x $productCode /qn /norestart" -ExeToRun 'msiexec.exe' -ValidExitCodes @(0, 1605, 1614, 1641, 3010)
```

`1605` means the product is not installed, which is fine for an uninstall.

## Scripts that wrap choco

If a deployment tool runs your own PowerShell around `choco`, capture the exit code right away and pass it on explicitly. A misspelled variable does not cause an error in PowerShell. It creates a new, empty variable, and the step reports the wrong result or waits on a value that never arrives.

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

choco upgrade example-app -y --no-progress
$chocoExitCode = $LASTEXITCODE

if ($chocoExitCode -notin 0, 1641, 3010) {
    throw "choco exited with $chocoExitCode"
}
exit $chocoExitCode
```

`Set-StrictMode -Version Latest` turns reads of variables that were never set into errors, which catches most of these typos. It does not catch a misspelled name on the left side of an assignment, like `$ErrorActionPrefernce = 'Stop'`, so read those lines twice.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| MSI says to run `setup.exe` | Launch condition on a bootstrapper property | Read `LaunchCondition` and set the property on the command line |
| Error 1603 with no clear reason | Many possible causes | Read the verbose log from `/l*v` and search for `Return value 3` |
| Error 1311 or a missing cabinet | External `.cab` not next to the MSI | Copy every file that was extracted with the MSI |
| App installs but cannot reach its server | Placeholder value in a transform | Check the transform's `Property` table |
| Prerequisite dialog appears in silent mode | Bootstrapper prerequisite check | Install the prerequisite yourself and install the MSI directly |
