# Exchange Bulk Mailbox Creation

A runbook for creating multiple Exchange mailboxes from a CSV file using PowerShell.

---

## Prerequisites

Before running this script, ensure the following are in place:

- Exchange Management Shell is installed and accessible
- You have **Exchange Admin** or **Organization Management** role
- A CSV file is prepared (see format below)
- PowerShell execution policy is set to `RemoteSigned` or higher

> 💡 **Tip:** Run `Get-ExecutionPolicy` to check your current policy. Set it with `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`.

---

## CSV Format

Your input file must be saved as `mailboxes.csv` with the following columns:

| Column | Required | Example |
|--------|----------|---------|
| DisplayName | ✅ | John Smith |
| Alias | ✅ | jsmith |
| PrimarySmtpAddress | ✅ | jsmith@contoso.com |
| OrganizationalUnit | ✅ | contoso.com/Users/IT |
| Password | ✅ | P@ssword123! |
| ResetPasswordOnLogon | ❌ | TRUE |

### Example CSV

```csv
DisplayName,Alias,PrimarySmtpAddress,OrganizationalUnit,Password,ResetPasswordOnLogon
John Smith,jsmith,jsmith@contoso.com,contoso.com/Users/IT,P@ssword1!,TRUE
Jane Doe,jdoe,jdoe@contoso.com,contoso.com/Users/HR,P@ssword2!,TRUE
```

---

## The Script

```powershell
# ============================================================
# Bulk-Create Exchange Mailboxes from CSV
# Author  : Shad3ious
# Requires: Exchange Management Shell
# ============================================================

param(
    [Parameter(Mandatory)]
    [string]$CsvPath,

    [string]$LogPath = ".\mailbox-creation-$(Get-Date -f 'yyyyMMdd-HHmm').log"
)

# Validate CSV exists
if (-not (Test-Path $CsvPath)) {
    Write-Error "CSV not found: $CsvPath"
    exit 1
}

$records = Import-Csv -Path $CsvPath
$success = 0
$failed  = 0

foreach ($row in $records) {
    try {
        $secPwd = ConvertTo-SecureString $row.Password -AsPlainText -Force

        New-Mailbox `
            -Name              $row.DisplayName `
            -Alias             $row.Alias `
            -PrimarySmtpAddress $row.PrimarySmtpAddress `
            -OrganizationalUnit $row.OrganizationalUnit `
            -Password          $secPwd `
            -ResetPasswordOnLogon ([bool]::Parse($row.ResetPasswordOnLogon)) `
            -ErrorAction Stop

        "$([datetime]::Now) [OK] Created: $($row.PrimarySmtpAddress)" |
            Tee-Object -FilePath $LogPath -Append | Write-Host -ForegroundColor Green

        $success++
    }
    catch {
        "$([datetime]::Now) [FAIL] $($row.PrimarySmtpAddress) — $($_.Exception.Message)" |
            Tee-Object -FilePath $LogPath -Append | Write-Host -ForegroundColor Red

        $failed++
    }
}

Write-Host "`nDone. Created: $success  Failed: $failed  Log: $LogPath"
```

---

## Running the Script

### Step 1 — Open Exchange Management Shell

Launch as Administrator. Do not use a regular PowerShell session — Exchange cmdlets won't be available.

### Step 2 — Run the script

```powershell
.\New-BulkMailbox.ps1 -CsvPath "C:\Scripts\mailboxes.csv"
```

Optionally specify a custom log path:

```powershell
.\New-BulkMailbox.ps1 -CsvPath "C:\Scripts\mailboxes.csv" -LogPath "C:\Logs\mailboxes.log"
```

### Step 3 — Verify creation

```powershell
Get-Mailbox -ResultSize Unlimited | Where-Object { $_.WhenCreated -gt (Get-Date).AddHours(-1) }
```

---

## Troubleshooting

> ⚠️ **Warning:** If you see `The user already exists in Active Directory`, the alias or UPN conflicts with an existing account. Check AD for duplicates before re-running.

**Common errors and fixes:**

- `Access denied` — Ensure you have the Organization Management or Recipient Management role
- `Password does not meet complexity requirements` — Review your domain password policy with `Get-ADDefaultDomainPasswordPolicy`
- `OrganizationalUnit not found` — Verify the OU path with `Get-OrganizationalUnit` in EMS

---

## Cleanup / Rollback

To remove all mailboxes created from a CSV (use with caution):

```powershell
Import-Csv "C:\Scripts\mailboxes.csv" | ForEach-Object {
    Remove-Mailbox -Identity $_.Alias -Confirm:$false
}
```
