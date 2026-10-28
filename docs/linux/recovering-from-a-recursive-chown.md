# Recovering From a Recursive chown

Get a Debian or Ubuntu system working again after `chown -R` changed the owner of system files, including when `sudo` itself no longer works.

## Applies to

- Debian, Ubuntu and other distributions that use `apt` and `dpkg`
- A recursive `chown` (or `chmod`) that ran against `/`, `/usr`, `/etc` or `/var` by mistake

## What breaks

A command like `sudo chown -R jdoe:jdoe /` (or a script where an empty variable turned `"$DIR/"` into `/`) changes the owner of every file. Two things then go wrong:

- **Ownership:** system files now belong to a normal user instead of root or their service accounts.
- **setuid bits are gone:** changing the owner of a file clears its setuid and setgid bits. `sudo`, `su`, `passwd` and `pkexec` all depend on setuid, so they stop working even after the owner is fixed.

Typical errors:

```text
sudo: /usr/bin/sudo must be owned by uid 0 and have the setuid bit set
sudo: /etc/sudo.conf is owned by uid 1000, should be 0
```

Services that check their own file permissions (SSH, databases, snapd) refuse to start.

## Decide first: repair or rebuild

> [!WARNING]
> A full repair touches thousands of files and can still miss some. If the machine holds nothing you cannot rebuild (configs in Git, data on another disk, containers defined in Compose files), reinstalling and restoring is often faster and leaves no surprises. Repair is for when rebuilding costs more than the time below.

Either way, **do not reboot yet** if you still have any working shell. Some ways back in only work on the running system.

## Step 1: Get a root shell

`sudo` is broken, so pick whichever of these you can use:

| Option | Needs | How |
|---|---|---|
| An existing root shell | A root session that was open before the mistake | Use it |
| Docker | Your user is in the `docker` group and the daemon is still running | See below |
| Recovery mode | Console access to the machine | GRUB menu > Advanced options > recovery mode > root shell, then `mount -o remount,rw /` |
| Live USB | Console access and a USB stick | Boot the live system, mount the root filesystem, `chroot` into it |

The Docker route works because the Docker daemon runs as root. Mount the host's filesystem into a container and `chroot` into it:

```bash
docker images                      # pick any image that is already on the machine
docker run --rm -it --privileged -v /:/host <image> chroot /host /bin/bash
```

> [!NOTE]
> This is also a reminder that membership in the `docker` group is equivalent to root. Treat it that way when you add people to it.

## Step 2: Give system directories back to root

From the root shell, reset the system directories to `root:root`. Home directories, virtual filesystems and data mounts are left alone.

```bash
for d in /bin /boot /etc /lib /lib32 /lib64 /libx32 /opt /root /sbin /snap /srv /usr /var; do
    if [ -d "$d" ] && [ ! -L "$d" ]; then
        chown -R root:root "$d"
    fi
done
chmod 700 /root
chmod 1777 /tmp /var/tmp
```

This is wrong for some files (anything owned by a service account), which the next steps fix. It is right for the large majority and gets `apt` working again.

## Step 3: Let apt run

`apt` downloads as the `_apt` user, which needs its own folders:

```bash
chown _apt:root /var/cache/apt/archives/partial /var/lib/apt/lists/partial
chmod 700 /var/cache/apt/archives/partial /var/lib/apt/lists/partial
apt-get update
```

## Step 4: Reinstall every package

Reinstalling a package rewrites its files with the owner, group and mode recorded in the package, including setuid bits. Doing it for every installed package fixes everything `dpkg` knows about.

```bash
dpkg-query -W -f='${binary:Package}\n' > /root/packages.txt
: > /root/reinstall-failed.txt
while read -r pkg; do
    apt-get install --reinstall -y -qq "$pkg" > /dev/null 2>&1 || echo "$pkg" >> /root/reinstall-failed.txt
done < /root/packages.txt
wc -l /root/reinstall-failed.txt
```

This takes a while (often an hour or more) and downloads most of the installed system. Packages in `reinstall-failed.txt` are usually ones no longer available from your repositories; check those by hand.

Then let systemd reset the directories it manages (`/run`, `/var/log/journal`, `/var/lib/systemd` and others) to their configured owners and modes:

```bash
systemd-tmpfiles --create
```

## Step 5: Fix what packages do not cover

Files created after install, by you or by a service, are not in any package. Check these by hand:

```bash
# Password files (Debian and Ubuntu layout)
chown root:shadow /etc/shadow /etc/gshadow
chmod 640 /etc/shadow /etc/gshadow

# sudo configuration
chmod 440 /etc/sudoers
chmod 750 /etc/sudoers.d
find /etc/sudoers.d -type f -exec chmod 440 {} +

# SSH host keys
chmod 600 /etc/ssh/ssh_host_*_key

# Logs written by rsyslog
# Debian: rsyslog runs as root
chown root:adm /var/log/syslog /var/log/auth.log /var/log/kern.log 2>/dev/null
# Ubuntu: rsyslog runs as the syslog user, and /var/log is group syslog
chown root:syslog /var/log && chmod 775 /var/log
chown syslog:adm /var/log/syslog /var/log/auth.log /var/log/kern.log 2>/dev/null
```

Run only the block for your distribution.

Home directories: the original command probably made every home directory belong to one user. Give each back to its owner:

```bash
for home in /home/*; do
    user="$(basename "$home")"
    if id "$user" > /dev/null 2>&1; then
        chown -R "$user:$user" "$home"
        chmod 700 "$home/.ssh" 2>/dev/null
        chmod 600 "$home/.ssh/authorized_keys" 2>/dev/null
    fi
done
```

Service and container data: databases and containers often store data as a specific UID (for example 999 or 1000 inside a container). Step 2 made all of it root-owned. For each service:

- Look up the UID it expects in the image or package documentation, or in a backup's file listing.
- Restore that ownership with `chown -R <uid>:<gid>` on its data directory.
- For Docker bind mounts, check `docker compose logs` after starting each stack. Permission errors point straight at the folder to fix.

## Step 6: Find what is left

List files outside home directories that still belong to the user from the original command (`jdoe` here):

```bash
find / -xdev \( -path /home -o -path /proc -o -path /sys \) -prune -o -user jdoe -print | head -50
```

Run it for each mounted filesystem you care about (`-xdev` stays on one). Anything listed is a file to look at.

## Step 7: Restart and test

```bash
reboot
```

After the reboot:

```bash
sudo -v                      # asks for your password, no ownership errors
systemctl --failed           # should be empty, or only things you expect
ssh localhost true           # SSH still accepts you
```

Start each service and container and read its logs for permission errors.

## Prevent it

- Add `--preserve-root` aliases for `chown`, `chmod` and `chgrp`, plus `alias sudo='sudo '` so they apply under `sudo`. See [Bash Aliases](#/linux/bash-aliases).
- In scripts, stop on empty variables: `chown -R app:app "${DATA_DIR:?}/"` exits with an error if `DATA_DIR` is empty, instead of running against `/`.
- Before any recursive change, run `ls` on the exact path you are about to give it.
- Snapshot or back up the system before risky changes, so a mistake is a rollback instead of an afternoon.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `sudo` still complains after Step 2 | setuid bit still missing | Finish Step 4, or run `chmod 4755 /usr/bin/sudo` to get going |
| `apt` warns "Download is performed unsandboxed as root" | `_apt` folders still wrong | Redo Step 3. The warning is harmless but means the folders are wrong |
| `snapd` fails to start | snap data still mixed | After Step 4, run `systemctl restart snapd` and `snap refresh` |
| SSH refuses keys | Home or `.ssh` owned by the wrong user, or too open | Fix ownership and run the `chmod` lines in Step 5 |
| A database will not start | Data owned by root after Step 2 | Restore the service account's ownership on its data directory |
