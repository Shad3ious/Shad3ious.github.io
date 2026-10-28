# Vault-Backed Service Accounts

Keep the Ansible service account's password in HashiCorp Vault and fetch it only for the length of a run, so it never sits in an inventory, a script or a shell history.

## Applies to

- HashiCorp Vault with the KV version 2 secrets engine and AppRole authentication
- A Linux Ansible control node with `curl` and `jq`
- Windows targets that Ansible reaches with a domain service account (see [Ansible on Windows with Kerberos](#/automation/ansible-on-windows-with-kerberos))

## How it works

1. The control node holds an AppRole **role ID** and **secret ID**. These let it log in to Vault and do nothing else.
2. A wrapper script logs in, reads the password, and revokes its Vault token right away.
3. The password is handed to `ansible-playbook` in an environment variable that only exists for that one process.
4. The inventory reads the variable. Nothing is written to disk.

## Set up Vault

Store the password:

```bash
vault kv put -mount=kv ansible/winrm username='svc-automation@CONTOSO.LOCAL' password='<set interactively>'
```

To keep the password out of your shell history, run `vault kv put -mount=kv ansible/winrm username=... password=-` and type it on standard input instead.

A policy that can read that one secret and nothing else (`ansible-winrm-read.hcl`):

```hcl
path "kv/data/ansible/winrm" {
  capabilities = ["read"]
}
```

```bash
vault policy write ansible-winrm-read ansible-winrm-read.hcl
```

An AppRole that gets that policy, with short-lived tokens:

```bash
vault auth enable approle
vault write auth/approle/role/ansible-winrm \
    token_policies="ansible-winrm-read" \
    token_ttl=5m token_max_ttl=10m \
    secret_id_ttl=0 token_num_uses=5 \
    secret_id_bound_cidrs="10.0.0.25/32" token_bound_cidrs="10.0.0.25/32"

vault read -field=role_id auth/approle/role/ansible-winrm/role-id
vault write -f -field=secret_id auth/approle/role/ansible-winrm/secret-id
```

- `token_ttl=5m` and `token_num_uses=5` mean a leaked token is useless almost immediately.
- The CIDR bindings (`10.0.0.25` stands in for the control node's address) mean the secret ID only works from the control node.
- `secret_id_ttl=0` means the secret ID does not expire. Rotate it on a schedule anyway, or give it a TTL and automate the renewal.

## Store the AppRole credentials on the control node

```bash
sudo install -d -m 0750 -o root -g ansible /etc/ansible/vault
printf '%s' '<role_id>'   | sudo tee /etc/ansible/vault/role-id   > /dev/null
printf '%s' '<secret_id>' | sudo tee /etc/ansible/vault/secret-id > /dev/null
sudo chown root:ansible /etc/ansible/vault/role-id /etc/ansible/vault/secret-id
sudo chmod 0640 /etc/ansible/vault/role-id /etc/ansible/vault/secret-id
```

Only the account that runs Ansible (in the `ansible` group here) can read them.

## The wrapper script

Save as `run-playbook_v1.sh`:

```bash
#!/usr/bin/env bash
# Version: 1
# Synopsis: Reads the WinRM service account password from Vault and runs ansible-playbook with it.
# Usage: ./run-playbook_v1.sh site.yml [any ansible-playbook arguments]
set -euo pipefail

: "${VAULT_ADDR:?Set VAULT_ADDR, for example https://vault01.contoso.local:8200}"
VAULT_CACERT="${VAULT_CACERT:-/etc/pki/tls/certs/contoso-root-ca.pem}"
ROLE_ID_FILE="${ROLE_ID_FILE:-/etc/ansible/vault/role-id}"
SECRET_ID_FILE="${SECRET_ID_FILE:-/etc/ansible/vault/secret-id}"
SECRET_PATH="${SECRET_PATH:-kv/data/ansible/winrm}"

for f in "$ROLE_ID_FILE" "$SECRET_ID_FILE" "$VAULT_CACERT"; do
    [[ -r "$f" ]] || { echo "Cannot read $f" >&2; exit 1; }
done

token=""
revoke_token() {
    if [[ -n "$token" ]]; then
        printf 'header = "X-Vault-Token: %s"\n' "$token" |
            curl -sS --cacert "$VAULT_CACERT" --config - -X POST \
                "$VAULT_ADDR/v1/auth/token/revoke-self" > /dev/null || true
        token=""
    fi
}
trap revoke_token EXIT

# Log in. The role ID and secret ID go in the request body on stdin, not on the command line.
token="$(
    jq -n --rawfile r "$ROLE_ID_FILE" --rawfile s "$SECRET_ID_FILE" \
        '{role_id: ($r | rtrimstr("\n")), secret_id: ($s | rtrimstr("\n"))}' |
    curl -sS --fail --cacert "$VAULT_CACERT" -X POST --data @- \
        "$VAULT_ADDR/v1/auth/approle/login" |
    jq -r '.auth.client_token'
)"
[[ -n "$token" && "$token" != "null" ]] || { echo "Vault login failed" >&2; exit 1; }

# Read the secret. The token goes in a curl config on stdin so it never shows in the process list.
secret_json="$(
    printf 'header = "X-Vault-Token: %s"\n' "$token" |
    curl -sS --fail --cacert "$VAULT_CACERT" --config - "$VAULT_ADDR/v1/$SECRET_PATH"
)"
revoke_token

WINRM_PASSWORD="$(jq -r '.data.data.password' <<< "$secret_json")"
unset secret_json
[[ -n "$WINRM_PASSWORD" && "$WINRM_PASSWORD" != "null" ]] || { echo "Secret has no password field" >&2; exit 1; }

# Only the ansible-playbook process gets the variable.
WINRM_PASSWORD="$WINRM_PASSWORD" ansible-playbook "$@"
```

Never add `set -x` to this script. It would print the token and the password.

## Use the variable in the inventory

```ini
[windows:vars]
ansible_connection=winrm
ansible_winrm_transport=kerberos
ansible_user=svc-automation@CONTOSO.LOCAL
ansible_password={{ lookup('ansible.builtin.env', 'WINRM_PASSWORD') }}
```

With `ansible_password` set, Ansible runs `kinit` for you and keeps the ticket in a temporary cache for the run.

Run playbooks through the wrapper:

```bash
./run-playbook_v1.sh service_compliance_v1.yml --check
```

## When the run starts somewhere else

If something else starts `ansible-playbook` for you (Semaphore, AWX, a CI runner), you cannot wrap it with a script. Two options:

- Store the password in that tool's own credential store, as described in [Semaphore Scheduled Templates](#/automation/semaphore-scheduled-templates).
- Read it from Vault inside Ansible with the `community.hashi_vault.vault_kv2_get` lookup, using AppRole credentials that the tool provides as environment variables.

## Rotate the password

1. Change the password in Active Directory.
2. Write the new value to Vault with `vault kv put`. KV version 2 keeps the old version, so you can roll back if something was missed.
3. Run a test playbook through the wrapper.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `Vault login failed` | Wrong role or secret ID, or the CIDR binding does not match | Check the files and the control node's address |
| `403 permission denied` when reading | Policy path wrong | KV v2 policies need `kv/data/...`, not `kv/...` |
| `Secret has no password field` | Different key name in Vault | Check with `vault kv get -mount=kv ansible/winrm` |
| Certificate error from `curl` | CA file path wrong | Point `VAULT_CACERT` at your internal root CA |
| Kerberos error after a password change | Old ticket still cached | Run `kdestroy` for the account and try again |
