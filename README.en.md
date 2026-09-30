<div align="center">

# dsh-skill-mcp-panel

**Manage DSH skills and MCP servers right from the DSH web sidebar, plus the unified `dsh-panel` CLI**

[![npm version](https://img.shields.io/npm/v/dsh-skill-mcp-panel?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![npm downloads](https://img.shields.io/npm/dm/dsh-skill-mcp-panel?color=cb3837&label=downloads)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![GitHub release](https://img.shields.io/github/v/release/Fishquito7/dsh-skill-mcp-panel?color=2ea043&label=release)](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
[![DSH](https://img.shields.io/badge/DSH-0.1.6--alpha.2%20~%200.2.0--rc.2-4c6ef5)](https://github.com/Fishquito7/dsh-skill-mcp-panel)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.en.md) · [简体中文](README.md)

</div>

---

A DSH plugin that brings **skill** and **MCP server** management into the DSH web home sidebar — click Skills or MCP in the left column and the center main area switches to a full panel (not a modal, not a tab in the Settings dialog), and changes take effect immediately. The package also ships the unified `dsh-panel` command: everything the panels can do, plus cross-profile upgrades.

- 🗂️ **Skill management** — list and preview installed skills, search, workspace split and group filters, expand a card to read the full content, hot enable/disable and delete, plus `.md` / `.zip` / skill-folder adding and batch migration
- 🔌 **MCP server management** — visually maintain the MCP managed block in the profile's `cordis.patch.yml`, with Stdio / HTTP transports, connection tests, and hot reload through DSH HMR after saving
- 🧩 **Full panels, not modals** — the same slot mechanism as the host's built-in Plugins page; clicking the left column swaps the center main area, and each panel carries a “← Back to session” arrow
- ⌨️ **The `dsh-panel` CLI** — `dsh-panel skill …` and `dsh-panel mcp …` expose everything the two panels can do
- 📦 **Works out of the box** — both the npm package and the Release tarball ship prebuilt artifacts

> **Profile note**: the `mcp` sub-commands **require** an explicit `--profile <name>`, and the name must already exist — a typo is rejected rather than creating a profile. The `skill` sub-commands are not split per profile (skills live under the user root / workspace), so they need no `--profile`. `dsh-panel update` without `--profile` updates every profile that has the plugin installed (`desktop` is owned by the desktop app and is skipped automatically).

**Contents**: [Screenshots](#screenshots) · [Install](#install) · [Features](#features) · [CLI](#cli) · [How it works](#how-it-works) · [Development](#development) · [Uninstall](#uninstall) · [Changelog](#changelog) · [Links](#links) · [License](#license)

## Screenshots

> The panels live in the home sidebar, right below Plugins (moved there from the Settings dialog in v2.1.0). Clicking Skills/MCP swaps the center main area to that panel, and each panel's top-left “← Back to session” arrow returns you to the session you were reading.

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/sidebar-entry.png" width="260" alt="DSH home sidebar: Plugins / Skill/MCP">
  <br><sub>Entry · Skill/MCP in the home sidebar (one merged row since v2.1.5, label always in English)</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skills-panel.png" width="1000" alt="Skills panel: search, bulk enable/disable, the show-plugin-skills switch and skill cards">
  <br><sub>Skills panel · search / bulk enable-disable / show-plugin-skills switch / expand a card to read it</sub>
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
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/mcp-panel.png" width="1000" alt="MCP panel: how-it-works note, server card, tool count, enable switch, test and delete">
  <br><sub>MCP panel · how-it-works note / server card / tool count / enable / test connection</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/mcp-add-server.png" width="1000" alt="Add MCP server: STDIO and HTTP transports">
  <br><sub>Add MCP server · STDIO / HTTP transports</sub>
</p>

## Install

1. Install the package (its bundle layer auto-mounts it — no config editing). Pick either:

   **Option 1: GitHub Release tarball** (recommended — always the latest)

   ```bash
   dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/latest/download/dsh-skill-mcp-panel.tgz
   ```

   This is the **version-less stable link**: every release uploads both the `dsh-skill-mcp-panel.tgz` alias (always
   pointing at the latest build) and a versioned `dsh-skill-mcp-panel-<version>.tgz`, so this command never
   needs editing. To pin a specific version, swap `latest/download/dsh-skill-mcp-panel.tgz` for
   `download/v<version>/dsh-skill-mcp-panel-<version>.tgz`.

   **Option 2: npm (prebuilt, same channel as the plugin marketplace)**

   ```bash
   dsh plugin --profile web add dsh-skill-mcp-panel
   ```

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

   Then refresh the page: right below Plugins the left column lists a single merged **Skill/MCP** row — clicking it swaps the center main area to the panel, and tabs inside the panel switch between Skills and MCP.

## Features

> The panel is a **sidebar global panel**, exactly like the host's built-in Plugins page: the left column carries a single “Skill/MCP” row (since v2.1.5 the two panels are merged, giving the slot back to sessions), clicking it swaps the center main area (no Settings-dialog modal), tabs inside the panel switch between the two pages, and the tab you left is the one you come back to. A “← Back to session” arrow at the top-left returns you to the session you were reading; picking any session or Plugins from the sidebar also navigates away.

### Skills panel

- **Skill card list**: preview installed skills; click a card to expand the full content
- **Plugin-skill switch** (v2.1.5): skills shipped by plugins (bundled office, badge, …) show up by default; the checkbox next to “Enable all” hides them so you only see the skills you manage, and the hidden count is reported when the list goes empty
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
- **Environment variables** (v2.1.5): write `${NAME}` in a value to read that environment variable — the panel and the CLI format it into a `!!js` expression in `cordis.patch.yml` (the only interpolation the DSH config layer has; the host evaluates it at load time). A header of `Bearer ${MCP_TOKEN}` is stored as ``Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'`` and reads back as `Bearer ${MCP_TOKEN}`. The `!!js` prefix remains as the advanced escape hatch (raw JS expression, passed through verbatim), and a hand-written `!!js` is no longer flattened into a literal
- **How-it-works note** (v2.1.5): the “How it works” button next to the MCP title expands a short note — what an entry looks like, where the managed block lives, how tools are named, and how environment variables relate to `!!js`
- Empty command / args / env / cwd / url / headers fields carry a grey example, so the expected format is visible
- User content outside the managed block in `cordis.patch.yml` is preserved byte for byte.

### Home-sidebar panels and back-to-session (v2.1.0, merged into one entry in v2.1.5)

- **The management panels moved from the Settings dialog to the home sidebar**, using the same slot mechanism as the host's built-in Plugins page (the `sidebar.panellist` list slot plus the `main` keyed slot): clicking Skills/MCP in the left column swaps the center main area, the Settings dialog no longer carries those two tabs, and each panel owns its own page shell (scroll container and padding). The host must provide those two slots — verified on DSH 0.1.6-alpha.2.
- **“← Back to session” arrow**: one at the top-left of each panel; it returns to the session you were reading (host `ctx.layout.selectPanel(null)`, which never changes the selected session).
- **Skills + MCP merged into one row with tabs** (v2.1.5): the sidebar spends a single row on “Skill/MCP”, and tabs inside the panel switch between the two pages; the chosen tab is kept in browser localStorage (key `dsh-skill-mcp-panel:last-tab`), so reopening the row lands on the page you left.

### DSH version compatibility

Three independent host-facing dependencies are version-sensitive; one build satisfies all three at once:

| Host version | ① Plugin tree load (TypertCodec) | ② Skills-page icons (primitives exports) | ③ Sidebar panel slots |
| --- | :---: | :---: | :---: |
| `0.1.5-rc.x` | ✅ reads `schema` | ✅ legacy names | ⚠️ unverified |
| `0.1.6-alpha.1` | ✅ reads `schema` | ✅ legacy names | ⚠️ unverified |
| `0.1.6-alpha.2` – `0.1.7-alpha.0` | ✅ reads `create` | ✅ legacy names | ✅ |
| `0.1.7-alpha.1` – `0.1.8` | ✅ reads `create` | ✅ new names | ✅ |
| `0.2.0-rc.x` | ✅ reads `create` | ✅ new names | ✅ |

- **① TypertCodec `create()` contract** — since `0.1.6-alpha.2` a strict codec holds a `schema` factory (`create()`); a plugin still declaring `schema:` throws during registration and **fails the whole plugin tree, so the gateway will not boot** (Issue #20). Every codec here carries both `schema` and `create`; both generations only run `typeof` checks and neither rejects extra properties, so one build works everywhere with no version probing. Guard: `test-codec.mjs`.
- **② Skills-page icon export names** — `0.1.7-alpha.1` replaced the pixel suffix with a stroke tier (`IconSkillOutline16` → `IconSkillOutlineRegular`, with size moved to the `size` prop) and the **two generations share no names**. The six Skills-half references now go through `primitiveIcon(cur, legacy)` (prefer the new name, fall back to the legacy one); switching straight to the new names would break everyone on `0.1.6` and earlier. Guard: `test-host-icons.mjs`.
- **③ Sidebar panel slots** — since v2.1.0 the panels mount on the host's `sidebar.panellist` (list slot) plus `main` (keyed slot), so the host must provide both. Verified on `0.1.6-alpha.2`, and the slot names are unchanged across the `0.1.7` line. `0.1.5-rc.x` / `0.1.6-alpha.1` are **unverified**; even without the slots the plugin tree and CLI still work — the left column just won't show the Skills/MCP rows.
- **④ peerDependencies gate** (v2.1.2) — this package declares `"@deepseek-ai/dsh": ">=0.1.5-rc.0 <0.3.0-0"`. DSH's `evaluatePluginCompatibility` checks it **at install time** and **at profile startup**, refusing to load (and printing the exact-version exemption command) when it does not match — turning a silent breakage into a loud refusal. Without that field the check returns early and passes everything, which is exactly why the 0.1.7-rc.1 breakage could happen unnoticed.
  - The upper bound is `<0.3.0-0` rather than `<0.3.0` because the check runs with `includePrerelease`: `<0.3.0` would let `0.3.0-rc.1` through.
  - v2.1.3 raised the upper bound from `<0.2.0-0` to `<0.3.0-0`: once the desktop app auto-updated to `0.2.0-rc.2`, the old range was judged incompatible and the host **denied the whole row at profile startup** (`dsh: disabling profile plugin row "skill-mcp-panel": ...`), making the panels vanish from the sidebar. None of the three host-facing contracts changed in 0.2.0 (icon export names, the `sidebar.panellist` + `main` slots, and TypertCodec still reading `create()`), and this was verified against 0.2.0's own `evaluatePluginCompatibility` and registry validator.
  - The lower bound `0.1.5-rc.0` is where the plugin tree still loads — wider than the "panels verified" range in the table above. Being inside the range does not mean the panels are verified.
  - To use it on a host outside the range, grant an exemption for that exact host version:

    ```bash
    dsh plugin --profile web allow-version dsh-skill-mcp-panel@2.1.5 --dsh-version <host-version> --accept-risk
    ```
  - Guard: `test-cli-profiles.mjs` (calls the host's real `evaluatePluginCompatibility` to check both ends of the range).

### Panel behaviour changes (v2.0.5)

- The scope selector is always a collapsed dropdown (11 rows max, then scrolls); the group bar wraps onto multiple lines.
- The skill list no longer depends on whether a session is open; without one the host falls back to the global registry.

## CLI

The unified parent command is `dsh-panel`.

> **Global shim**: at startup the host writes `dsh-panel` into the npm global bin directory. On Windows that is three files — `dsh-panel.cmd` (CMD), `dsh-panel.ps1` (PowerShell) and an **extension-less** `dsh-panel` sh script (what Git Bash / MSYS2 / Cygwin look for; without it bash says `command not found`, which is what v2.1.5 fixed); on macOS / Linux it is a single executable `dsh-panel`. All of them point at the plugin copy of whichever profile started last.

The `mcp` sub-commands **require** an explicit `--profile <name>`, and the name must already exist (a profile is a directory with a `package.json` under `$DSH_HOME/profiles/<name>`). A typo exits with code 2 — it will **not** silently create a profile the way `dsh plugin` does. The `skill` sub-commands do **not** need it: skills live under the user root / workspace and are not split per profile. `dsh-panel update` without `--profile` updates every profile that has the plugin installed.

### Profile overview

```bash
dsh-panel profiles        # installed version / bundle mount / install spec for every profile
```

The first line is the **current dsh-panel entry point** and its version. That matters: `dsh-panel` is a single global shim, written by whichever profile booted last (`src/global-shim.ts`), so it has no necessary relationship to any row in that table.

### Skill sub-commands

```bash
dsh-panel skill --help

dsh-panel skill list                                  # list skills (with scope: global / workspace)
dsh-panel skill add <path>                            # add to global (.md file, bundle dir, or .zip archive)
dsh-panel skill add <path> --workspace D:\projA        # add directly into a workspace
dsh-panel skill scope <name> --global                 # migrate one skill to global
dsh-panel skill scope <name> --workspace D:\projA      # migrate one skill into a workspace (--copy to copy)
dsh-panel skill migrate <name...|--all> --from <global|path> --to <global|path> [--copy] [--yes]
dsh-panel skill disable <name>                        # disable
dsh-panel skill enable <name>                         # enable
dsh-panel skill delete <name>                         # delete (asks for confirmation)
```

Skill files are **shared globally** (`~/.dsh/skills` and `<workspace>/.dsh/skills`) and are not split per profile, so the `skill` sub-commands need no `--profile`. Passing it optionally confirms that profile exists and warns you when it has not mounted this plugin in `dsh.profile.bundles` (such a profile simply will not show the panels).

### MCP sub-commands

```bash
dsh-panel mcp list --profile web
dsh-panel mcp add --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env KEY=VALUE ...] [--cwd <path>] --profile web
dsh-panel mcp add --name <serverName> --http --url <url> [--header KEY=VALUE ...] --profile web
dsh-panel mcp enable|disable <serverName> --profile web
dsh-panel mcp remove <serverName> [--yes] --profile web
dsh-panel mcp test <serverName> --profile web
```

Write `${NAME}` in a value to read that environment variable (it is formatted into a `!!js` expression in `cordis.patch.yml`, evaluated by DSH at load time); a `!!js` prefix passes a raw JS expression through:

```bash
dsh-panel mcp add --name github --stdio --command npx --args -y --args @modelcontextprotocol/server-github \
  --env 'GITHUB_TOKEN=${GITHUB_TOKEN}' --profile web

dsh-panel mcp add --name web --http --url https://example.com/mcp \
  --header 'Authorization=Bearer ${MCP_TOKEN}' --profile web

# advanced: a raw JS expression, stored inside a !!js tag
dsh-panel mcp add --name web2 --http --url https://example.com/mcp \
  --header 'Authorization=!!js `Bearer ${process.env.MCP_TOKEN}`' --profile web
```

```bash
dsh-panel mcp add --name github --stdio --command npx --args -y --args @modelcontextprotocol/server-github \
  --env 'GITHUB_TOKEN=!!js process.env.GITHUB_TOKEN' --profile web

dsh-panel mcp add --name web --http --url https://example.com/mcp \
  --header 'Authorization=!!js `Bearer ${process.env.MCP_TOKEN}`' --profile web
```

MCP configuration is written to the managed block in the target profile's `cordis.patch.yml` and hot-reloaded while the gateway is online. The block is delimited by `# >>> dsh-skill-mcp-panel:mcp:begin` / `# <<< ...end` — do not edit inside it.

### Updating the plugin

```bash
dsh-panel update                          # update every profile that has the plugin installed
dsh-panel update --yes                    # same, without prompting
dsh-panel update --profile web            # update only web
dsh-panel mcp update                      # same as dsh-panel update
```

- The comparison baseline is the version **each profile has installed in its own `node_modules`**, not the version of whichever CLI copy happens to be running.
- Updates **stay on the channel that profile was installed from**: a tarball install updates from the versioned
  tarball URL, an npm install updates from npm pinned to that version, and a git (or unknown) install keeps
  using `github:Fishquito7/dsh-skill-mcp-panel#v<version>`.
- Profiles already on the latest version are skipped, never reinstalled.
- `desktop` is owned exclusively by the DSH desktop app — the host rejects `dsh plugin --profile desktop`; it is skipped with an explanation during an automatic sweep, and exits with code 2 when named explicitly.
- After an update: client bundles hot-swap (just refresh the page); server-side changes need that profile's gateway restarted.

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

## Changelog

Only version notes that **change how you use the plugin**; see [Releases](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases) for the full history.

- **v2.1.5** — the sidebar’s Skills and MCP rows merge into one “Skill/MCP” row (with a new merged-entry icon) plus tabs inside the panel (the tab you left is remembered); a new “show plugin skills” switch; MCP environment variables accept the intuitive `${NAME}` form (the panel/CLI formats them into `!!js`, and they read back as `${NAME}` instead of being flattened into a literal), a new “How it works” note on the MCP page, and grey examples on empty fields; an extension-less bash shim on Windows; `dsh-panel update` stays on each profile’s original install channel (tarball / npm / git) and the README install guide uses the version-less stable tarball link
- **v2.1.3** — DSH `0.2.0` support (peer upper bound raised to `<0.3.0-0`, without which the host denies the whole row at profile startup); an illegal MCP server name no longer answers with a bare gateway error
- **v2.1.2** — `mcp` sub-commands require an explicit `--profile`, a typo is rejected instead of creating a profile; `dsh-panel update` updates every profile; new `dsh-panel profiles`
- **v2.1.1** — DSH `0.1.7` support for the host's renamed icon exports, so the Skills page renders again
- **v2.1.0** — the panels moved from the Settings dialog to the home sidebar, each with a “← Back to session” arrow
- **v2.0.0** — the MCP panel

## Links

- npm package: [dsh-skill-mcp-panel](https://www.npmjs.com/package/dsh-skill-mcp-panel)
- Releases: [github.com/Fishquito7/dsh-skill-mcp-panel/releases](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
- Issues: [github.com/Fishquito7/dsh-skill-mcp-panel/issues](https://github.com/Fishquito7/dsh-skill-mcp-panel/issues)
- Chinese docs: [README.md](README.md)

## License

MIT
