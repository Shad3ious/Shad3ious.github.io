This guide covers how to create custom command aliases in Bash on Ubuntu (or any Linux distro using Bash). By the end, you'll have persistent aliases that survive reboots and a clean way to manage them.

## Prerequisites

- A Linux system running Bash (Ubuntu, Debian, Fedora, etc.)
- Access to a terminal
- A text editor (`nano`, `vim`, or whatever you prefer)

## How Aliases Work

An alias maps a short keyword to a longer command. When you type the alias, Bash expands it to the full command before running it.

Aliases defined in your terminal session are temporary. They disappear when you close the window. To make them permanent, you add them to a config file that Bash loads on startup.

## Creating a Temporary Alias

Run the `alias` command directly in your terminal:

```bash
alias d='docker ps --all'
```

This works immediately but only lasts until you close the session.

## Creating a Permanent Alias

### Edit Your Bash Config

Open `~/.bashrc` in your editor:

```bash
nano ~/.bashrc
```

Scroll to the bottom and add your alias:

```bash
# Custom aliases
alias d='docker ps --all'
```

Save the file and exit.

### Reload the Config

Bash doesn't pick up changes to `~/.bashrc` automatically. Reload it:

```bash
source ~/.bashrc
```

The alias is now active and will persist across new terminal sessions and reboots.

## Using a Separate Alias File

If you have a lot of aliases, keeping them all in `~/.bashrc` gets messy. A cleaner approach is to put them in their own file.

### Create the Alias File

```bash
touch ~/.bash_aliases
```

Add your aliases there:

```bash
nano ~/.bash_aliases
```

```bash
# Docker
alias d='docker ps --all'
alias dcu='docker compose up -d'
alias dcd='docker compose down'
alias dlog='docker logs -f'

# Navigation
alias ..='cd ..'
alias ...='cd ../..'

# System
alias update='sudo apt update && sudo apt upgrade -y'
alias ports='sudo ss -tulnp'
```

### Load It From .bashrc

Most Ubuntu installs already include this block in `~/.bashrc`:

```bash
if [ -f ~/.bash_aliases ]; then
    . ~/.bash_aliases
fi
```

If yours doesn't have it, add it to the bottom of `~/.bashrc`. This tells Bash to load your alias file on every new session.

Reload to apply:

```bash
source ~/.bashrc
```

## Aliases With Flags and Quotes

Wrap the command in single quotes. If the command itself contains single quotes, use double quotes on the outside:

```bash
alias d='docker ps --all --format "table {{.Names}}\t{{.Status}}"'
```

If you need both types of quotes, escape the inner single quotes:

```bash
alias greet='echo "it'\''s working"'
```

> 💡 Tip: Single quotes on the outside prevent Bash from expanding variables at definition time. This is what you want in most cases.

## Aliases vs Functions

Aliases can't accept arguments in the middle of a command. If you need that, use a Bash function instead.

This won't work as an alias:

```bash
alias dlog='docker logs -f $1'   # $1 does nothing here
```

Use a function instead:

```bash
dlog() {
    docker logs -f "$1"
}
```

Add functions to `~/.bashrc` or `~/.bash_aliases` the same way.

> ⚠️ Warning: If an alias and a function share the same name, the alias takes priority. Remove the alias first if you're switching to a function.

## Useful Commands

| Command | What It Does |
|---------|-------------|
| `alias` | Lists all active aliases |
| `alias name='command'` | Creates a temporary alias |
| `unalias name` | Removes an alias from the current session |
| `type name` | Shows whether a name is an alias, function, or binary |

## Verification

Check that your alias is loaded:

```bash
alias d
```

Expected output:

```plaintext
alias d='docker ps --all'
```

You can also use `type`:

```bash
type d
```

```plaintext
d is aliased to 'docker ps --all'
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Alias not found after adding it | `~/.bashrc` hasn't been reloaded | Run `source ~/.bashrc` |
| Alias works but disappears after reboot | Alias was set in the terminal, not in a file | Add it to `~/.bashrc` or `~/.bash_aliases` |
| `~/.bash_aliases` not loading | Missing loader block in `~/.bashrc` | Add the `if [ -f ~/.bash_aliases ]` block |
| Alias conflicts with an existing command | Name collides with a binary or builtin | Run `type name` to check, pick a different name |
| Quotes break the alias | Mismatched or unescaped quotes | Wrap in single quotes, escape inner quotes with `'\''` |
