# Offline Chocolatey Repository

Run Chocolatey on a network with no internet access, using an internal repository and packages that carry their own installers.

## Applies to

- Chocolatey CLI 2.x on Windows clients and servers
- Networks with no route to the internet, or ones where clients must not download from it
- Any NuGet-compatible repository manager, or a plain file share

## How it fits together

1. On an internet-connected staging machine, download each package and the installers it needs, and rebuild the package so the installers are inside it ("internalizing").
2. Move the finished `.nupkg` files across with a hash manifest.
3. Push them to the internal repository.
4. Point every client at the internal repository and remove the public one.

## Choose a repository

| Option | Good for | Notes |
|---|---|---|
| File share (`\\fileserver01\choco`) | Small fleets, quick start | No API keys or versions UI. Clients read with their computer account. |
| Repository server (NuGet hosted repo) | Most fleets | Push with an API key, per-repo permissions, search works well |

On a repository server, create a hosted NuGet repository for packages, and a second one for anything that should be restricted (admin tools, licensed software) with authentication required. Use HTTPS with a certificate from your internal CA, and make sure clients trust that CA.

## Internalize packages

Most community packages download their installer from the vendor at install time, which fails offline. Internalizing moves that download to the staging machine.

> [!NOTE]
> Chocolatey for Business can do this automatically with `choco download --internalize`. The manual steps below work with the open-source CLI.

1. Download the package itself. A `.nupkg` is a zip file.

   ```powershell
   $id = 'example-app'
   $version = '1.2.3'
   Invoke-WebRequest -UseBasicParsing -Uri "https://community.chocolatey.org/api/v2/package/$id/$version" -OutFile "C:\Temp\Example\$id.$version.zip"
   Expand-Archive -Path "C:\Temp\Example\$id.$version.zip" -DestinationPath "C:\Temp\Example\$id"
   ```

2. Open `tools\chocolateyInstall.ps1` and find the download URLs and checksums.
3. Download each installer into the `tools` folder and check its hash against the checksum in the script.
4. Change the install call to use the local file. `Install-ChocolateyPackage -Url ...` becomes `Install-ChocolateyInstallPackage -File ...` (or `-File64`), pointing at `$toolsDir`.
5. Delete the files NuGet adds to a package and that `choco pack` does not want back: `_rels`, `package`, and `[Content_Types].xml`.
6. Pack it again:

   ```powershell
   choco pack "C:\Temp\Example\$id\$id.nuspec" --output-directory C:\Temp\Example\Out
   ```

7. Install it on an offline test VM before you trust it.

Packages you build yourself (see [Packaging Difficult Installers](#/windows/packaging-difficult-installers)) are already internal.

## Move packages across

Write a manifest with a SHA-256 hash for every file before it leaves the staging machine, and check it on the other side. The [Offline Defender Updates](#/windows/offline-defender-updates) guide has a script that does both.

## Push to the repository

```powershell
# Ask for the API key so it never lands in a script or in command history
$apiKey = Read-Host -Prompt 'Repository API key' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKey)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    Get-ChildItem -Path C:\Temp\Example\Out -Filter *.nupkg | ForEach-Object {
        choco push $_.FullName --source 'https://repo01.contoso.local/repository/choco-hosted/' --api-key $plain
    }
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Variable -Name plain -ErrorAction SilentlyContinue
}
```

The key is still visible in the process list while `choco push` runs, so push from a staging machine that only admins use.

For a file share, copy the `.nupkg` files into the share instead.

## Install Chocolatey itself offline

The usual install command downloads from the internet. Instead:

1. Download `chocolatey.<version>.nupkg` on the staging machine and push it to the internal repository like any other package.
2. Follow Chocolatey's [organizational deployment guide](https://docs.chocolatey.org/en-us/guides/organizations/organizational-deployment-guide), which covers installing from an internal URL.
3. Deploy the install script to clients with your existing tooling or a GPO startup script.

## Configure clients

```powershell
# Add the internal source and remove the public one
choco source add --name='internal' --source='https://repo01.contoso.local/repository/choco-hosted/' --priority=1
choco source remove --name='chocolatey'

# Restricted repository, used only when asked for by name
choco source add --name='internal-admin' --source='https://repo01.contoso.local/repository/choco-admin/' --priority=2 --user='svc-automation' --password='<entered at deploy time>'
```

Chocolatey stores source passwords encrypted in its config file, but anyone with admin rights on the machine can read that file. Give the account read access to that one repository and nothing else.

Chocolatey checks every enabled source on install and upgrade, in priority order. To pin a package to one source, name it:

```powershell
choco install example-admin-tool -y --source='internal-admin'
```

## Verify

```powershell
choco source list
choco search example-app --source='internal'
choco install example-app -y --source='internal' --whatif
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Install tries to reach the internet | Package not internalized | Check `chocolateyInstall.ps1` for `-Url` and replace it with a local file |
| `Unable to load the service index` or TLS errors | Client does not trust the repository certificate | Deploy the internal CA certificate to the clients |
| `401 Unauthorized` on push | Wrong API key or the account lacks deploy rights | Check the key and the repository's permissions |
| Package found by search but install fails | `_rels` or `package` folders left in the repacked package | Remove them and run `choco pack` again |
| A client still uses the public feed | Old source not removed | Run `choco source list` and remove it |
