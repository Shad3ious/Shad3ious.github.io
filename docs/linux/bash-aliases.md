# Bash Aliases

Create short names for long commands in Bash, keep them after a reboot, and know when to use a function instead.

## Applies to

- Any Linux system with Bash as the login shell (Debian, Ubuntu, Fedora, RHEL and others)
- A terminal and a text editor such as `nano` or `vim`

## How aliases work

An alias maps a short word to a longer command. When you type the alias, Bash replaces it with the full command before running it.

An alias you define in a terminal lasts until you close that terminal. To keep it, put it in a file Bash reads when it starts.

## Create a temporary alias

```bash
alias d='docker ps --all'
```

It works right away and disappears when the session ends.

## Create a permanent alias

Open `~/.bashrc`:

```bash
nano ~/.bashrc
```

Add the alias at the bottom:

```bash
# Custom aliases
alias d='docker ps --all'
```

Save the file, then load it into the current session:

```bash
source ~/.bashrc
```

New terminals pick it up on their own.

## Keep aliases in their own file

A long list of aliases is easier to manage in a separate file.

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

# Safety
alias sudo='sudo '
alias chown='chown --preserve-root'
alias chmod='chmod --preserve-root'
alias chgrp='chgrp --preserve-root'
```

The safety aliases make `chown`, `chmod` and `chgrp` refuse to run recursively on `/` by mistake. See [Recovering From a Recursive chown](#/linux/recovering-from-a-recursive-chown) for why that matters.

The `sudo` alias looks odd but is needed. Bash only expands an alias in the first word of a command, so `sudo chown` would skip the `chown` alias. When an alias ends in a space, Bash also checks the next word for an alias, so `sudo chown` gets `--preserve-root` too.

Debian and Ubuntu already load `~/.bash_aliases` from the default `~/.bashrc`. On other distributions, add this to the bottom of `~/.bashrc`:

```bash
if [ -f ~/.bash_aliases ]; then
    . ~/.bash_aliases
fi
```

Then run `source ~/.bashrc`.

## Quotes inside aliases

Wrap the command in single quotes. Double quotes inside it are fine:

```bash
alias dps='docker ps --all --format "table {{.Names}}\t{{.Status}}"'
```

To put a single quote inside a single-quoted alias, close the quote, add an escaped quote, and open it again (`'\''`):

```bash
alias greet='echo "it'\''s working"'
```

> [!TIP]
> Single quotes on the outside stop Bash from expanding variables when the alias is defined. That is almost always what you want: `$HOME` or `$(date)` is then read each time the alias runs, not once when the file loads.

## When to use a function instead

An alias cannot take an argument in the middle of a command. This does not do what it looks like:

```bash
alias dlog='docker logs -f $1'   # $1 is ignored
```

Use a function:

```bash
dlog() {
    docker logs -f --tail 100 "$1"
}
```

Functions go in `~/.bashrc` or `~/.bash_aliases` the same way.

> [!WARNING]
> If an alias and a function have the same name, the alias wins, and defining the function can fail with a syntax error. Remove the alias with `unalias name` first.

## Useful commands

| Command | What it does |
|---|---|
| `alias` | Lists all active aliases |
| `alias name='command'` | Creates an alias for this session |
| `unalias name` | Removes an alias from this session |
| `type name` | Shows whether a name is an alias, function, builtin or file |
| `\name` | Runs the real command, skipping an alias with that name |

## Verify

```bash
alias d
```

Expected output:

```text
alias d='docker ps --all'
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Alias not found after adding it | File not reloaded | Run `source ~/.bashrc` |
| Alias gone after reboot | Defined in the terminal, not in a file | Add it to `~/.bashrc` or `~/.bash_aliases` |
| `~/.bash_aliases` not loading | `~/.bashrc` does not source it | Add the `if [ -f ~/.bash_aliases ]` block |
| Alias hides a real command | Name already in use | Check with `type name` and pick another name |
| Quotes break the alias | Unescaped quote inside | Use single quotes outside and `'\''` for inner single quotes |
| Aliases do not work in scripts | Non-interactive shells ignore aliases | Use the full command or a function in scripts |
