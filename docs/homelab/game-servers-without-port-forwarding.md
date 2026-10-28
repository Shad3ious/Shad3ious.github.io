# Game Servers Without Port Forwarding

Let friends join a game server you host at home without opening ports on your router, and keep the server locked down while you do it.

## Applies to

- A Linux host running Docker and Docker Compose
- Dedicated game servers that use UDP, TCP or both
- Home connections behind CGNAT, or routers where you would rather not forward ports

The examples use a placeholder image (`example/game-server`) and port (`7777/udp`). Swap in the image and ports your game's server documentation gives.

## Pick an approach

| Approach | How friends connect | Exposure | Good when |
|---|---|---|---|
| Mesh VPN (WireGuard, Tailscale, Headscale) | Each friend joins your private network | Nothing public at all | Friends are willing to install a client |
| UDP-capable tunnel service | A public address the service gives you | Only the game port, through the provider | Friends should just type an address |
| Port forward on your router | Your public IP | The port is open to the whole internet | You have a public IPv4 and accept the exposure |

A mesh VPN is the most private option, because nothing is reachable from the internet. A tunnel is the easiest for friends. Port forwarding is listed for completeness; it shows your home IP to every player and every scanner.

## Why UDP matters

Many game servers use UDP. A lot of tunnel services only carry HTTP or TCP, and a game that needs UDP fails to connect through them, often with no useful error. Before you set anything up, check two things:

- Which protocols and ports your game server uses (its documentation lists them).
- That the tunnel service supports UDP. Some do, for example playit.gg. Many do not.

## Layout

Run the game server and the tunnel agent as separate Compose projects. Updating or restarting one does not touch the other, and the agent can serve several games.

```text
~/stacks/
  game/
    compose.yaml
    .env
    data/
  tunnel/
    compose.yaml
    .env
```

## The game server

`~/stacks/game/compose.yaml`:

```yaml
services:
  game:
    image: example/game-server:1.2.3      # pin a version, never :latest
    container_name: game
    restart: unless-stopped
    env_file: .env
    ports:
      - "7777:7777/udp"                   # LAN players connect here
    volumes:
      - ./data:/data
    security_opt:
      - no-new-privileges:true
    mem_limit: 8g
    networks:
      - games

networks:
  games:
    name: games
```

`~/stacks/game/.env` (game settings only, never committed to a repository):

```text
SERVER_NAME=Example Server
SERVER_PASSWORD=change-me
PUBLIC_LISTING=false
MAX_PLAYERS=8
```

The variable names differ for every game. Look for settings that:

- **Require a password** to join.
- **Turn off the public server list.** Friends join by address; there is no reason to advertise the server.
- **Limit player count** to the people you expect.

## The tunnel agent

`~/stacks/tunnel/compose.yaml`:

```yaml
services:
  tunnel:
    image: example/tunnel-agent:1.0.0     # your provider's agent image, pinned
    container_name: tunnel
    restart: unless-stopped
    env_file: .env
    security_opt:
      - no-new-privileges:true
    networks:
      - games

networks:
  games:
    external: true
```

`~/stacks/tunnel/.env`:

```text
AGENT_SECRET=<from your tunnel provider>
```

Protect that file:

```bash
chmod 600 ~/stacks/tunnel/.env ~/stacks/game/.env
```

Because both containers are on the `games` network, the tunnel can reach the server at `game:7777` without that port being published anywhere else. In the provider's dashboard, point the tunnel at that name and port, or at the host's LAN address if the provider requires an IP.

Some agents' setup guides use `network_mode: host`. Avoid it if the agent works without it; host networking gives the container the host's whole network stack.

## Start and check

```bash
docker network create games 2>/dev/null || true
(cd ~/stacks/game && docker compose up -d)
(cd ~/stacks/tunnel && docker compose up -d)

docker compose -f ~/stacks/game/compose.yaml ps
docker logs --tail 50 game
docker logs --tail 50 tunnel
```

Connect from the LAN first. Once that works, connect through the tunnel address from a phone hotspot or ask a friend, so you test from outside your network.

## Keep it locked down

- **Pin image versions** and read the changelog before you update.
- **Run as a non-root user** inside the container if the image supports it (`user: "1000:1000"` or an image-specific `PUID`/`PGID` setting).
- **Do not mount the Docker socket** into either container.
- **Keep secrets in `.env` files** with mode 600, outside any Git repository.
- **Use an allowlist** if the game supports one, in addition to the password.
- **Update the host.** The tunnel removes the open port, not the need to patch.
- **Watch the logs** for join attempts you do not recognize, and change the password if you see them.

## Updates and backups

```bash
cd ~/stacks/game
docker compose stop game
tar -czf ~/backups/game-$(date +%F).tar.gz ./data
docker compose pull
docker compose up -d
```

Stopping the server before the backup makes sure the save files are not half-written.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| LAN works, tunnel does not | Tunnel only carries TCP, or points at the wrong port | Check UDP support and the target port in the provider's dashboard |
| Tunnel agent cannot reach the server | Containers on different networks | Put both on the `games` network |
| Friends can connect but lag badly | Tunnel endpoint far from players | Pick a tunnel region close to most players |
| Server shows up in the public list | Listing setting still on | Turn off the public listing setting for that game |
| Container restarts in a loop | Bad setting or not enough memory | Read `docker logs game` and raise `mem_limit` if it was killed |
