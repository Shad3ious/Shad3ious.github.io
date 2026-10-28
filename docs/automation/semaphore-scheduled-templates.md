# Semaphore Scheduled Templates

Set up Semaphore UI so admins can run approved Windows playbooks from a dropdown, and so compliance checks run on a schedule without anyone clicking anything.

## Applies to

- Semaphore UI 2.x (open source), running in a container or on a Linux host
- Windows targets managed over WinRM (see [Ansible on Windows with Kerberos](#/automation/ansible-on-windows-with-kerberos))
- Playbooks kept in a Git repository

Menu names move around a little between Semaphore versions. The concepts below stay the same.

## How Semaphore fits together

| Piece | What it holds | Example |
|---|---|---|
| Key Store | Secrets, stored encrypted by Semaphore | Git deploy key, Windows service account login |
| Repository | Where playbooks come from | `git@git01.contoso.local:ops/windows-playbooks.git` |
| Inventory | Which hosts, and which login to use for them | `windows` group with FQDNs |
| Variable Group | Non-secret extra variables | `{"choco_source": "internal"}` |
| Template | One playbook plus the pieces above, with optional survey questions | "Install approved software" |
| Schedule | A cron expression attached to a template | Every Wednesday at 06:00 |

## Set up the project

1. **Key Store:** add a read-only deploy key for the repository, and a "login with password" entry for the Windows service account. Nobody running a template ever sees the password.
2. **Repository:** add the Git URL with the deploy key. If the Git server uses an internal CA, the Semaphore container must trust that CA, or every clone fails.
3. **Inventory:** a static inventory with the WinRM connection variables from the Kerberos guide, using the service account login from the Key Store as its credentials.
4. **Variable Group:** anything shared by several templates that is not a secret.

Keep playbooks in Git, not in Semaphore. Every change then has a history and a reviewer.

## Approved software from a dropdown

Survey variables turn a template into a small form. An **Enum** survey variable shows a dropdown with a fixed list of values, which is a simple way to control what can be installed: if a package is not in the list, nobody can pick it.

Create the template with two survey variables:

- `target`: Enum, the inventory groups people are allowed to pick
- `package`: Enum, the approved Chocolatey package IDs

`install_approved_package_v1.yml`:

```yaml
# Version: 1
# Synopsis: Installs one approved Chocolatey package from the internal source.
# Usage: Semaphore template with Enum survey variables "target" and "package".
- name: Install approved package
  hosts: "{{ target }}"
  gather_facts: false
  tasks:
    - name: Check the package name
      ansible.builtin.assert:
        that:
          - package is defined
          - package is match('^[a-z0-9][a-z0-9.-]{0,99}$')
        fail_msg: "Package name is missing or not allowed."

    - name: Install the package
      ansible.windows.win_command:
        argv:
          - choco.exe
          - install
          - "{{ package }}"
          - -y
          - --no-progress
          - "--source={{ choco_source | default('internal') }}"
      register: choco
      changed_when: "'already installed' not in choco.stdout"
      failed_when: choco.rc not in [0, 1641, 3010]
```

Two layers protect the command line:

- The Enum list limits what can be chosen in the UI.
- The `assert` and the `argv` form protect against anything that gets past the UI, for example an API call. `argv` passes each argument separately, so a value cannot add extra arguments or commands.

## A scheduled compliance check

`service_compliance_v1.yml` makes sure required services are set to start automatically and are running:

```yaml
# Version: 1
# Synopsis: Makes sure required Windows services are automatic and running.
# Usage: Semaphore template with Enum survey variable "target", scheduled weekly.
- name: Service compliance
  hosts: "{{ target | default('windows') }}"
  gather_facts: false
  vars:
    required_services:
      - ExampleAgent
      - ExampleForwarder
  tasks:
    - name: Ensure required services are automatic and running
      ansible.windows.win_service:
        name: "{{ item }}"
        start_mode: auto
        state: started
      loop: "{{ required_services }}"
```

Create two templates from the same playbook:

- **Report only:** add `--check` to the template's CLI arguments. Ansible reports what it would change and changes nothing. A host where the service is missing shows up as failed.
- **Enforce:** no extra arguments. Stopped services get started.

## Scheduling

Add a schedule to the template with a cron expression:

| Cron | Runs |
|---|---|
| `0 6 * * 3` | Wednesdays at 06:00 |
| `30 5 * * 1-5` | Weekdays at 05:30 |
| `0 */4 * * *` | Every 4 hours |

The schedule runs with the template's default values, so give survey variables like `target` a default. Check the time zone of the Semaphore server or container, since that is the clock the schedule follows.

## Make it fast

- `gather_facts: false` unless the playbook uses facts. Fact gathering is often the slowest part of a Windows run.
- Raise `forks` in `ansible.cfg` in the repository, for example to 25 or 50, so more hosts run at the same time.
- Use `strategy: free` for checks where hosts do not depend on each other. Fast hosts finish without waiting for slow ones.
- Prefer modules (`win_service`, `win_regedit`) over `win_shell`. They do less work and report changes correctly.
- Keep the inventory clean. Hosts that are offline cost a full connection timeout each.

## Keep it safe

- Give people the Semaphore role they need. Most users only need to run tasks, not edit templates or the Key Store.
- Never print secrets. Add `no_log: true` to any task that handles a password.
- Review playbook changes in Git before they reach the branch Semaphore pulls from.
- Log in to Semaphore with directory accounts (LDAP) so access follows your existing account lifecycle.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Clone fails with a certificate error | Container does not trust the internal CA | Add the CA certificate to the container's trust store |
| Kerberos errors only inside Semaphore | Container has no `krb5.conf`, or a different one | Mount the same `krb5.conf` the control node uses |
| Schedule runs at the wrong hour | Server time zone differs from yours | Check the container's time zone setting |
| Scheduled run fails with an undefined variable | Survey variable has no default | Give every survey variable used by a schedule a default |
| Template shows `changed` every run | `win_command` cannot tell if it changed anything | Set `changed_when`, or use a module that reports state |
