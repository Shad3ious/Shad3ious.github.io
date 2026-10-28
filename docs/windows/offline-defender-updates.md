# Offline Defender Updates

Carry Microsoft Defender Antivirus updates across an air gap on removable media, check them on both sides, and have clients pull them from a file share.

## Applies to

- Microsoft Defender Antivirus on Windows 10, Windows 11 and Windows Server 2016 or later
- Networks with no internet access, where updates move on removable media
- x64 and x86 clients

## What gets moved

| Update | File | Where it comes from |
|---|---|---|
| Security intelligence (full package, includes the engine) | `mpam-fe.exe` | Downloaded by the script below, one per architecture |
| Delta and network inspection files (optional) | `mpam-d.exe`, `nis_full.exe` | Microsoft's `SignatureDownloadCustomTask.ps1` script on the PowerShell Gallery, if your clients need them |
| Platform (antimalware client) | `updateplatform.amd64fre_*.exe` | Microsoft Update Catalog, KB4052623 |

The full package on its own is enough to update definitions and the engine. Add the others only if you have a reason to.

## How it works

One script lives on the USB drive and has two modes:

- **Stage**, on an internet-connected machine: downloads `mpam-fe.exe` for each architecture onto the USB drive, checks the Microsoft signatures, scans the folder with Defender, and writes a manifest with a SHA-256 hash for every file.
- **Import**, on the offline side: checks every file against the manifest before copying anything, copies the files to the update share, and checks the hashes again at the destination.

If a single hash does not match, Import copies nothing.

## The script

Save it as `Sync-DefenderUpdates_v1.ps1` in the root of the USB drive.

```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
    Stages Defender updates onto removable media, or imports them to an update share.
.DESCRIPTION
    Stage mode downloads mpam-fe.exe for each architecture into the payload folder,
    checks Microsoft signatures, scans the folder with Defender, and writes manifest.json
    with SHA-256 hashes for every file in the payload.
    Import mode checks every file against the manifest first, then copies the payload to
    the destination and checks each hash again there. Nothing is copied if any check fails.
.PARAMETER Mode
    Stage or Import.
.PARAMETER PayloadPath
    Folder that holds the payload. Defaults to DefenderPayload next to this script.
.PARAMETER Destination
    Update share for Import mode, for example \\fileserver01\defender.
.PARAMETER Architecture
    Architectures to download in Stage mode.
.EXAMPLE
    .\Sync-DefenderUpdates_v1.ps1 -Mode Stage
.EXAMPLE
    .\Sync-DefenderUpdates_v1.ps1 -Mode Import -Destination \\fileserver01\defender
.NOTES
    Version: 1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Stage', 'Import')][string]$Mode,
    [string]$PayloadPath = (Join-Path -Path $PSScriptRoot -ChildPath 'DefenderPayload'),
    [string]$Destination,
    [ValidateSet('x64', 'x86')][string[]]$Architecture = @('x64', 'x86')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$manifestName = 'manifest.json'
$downloadUrl = 'https://go.microsoft.com/fwlink/?LinkID=121721&arch={0}'

function Get-RelativePath {
    param([string]$Root, [string]$FullName)
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    return $FullName.Substring($rootFull.Length)
}

function Get-PayloadFiles {
    param([string]$Root)
    Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object { $_.Name -ne $manifestName }
}

if ($Mode -eq 'Stage') {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -Path $PayloadPath -ItemType Directory -Force | Out-Null

    foreach ($arch in $Architecture) {
        $archDir = Join-Path -Path $PayloadPath -ChildPath $arch
        New-Item -Path $archDir -ItemType Directory -Force | Out-Null
        $target = Join-Path -Path $archDir -ChildPath 'mpam-fe.exe'
        Write-Host "Downloading $arch security intelligence package."
        Invoke-WebRequest -UseBasicParsing -Uri ($downloadUrl -f $arch) -OutFile $target
    }

    $files = @(Get-PayloadFiles -Root $PayloadPath)
    foreach ($file in $files | Where-Object { $_.Extension -eq '.exe' }) {
        $sig = Get-AuthenticodeSignature -FilePath $file.FullName
        if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
            throw "Signature check failed for $($file.FullName): $($sig.Status)"
        }
    }
    Write-Host 'Signatures: all executables are validly signed by Microsoft.'

    $mpCmdRun = Join-Path -Path $env:ProgramFiles -ChildPath 'Windows Defender\MpCmdRun.exe'
    & $mpCmdRun -Scan -ScanType 3 -File $PayloadPath -DisableRemediation | Out-Null
    switch ($LASTEXITCODE) {
        0 { Write-Host 'Defender scan: no threats found.' }
        2 { throw 'Defender scan found a threat in the payload. Do not carry it across.' }
        default { throw "Defender scan did not complete (exit code $LASTEXITCODE)." }
    }

    $entries = foreach ($file in $files) {
        [pscustomobject]@{
            Path        = Get-RelativePath -Root $PayloadPath -FullName $file.FullName
            Bytes       = $file.Length
            Sha256      = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            FileVersion = $file.VersionInfo.FileVersion
        }
    }
    $manifest = [pscustomobject]@{
        CreatedUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        Files      = @($entries)
    }
    $manifestPath = Join-Path -Path $PayloadPath -ChildPath $manifestName
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding ASCII
    $entries | Format-Table -Property Path, FileVersion, Bytes -AutoSize
    Write-Host "Manifest written: $manifestPath"
    exit 0
}

# Import
if (-not $Destination) { throw 'Import mode needs -Destination.' }
$manifestPath = Join-Path -Path $PayloadPath -ChildPath $manifestName
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "No manifest at $manifestPath." }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Write-Host ('Manifest created {0} with {1} file(s).' -f $manifest.CreatedUtc, @($manifest.Files).Count)

# 1. Check everything before copying anything
$problems = New-Object -TypeName System.Collections.Generic.List[string]
foreach ($entry in $manifest.Files) {
    $source = Join-Path -Path $PayloadPath -ChildPath $entry.Path
    if (-not (Test-Path -LiteralPath $source)) { $problems.Add("Missing: $($entry.Path)"); continue }
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ($hash -ne $entry.Sha256) { $problems.Add("Hash mismatch: $($entry.Path)") }
}
$listed = @($manifest.Files | ForEach-Object { $_.Path })
foreach ($file in Get-PayloadFiles -Root $PayloadPath) {
    $rel = Get-RelativePath -Root $PayloadPath -FullName $file.FullName
    if ($listed -notcontains $rel) { $problems.Add("Not in manifest: $rel") }
}
if ($problems.Count -gt 0) {
    $problems | ForEach-Object { Write-Warning $_ }
    throw 'Payload failed verification. Nothing was copied.'
}
Write-Host 'Payload matches the manifest.'

foreach ($entry in $manifest.Files | Where-Object { $_.Path -like '*.exe' }) {
    $sig = Get-AuthenticodeSignature -FilePath (Join-Path -Path $PayloadPath -ChildPath $entry.Path)
    if ($sig.Status -ne 'Valid') {
        Write-Warning ('Signature status for {0}: {1}. Offline machines often cannot check revocation; the hash check above is the deciding check.' -f $entry.Path, $sig.Status)
    }
}

# 2. Copy, then check again at the destination
foreach ($entry in $manifest.Files) {
    $source = Join-Path -Path $PayloadPath -ChildPath $entry.Path
    $target = Join-Path -Path $Destination -ChildPath $entry.Path
    New-Item -Path (Split-Path -Parent $target) -ItemType Directory -Force | Out-Null
    $temp = "$target.copying"
    Copy-Item -LiteralPath $source -Destination $temp -Force
    Move-Item -LiteralPath $temp -Destination $target -Force
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($hash -ne $entry.Sha256) { throw "Hash mismatch after copy: $target" }
    Write-Host "Copied and verified: $($entry.Path)"
}
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path -Path $Destination -ChildPath $manifestName) -Force
Write-Host 'Import complete.'
exit 0
```

Every file in the payload folder ends up in the manifest, so anything you add by hand (the platform update, delta files) is checked the same way. Remove anything you do not want to carry across before you run Stage.

## Set up the update share

Clients read the share as SYSTEM, which means with their computer account. Give a computer group read access and keep everyone else out.

```powershell
New-Item -Path 'D:\Shares\Defender' -ItemType Directory -Force | Out-Null

icacls 'D:\Shares\Defender' /inheritance:r `
    /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' `
    'CONTOSO\GG-Example-Admins:(OI)(CI)M' 'CONTOSO\GG-Example-Computers:(OI)(CI)RX'

New-SmbShare -Name 'defender' -Path 'D:\Shares\Defender' `
    -FullAccess 'BUILTIN\Administrators' -ChangeAccess 'CONTOSO\GG-Example-Admins' `
    -ReadAccess 'CONTOSO\GG-Example-Computers'
```

The share root holds the architecture folders: `\\fileserver01\defender\x64\mpam-fe.exe` and `\\fileserver01\defender\x86\mpam-fe.exe`. Point clients at the root. Defender adds the architecture folder itself.

> [!NOTE]
> A computer picks up a new group membership only when it gets a new Kerberos ticket, usually at the next restart. To skip the restart, run `klist -li 0x3e7 purge` on the client as an administrator.

## Point clients at the share

In a GPO, under `Computer Configuration > Policies > Administrative Templates > Windows Components > Microsoft Defender Antivirus > Security Intelligence Updates`:

| Setting | Value |
|---|---|
| Define file shares for downloading security intelligence updates | `\\fileserver01\defender` |
| Define the order of sources for downloading security intelligence updates | `FileShares` |

The same thing in PowerShell, for a single test machine:

```powershell
Set-MpPreference -SignatureDefinitionUpdateFileSharesSources '\\fileserver01\defender' -SignatureFallbackOrder 'FileShares'
```

## Update and check a client

```powershell
Update-MpSignature -UpdateSource FileShares
Get-MpComputerStatus | Select-Object AntivirusSignatureVersion, AntivirusSignatureLastUpdated, AMEngineVersion, AMProductVersion
```

`AntivirusSignatureVersion` should match the `FileVersion` of `mpam-fe.exe` in the manifest. To update and check many machines at once, run the same two commands with [Fleet Command Runner](#/scripts/fleet-command-runner) or from a scheduled Ansible job (see [Semaphore Scheduled Templates](#/automation/semaphore-scheduled-templates)).

## Platform updates

The platform update is a separate installer. Download KB4052623 from the Microsoft Update Catalog on the staging machine, add it to the payload folder before you run Stage, and then either import it into WSUS or run it on each client with your deployment tool. Check the result with `AMProductVersion`.

## Roll back

- Definitions: `& "$env:ProgramFiles\Windows Defender\MpCmdRun.exe" -RemoveDefinitions` goes back to the previous set.
- Client settings: set the GPO values back to Not Configured, or run `Set-MpPreference -SignatureFallbackOrder` with your previous order.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `Update-MpSignature` fails at once | Files not in `x64` or `x86` subfolders | Put each architecture in its own folder under the share root |
| Update fails with access denied | Computer account cannot read the share | Check the group membership, purge tickets or restart, check share and NTFS rights |
| Path set to `\\...\x64` and updates fail | Architecture folder added to the path | Point at the share root only |
| Signature status not `Valid` on the offline side | Revocation cannot be checked offline | Expected. The manifest hash is the deciding check |
| Import says "Not in manifest" | A file was added after Stage | Run Stage again, or remove the extra file |
