# Ansible on Windows with Kerberos

Manage domain-joined Windows machines from a Linux Ansible control node over WinRM, using Kerberos instead of NTLM or Basic authentication.

## Applies to

- A Linux control node (RHEL-family or Debian-family) with Python 3 and Ansible
- Windows targets joined to Active Directory, with WinRM enabled
- The `ansible.windows` and `community.windows` collections

## Why Kerberos

- The password is never sent to the target. The control node gets a ticket from a domain controller and presents that.
- WinRM encrypts the message body with the Kerberos session key, even over HTTP on port 5985. You do not need to allow unencrypted WinRM traffic.
- It works with hardened baselines that turn off Basic authentication and restrict NTLM.

## Install the pieces

Kerberos libraries and build tools first, then the Python packages.

```bash
# RHEL family
sudo dnf install -y krb5-workstation krb5-devel gcc python3-devel

# Debian family
sudo apt-get install -y krb5-user libkrb5-dev gcc python3-dev
```

```bash
python3 -m pip install --user 'pywinrm[kerberos]'
ansible-galaxy collection install ansible.windows community.windows
```

On a network without internet access, download the wheels and collection tarballs on a connected machine (`pip download`, `ansible-galaxy collection download`) and install from those files.

## Configure Kerberos

`/etc/krb5.conf`:

```ini
[libdefaults]
    default_realm = CONTOSO.LOCAL
    dns_lookup_kdc = true
    dns_lookup_realm = false
    rdns = false
    forwardable = true

[domain_realm]
    .contoso.local = CONTOSO.LOCAL
    contoso.local = CONTOSO.LOCAL
```

- The realm is the AD domain name in **upper case**. Lower case is the single most common cause of failures.
- `dns_lookup_kdc = true` finds domain controllers through DNS SRV records, so you do not have to list them.
- `rdns = false` stops Kerberos from using reverse DNS to build the service name. One stale PTR record is otherwise enough to break authentication to a host.

Test it by hand before involving Ansible:

```bash
kinit svc-automation@CONTOSO.LOCAL
klist
```

## Inventory

`inventory.ini`:

```ini
[windows]
host01.contoso.local
host02.contoso.local

[windows:vars]
ansible_connection=winrm
ansible_port=5985
ansible_winrm_scheme=http
ansible_winrm_transport=kerberos
ansible_user=svc-automation@CONTOSO.LOCAL
```

- Use **fully qualified names**. Kerberos tickets are issued for a service name like `HTTP/host01.contoso.local`. An IP address or a short name has no matching service name and fails.
- Do not put `ansible_password` in the inventory. Either run `kinit` first and add `ansible_winrm_kinit_mode=manual` so Ansible uses the existing ticket, or pass the password at run time (see [Vault-Backed Service Accounts](#/automation/vault-backed-service-accounts)).
- For HTTPS on 5986, set `ansible_port=5986`, `ansible_winrm_scheme=https`, and point `ansible_winrm_ca_trust_path` at your internal CA certificate. Keep certificate validation on.

## ansible.cfg

```ini
[defaults]
inventory = inventory.ini
forks = 25
```

`forks` sets how many hosts run at once. The default is 5, which is slow for a fleet. Raise it as far as the control node's memory allows.

## Test

```bash
ansible windows -m ansible.windows.win_ping
ansible windows -m ansible.windows.win_shell -a 'whoami; hostname'
```

A first playbook:

```yaml
- name: Report OS build
  hosts: windows
  gather_facts: false
  tasks:
    - name: Read build and UBR
      ansible.windows.win_reg_stat:
        path: HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion
        name: UBR
      register: ubr

    - name: Show it
      ansible.builtin.debug:
        msg: "UBR {{ ubr.value }}"
```

## The double hop

A task that reaches a network share or another server from the target fails with Access Denied, because the target cannot pass your credentials on. To allow it for specific tasks:

- Set `ansible_winrm_kerberos_delegation=true` and make sure the ticket is forwardable (`forwardable = true` in `krb5.conf`, as above).
- Or use `become: true` with `become_method: runas` on that task, which logs on locally on the target.

Delegation lets the target act as the service account anywhere the account has rights. Use it only on the tasks that need it.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Server not found in Kerberos database` | IP or short name in inventory, or a missing SPN | Use FQDNs. Check with `setspn -L host01` on a Windows machine |
| `Clock skew too great` | Time differs by more than 5 minutes | Sync the control node to the domain time source |
| `Cannot find KDC for realm` | Realm in lower case, or DNS cannot find the SRV records | Fix the realm case, check `dig _kerberos._tcp.contoso.local SRV` |
| `kerberos: authGSSClientStep() failed` | No valid ticket | Run `kinit`, or provide the password at run time |
| Access Denied when the task reads a share | Double hop | Use delegation or `runas` for that task |
| Works for some hosts, fails for others | Stale DNS, wrong SPN, or the host's clock | Check the failing host's DNS records and time |
