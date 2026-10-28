# Minecraft Servers in Docker

Run a Vanilla, Forge or Fabric Minecraft Java server in Docker Compose, manage mods without version mismatches, and patch broken mod data with a datapack.

## Applies to

- Minecraft Java Edition servers
- A Linux host with Docker and Docker Compose
- The `itzg/minecraft-server` image, which downloads and runs the server type you ask for

Version numbers below are examples. Use the Minecraft and loader versions your mods support.

## Pick the Java version

The image is tagged by Java version, and the Minecraft version decides which one you need:

| Minecraft | Java | Image tag |
|---|---|---|
| 1.20.5 and newer | 21 | `itzg/minecraft-server:java21` |
| 1.18 to 1.20.4 | 17 | `itzg/minecraft-server:java17` |
| 1.17 | 16 or 17 | `itzg/minecraft-server:java17` |
| 1.16.5 and older | 8 | `itzg/minecraft-server:java8` |

A wrong Java version shows up as a crash at startup mentioning `UnsupportedClassVersionError` or a class file version.

## Vanilla

`compose.yaml`:

```yaml
services:
  mc:
    image: itzg/minecraft-server:java21
    container_name: mc
    restart: unless-stopped
    environment:
      EULA: "TRUE"
      TYPE: "VANILLA"
      VERSION: "1.21.1"
      MEMORY: "4G"
      USE_AIKAR_FLAGS: "true"
      ONLINE_MODE: "TRUE"
      ENABLE_WHITELIST: "TRUE"
      ENFORCE_WHITELIST: "TRUE"
      WHITELIST: "player1,player2"
      DIFFICULTY: "normal"
      VIEW_DISTANCE: "10"
    ports:
      - "25565:25565"
    volumes:
      - ./data:/data
```

- `EULA: "TRUE"` means you accept the Minecraft EULA. The server will not start without it.
- `MEMORY` sets the Java heap. 4 GB is plenty for a small Vanilla server; modded servers usually need 6 to 10 GB.
- `USE_AIKAR_FLAGS` applies a well-known set of garbage collector settings that reduce lag spikes.
- `ONLINE_MODE` checks every player against Mojang's account servers. Leave it on.
- The whitelist settings mean only the listed players can join, even if someone finds the address.

## Forge

```yaml
services:
  mc:
    image: itzg/minecraft-server:java17
    container_name: mc
    restart: unless-stopped
    environment:
      EULA: "TRUE"
      TYPE: "FORGE"
      VERSION: "1.20.1"
      # FORGE_VERSION: "47.x.x"   # leave unset for the recommended build, pin once your pack works
      MEMORY: "8G"
      USE_AIKAR_FLAGS: "true"
      ONLINE_MODE: "TRUE"
      ENABLE_WHITELIST: "TRUE"
      ENFORCE_WHITELIST: "TRUE"
      WHITELIST: "player1,player2"
    ports:
      - "25565:25565"
    volumes:
      - ./data:/data
      - ./mods:/mods:ro
```

Put server mod `.jar` files in `./mods` on the host. The image copies them into `/data/mods` at startup, and the read-only mount means the server cannot change your source copy.

## Fabric

```yaml
services:
  mc:
    image: itzg/minecraft-server:java21
    container_name: mc
    restart: unless-stopped
    environment:
      EULA: "TRUE"
      TYPE: "FABRIC"
      VERSION: "1.21.1"
      # FABRIC_LOADER_VERSION: "0.x.x"   # leave unset for the latest stable loader
      MEMORY: "6G"
      USE_AIKAR_FLAGS: "true"
      ONLINE_MODE: "TRUE"
      ENABLE_WHITELIST: "TRUE"
      ENFORCE_WHITELIST: "TRUE"
      WHITELIST: "player1,player2"
    ports:
      - "25565:25565"
    volumes:
      - ./data:/data
      - ./mods:/mods:ro
```

Most Fabric mods need **Fabric API** as a separate mod. If a mod fails with a missing dependency on `fabric-api` or `fabric`, add the Fabric API jar for your Minecraft version to `./mods`.

## Start, watch and talk to it

```bash
docker compose up -d
docker logs -f mc
```

Wait for a line ending in `Done (...)! For help, type "help"`. Then use the server console through RCON, which the image sets up for you:

```bash
docker exec -i mc rcon-cli
```

Useful commands there: `list`, `whitelist add player3`, `save-all`, `stop`.

## Managing mods

### Server mods and client mods

Some mods only belong on the client (minimaps, shaders, HUD and menu tweaks). On a dedicated server they either do nothing or crash it.

- **Forge:** the crash says `Attempted to load class net/minecraft/client/... for invalid dist DEDICATED_SERVER`. The mod named in the stack trace is client-only. Remove it from the server.
- **Fabric:** each mod declares its environment in `fabric.mod.json`. Mods marked `"environment": "client"` are skipped on the server, but a mod that is marked wrongly can still crash it the same way.

### Split the pack in three

| Pack | Who gets it | Contents |
|---|---|---|
| Server | The server only | Mods with content, plus server-side performance mods |
| Client | Every player | The same content mods, same versions, plus client-side mods |
| Optional | Players who want them | Shaders, minimaps, cosmetic mods |

Mods that add blocks, items or entities must be on both sides with the **same version**. A mismatch shows up as players getting kicked on join with a registry or mod list mismatch.

### Read the startup errors

| Loader | Message | Means |
|---|---|---|
| Forge | `Missing or unsupported mandatory dependencies` | A required mod is missing or the wrong version. The list under it names them. |
| Fabric | `Incompatible mods found!` | Same idea. The lines under it say which mod needs what. |
| Both | `Mod X requires Minecraft Y` | The mod is for a different Minecraft version |

Add one mod at a time when building a pack. When something breaks, the last mod you added is the first suspect.

## Patching broken mod data with a datapack

Mods sometimes ship tags or loot tables that reference a biome, block or item that does not exist in your pack. The server logs errors on startup, and structures or loot can go missing. You can override the broken file with your own datapack instead of editing the mod.

Create a folder in the world's datapacks folder:

```text
data/world/datapacks/local-fixes/
  pack.mcmeta
  data/<mod_namespace>/tags/worldgen/biome/<tag_name>.json
```

`pack.mcmeta`:

```json
{
  "pack": {
    "pack_format": 15,
    "description": "Local fixes for mod data"
  }
}
```

`pack_format` depends on the Minecraft version: `15` for 1.20.1, `48` for 1.21 and 1.21.1.

The override, at the same path and file name as the broken file inside the mod's jar:

```json
{
  "replace": true,
  "values": [
    "#minecraft:is_overworld",
    { "id": "othermod:example_biome", "required": false }
  ]
}
```

- `"replace": true` replaces the mod's version of the tag completely instead of adding to it.
- `"required": false` lets the tag reference something that might not exist without causing an error.

Open the mod's `.jar` with any zip tool to find the original file and its exact path. Starting with 1.21, some data folder names changed from plural to singular, for example `loot_tables` to `loot_table` and `tags/blocks` to `tags/block`. Match the layout of the version you run.

Loot tables and most tags reload with the `reload` command in the console. Worldgen data, including biome tags, is only read at startup, so restart the server for those:

```bash
docker compose restart mc
```

## Backups and updates

```bash
docker exec -i mc rcon-cli save-all flush
docker compose stop mc
tar -czf ~/backups/mc-$(date +%F).tar.gz ./data
docker compose up -d
```

To update Minecraft or the loader, change `VERSION` (and the loader version if you pinned it), update the mods to match, back up, then `docker compose up -d`. Never update a modded server's Minecraft version without checking every mod first.

## Letting friends in from outside

Minecraft Java uses TCP, so most tunnel services and every mesh VPN work. See [Game Servers Without Port Forwarding](#/homelab/game-servers-without-port-forwarding) for the options and how to keep the server private.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `UnsupportedClassVersionError` at startup | Wrong Java version for this Minecraft version | Change the image tag |
| `invalid dist DEDICATED_SERVER` | Client-only mod on the server | Remove the mod named in the error |
| Players kicked with a mod or registry mismatch | Different mod versions on client and server | Give players the exact mod list from the server |
| Fabric mods fail to load | Fabric API missing | Add the Fabric API jar for your version |
| Errors about unknown biomes or items in tags | Mod data references content that is not there | Override the tag with a datapack and `"required": false` |
| Server killed with no Java error | Out of memory | Raise `MEMORY` and the host's available RAM, or remove heavy mods |
