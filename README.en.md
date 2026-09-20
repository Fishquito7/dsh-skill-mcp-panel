<div align="center">

# dsh-skill-mcp-panel

**Manage DSH skills and MCP servers right from the DSH web sidebar, plus the unified `dsh-panel` CLI**

[![npm version](https://img.shields.io/npm/v/dsh-skill-mcp-panel?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![npm downloads](https://img.shields.io/npm/dm/dsh-skill-mcp-panel?color=cb3837&label=downloads)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![GitHub release](https://img.shields.io/github/v/release/Fishquito7/dsh-skill-mcp-panel?color=2ea043&label=release)](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.2%20%7C%200.1.6--alpha.2%2B-4c6ef5)](https://github.com/Fishquito7/dsh-skill-mcp-panel)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.en.md) · [简体中文](README.md)

</div>

---

A DSH plugin that adds two management panels — **Skills** and **MCP** — to the web home sidebar, right below the built-in **Plugins** entry. Clicking either one swaps the center main area to that panel (a full panel, not a modal). The package also ships the unified `dsh-panel` terminal command, with two sub-command families: `skill` and `mcp`.

- 🗂️ **Skills panel** — list and preview installed skills, search, workspace split and group filters, expand a card to read the full content, hot enable/disable and delete, plus `.md` / `.zip` / skill-folder adding and batch migration
- 🔌 **MCP panel** (v2.0.0) — visually maintain the MCP managed block in the profile's `cordis.patch.yml`, with Stdio / HTTP transports, connection tests, and hot reload through DSH HMR after saving
- 🧩 **Home-sidebar panels** (v2.1.0) — the same slot mechanism as the host's built-in Plugins page; clicking the left column swaps the center main area, and each panel carries a “← Back to session” arrow
- ⌨️ **Unified CLI** — `dsh-panel skill …` and `dsh-panel mcp …` expose everything the two panels can do
- 📦 **No local build** — both the npm package and the Release tarball ship prebuilt artifacts

> **Profile note**: the example commands in this document default to `--profile web`; adjust them if your profile differs.

**Contents**: [Screenshots](#screenshots) · [Install](#install) · [Features](#features) · [CLI](#cli) · [How it works](#how-it-works) · [Development](#development) · [Uninstall](#uninstall) · [Links](#links) · [License](#license)

## Screenshots

> The panels live in the home sidebar, right below Plugins (moved there from the Settings dialog in v2.1.0). Clicking Skills/MCP swaps the center main area to that panel, and each panel's top-left “← Back to session” arrow returns you to the session you were reading.

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/sidebar-entry.png" width="260" alt="DSH home sidebar: Plugins / Skills / MCP">
  <br><sub>Entry · Skills and MCP in the home sidebar</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skills-panel.png" width="1000" alt="Skills panel: search, workspace selector and an expanded skill card">
  <br><sub>Skills panel · search / workspace selector (collapsed dropdown) / expand a card to read it</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skill-groups.png" width="1000" alt="Group editor: create a group, pick a workspace, batch-select members">
  <br><sub>Skill groups · create / rename / batch-select members</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skill-migrate.png" width="1000" alt="Batch migration: source workspace, multi-select targets, copy or move">
  <br><sub>Batch migration · source / multi-target / copy or move</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/mcp-panel.png" width="1000" alt="MCP panel: server card, tool count, enable switch, test and delete">
  <br><sub>MCP panel · server card / tool count / enable / test connection</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/mcp-add-server.png" width="1000" alt="Add MCP server: STDIO and HTTP transports">
  <br><sub>Add MCP server · STDIO / HTTP transports</sub>
</p>

## Install

1. Install the package (its bundle layer auto-mounts it — no config editing). Pick either:

   **Option 1 (recommended): the stable tarball link — always the latest release**

   ```bash
   dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/latest/download/dsh-skill-mcp-panel.tgz
   ```

   Its asset name carries **no version**, and GitHub resolves `latest` to the newest release on every
   request — so the URL never goes stale and the command never needs editing. It bypasses the npm
   registry without pulling the whole repository the way a `github:` spec does.

   To **pin a version**, use the versioned asset link instead:

   ```bash
   dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.1.0/dsh-skill-mcp-panel-2.1.0.tgz
   ```

   **Option 2: npm (what the plugin marketplace uses by default)**

   ```bash
   dsh plugin --profile web add dsh-skill-mcp-panel
   ```

   > The marketplace (dshmarket) prefers **npm** and only falls back to the tarball, so installing from
   > the market takes this path; `dsh-panel update` and the Settings "check for updates" action use the
   > stable tarball link above.

   > Both install prebuilt artifacts — no local build needed. Installing from git also works
   > (git-hosted dependencies are blocked from running their prepare build scripts by default; if you see
   > `git-hosted plugins build on install...`, add the key pnpm printed under `allowBuilds` in the profile's
   > `pnpm-workspace.yaml` and re-run):
   >
   > ```bash
   > dsh plugin --profile web add github:Fishquito7/dsh-skill-mcp-panel
   > ```

2. Restart the gateway

   ```bash
   dsh-restart
   ```

   Then refresh the page: going down from Plugins, the left column lists Skills and then MCP. Clicking either one swaps the center main area to that panel.

## Features

> Both panels are **sidebar global panels**, exactly like the host's built-in Plugins page: clicking Skills/MCP in the left column swaps the center main area to that panel (no Settings-dialog modal). Each panel carries a “← Back to session” arrow at its top-left corner that returns you to the session you were reading; picking any session or Plugins from the sidebar also navigates away.

### Skills panel

- **Skill card list**: preview installed skills; click a card to expand the full content
- **Status tags**: Enabled / Disabled, styled like the built-in plugin list
- **Management**: hot enable/disable switch, delete, search by name; the page refreshes on entry
- **Adding skills** (0.7.0 unified entry): click “+” to pick files (`.md` / `.zip`), or drag files, archives or skill folders straight onto the page — the structure is auto-detected (bundle / flat files / archive) and invalid content is rejected with a reason
- **Workspace split** (0.3.0): a skill's files live directly where they belong — global skills in `~/.dsh/skills`, workspace skills in that workspace's `.dsh/skills`. A workspace selector below “Skill list” (a collapsed dropdown listing Global + each workspace, 11 rows max then scrolls) filters the list to one scope.
- **Batch migration**: the button left of “+” opens a dialog where you pick the source workspace, one or more target workspaces, and the skills yourself, then batch-**copy** or batch-**move** them (nothing pre-selected; items migrate independently — one failure never aborts the rest; move mode allows a single target). When the source scope has groups, you can filter skills by group above the list (0.7.0).
- **Skill groups** (0.5.0): a group bar below the workspace selector (All + group names, wrapping onto multiple lines) filters the list to one group. The “Groups” button (left of the migrate button) opens the group editor: create / rename / delete groups, pick a workspace, name the group and batch-check members. Groups live only in the plugin's own display config (`~/.dsh/skills/.system/skill-viewer/groups.json`) — skill directories are never touched.
- **Scope-exact operations** (0.6.4): when the same skill name exists in both the global scope and a workspace, delete, enable/disable and content views act on exactly the (name + scope) row you clicked — each row expands and operates independently, other copies are never touched; a missing entry in the given scope fails loudly instead of silently falling back. The CLI likewise requires `--global` / `--project` / `--workspace` to disambiguate same-name skills.

### MCP panel (v2.0.0)

- A new MCP panel sits below Skills in the home sidebar and manages the MCP server managed block in the profile's `cordis.patch.yml`;
- Supports **Stdio** (local command) and **HTTP** (streamable-http) transports;
- Add, edit, enable/disable, delete and test connections; saving is hot-reloaded by DSH HMR — no gateway restart;
- `env` / `headers` secrets are redacted in RPC and in the UI, and editing keeps the old value when a key is omitted;
- User content outside the managed block in `cordis.patch.yml` is preserved byte for byte.

### Home-sidebar panels and back-to-session (v2.1.0)

- **The management panels moved from the Settings dialog to the home sidebar**, using the same slot mechanism as the host's built-in Plugins page (the `sidebar.panellist` list slot plus the `main` keyed slot): clicking Skills/MCP in the left column swaps the center main area, the Settings dialog no longer carries those two tabs, and each panel owns its own page shell (scroll container and padding). The host must provide those two slots — verified on DSH 0.1.6-alpha.2.
- **“← Back to session” arrow**: one at the top-left of each panel; it returns to the session you were reading (host `ctx.layout.selectPanel(null)`, which never changes the selected session).

### DSH version compatibility (v2.0.5)

- Adapts to the TypertCodec `create()` factory contract introduced in DSH `0.1.6-alpha.2` — that change makes plugins still declaring `schema:` throw during registration and fail the whole plugin tree (the gateway will not boot). One build now works on **both** `0.1.5-rc.2` and earlier (reads `schema`) and `0.1.6-alpha.2` and later (reads `create`), with no version probing and no separate branches.
- The scope selector is always a collapsed dropdown (11 rows max, then scrolls); the group bar wraps onto multiple lines.
- The skill list no longer depends on whether a session is open; without one the host falls back to the global registry.

## CLI

The unified parent command is `dsh-panel`.

### Skill sub-commands

```bash
dsh-panel skill --help

dsh-panel skill list                                  # list skills (with scope: global / workspace)
dsh-panel skill add <path>                            # add to global (.md file, bundle dir, or .zip archive)
dsh-panel skill add <path> --workspace D:\projA        # add directly into a workspace
dsh-panel skill scope <name> --global                 # migrate one skill to global
dsh-panel skill scope <name> --workspace D:\projA      # migrate one skill into a workspace (--copy to copy)
dsh-panel skill migrate <name...|--all> --from <global|path> --to <global|path> [--copy] [--yes]   # batch migrate (copy or move)
dsh-panel skill update [--profile <name>]             # check for updates and install (default profile: web)
dsh-panel skill disable <name>                        # disable
dsh-panel skill enable <name>                         # enable
dsh-panel skill delete <name>                         # delete (asks for confirmation)
```

### MCP sub-commands

```bash
dsh-panel mcp list [--profile <name>]
dsh-panel mcp add --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env KEY=VALUE ...] [--cwd <path>] [--profile <name>]
dsh-panel mcp add --name <serverName> --http --url <url> [--header KEY=VALUE ...] [--profile <name>]
dsh-panel mcp enable|disable <serverName> [--profile <name>]
dsh-panel mcp remove <serverName> [--yes] [--profile <name>]
dsh-panel mcp test <serverName> [--profile <name>]
dsh-panel mcp update [--yes] [--profile <name>]
dsh-panel update [--yes] [--profile <name>]      # update the whole dsh-skill-mcp-panel package
```

MCP configuration is written to the managed block in the target profile's `cordis.patch.yml` and hot-reloaded while the gateway is online. The block is delimited by `# >>> dsh-skill-mcp-panel:mcp:begin` / `# <<< ...end` — do not edit inside it.

The CLI only scans the cwd-anchored project roots and the user roots; add `--cwd <workspace-path>` to manage a different workspace's skills. If a skill name exists in several scopes, `enable`/`disable`/`delete` require `--global`/`--project`/`--workspace` to pick which copy to operate on.

## How it works

### Skills

Every action in the page or via `dsh-panel skill` ends up as a change to the skill files on disk (`SKILL.md`), and DSH's own file watcher notices immediately — that is why enable/disable, add/delete and migration are all hot, with no gateway restart.

- A skill's entity lives directly in its workspace's skill folder: global = `~/.dsh/skills`, workspace = `<workspace>/.dsh/skills` — no hidden store, no junctions: after uninstalling the plugin the skills are plain files DSH keeps discovering
- Disable = rename `SKILL.md` to `SKILL.md.disabled`; enable = rename it back
- Changing where a skill lives = physically copying/moving the files into the target folder (validated first, rolled back on failure)
- Deployment-bundled skills are read-only: they cannot be disabled or deleted

### MCP

The plugin writes MCP server configuration into the managed block in the profile's `cordis.patch.yml`; the actual connection and tool registration are done by the official DSH plugin @deepseek-ai/dsh-mcp-client, loaded automatically through DSH HMR.

## Development

The source is TypeScript under `src/`; the compiled `lib/*.js` is committed with the repo (so git installs keep working).
After editing the source, run `pnpm build`: `tsc` compiles to `lib/` and strips the extra module marker from the browser bundle.
When publishing, `npm pack` rebuilds automatically through prepack — no manual compile step.

## Uninstall

```bash
dsh plugin --profile web remove dsh-skill-mcp-panel
```

## Links

- npm package: [dsh-skill-mcp-panel](https://www.npmjs.com/package/dsh-skill-mcp-panel)
- Releases: [github.com/Fishquito7/dsh-skill-mcp-panel/releases](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
- Issues: [github.com/Fishquito7/dsh-skill-mcp-panel/issues](https://github.com/Fishquito7/dsh-skill-mcp-panel/issues)
- Chinese docs: [README.md](README.md)

## License

MIT
