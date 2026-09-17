# dsh-skill/mcp-panel — dsh-skill-mcp-panel

English | [简体中文](README.md)

A DSH plugin for managing skills right from the web UI and terminal

<img width="602" height="599" alt="image" src="https://github.com/user-attachments/assets/23aabaf8-b1fa-43a7-8a9e-ea7c2186917e" />


## Features

- Skill card list: preview installed skills; expand a card to read the full content
- Status tags: Enabled / Disabled, styled like the built-in plugin list
- Management: hot enable/disable switch, delete, search by name; the page refreshes on entry
- Add skills (0.7.0 unified entry): click “+” and pick files (`.md` / `.zip`), or drag files, archives or skill folders straight onto the page — the structure is auto-detected (bundle / flat files / archive) and invalid content is rejected with a reason
- **Workspace views** (0.3.0): a skill's files live directly where they belong — global skills in `~/.dsh/skills`, workspace skills in that workspace's `.dsh/skills`. A workspace selector below “Skills” (a collapsed dropdown listing Global + each workspace, 11 rows max then scrolls) filters the list to one scope.
- **Batch migration**: the button left of “+” opens a dialog where you pick the source workspace, one or more target workspaces, and the skills yourself, then batch-**copy** or batch-**move** them (nothing pre-selected; items migrate independently — one failure never aborts the rest; move mode allows a single target). When the source scope has groups, you can filter skills by group above the list (0.7.0).
- **Skill groups** (0.5.0): a second bar below the scope bar (All + group names, wrapping onto multiple lines) filters the list to one group. The “Groups” button (left of the migrate button) opens the group editor: create/rename/delete groups, pick a scope, name the group and batch-check members. Groups live only in the plugin's own display config (`~/.dsh/skills/.system/skill-viewer/groups.json`) — skill directories are never touched.

- **Scope-exact operations** (0.6.4): when the same skill name exists in both the global scope and a workspace, delete, enable/disable and content views act on exactly the (name, scope) row you clicked — each row expands and operates independently, other copies are never touched. Missing entries in the given scope fail loudly instead of falling back. The CLI likewise requires `--global` / `--project` / `--workspace` to disambiguate same-name skills in `enable`/`disable`/`delete`.

### DSH version compatibility (v2.0.5)
- Adapts to the TypertCodec `create()` factory contract introduced in DSH `0.1.6-alpha.2`
  — that change makes plugins still declaring `schema:` throw during registration and
  fail the whole plugin tree (the gateway will not boot). One build now works on **both**
  `0.1.5-rc.2` and earlier (reads `schema`) and `0.1.6-alpha.2` and later (reads `create`),
  with no version probing.
- The scope selector is always a collapsed dropdown (11 rows max, then scrolls); the group
  bar wraps onto multiple lines.
- The skill list no longer depends on whether a session is open; without one the host falls
  back to the global registry.

## Install

1. Install the package (its bundle layer auto-mounts it — no config editing). Pick either:

   **Option 1: GitHub Release tarball**

   ```bash
   dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.5/dsh-skill-mcp-panel-2.0.5.tgz
   ```

   **Option 2: npm (prebuilt, same channel as the plugin marketplace)**

   ```bash
   dsh plugin --profile web add dsh-skill-mcp-panel
   ```

   > Both install prebuilt artifacts — no git access and no local build needed. Installing from git also works
   > (git-hosted dependencies are blocked from running their prepare build scripts by default; if you see
   > "git-hosted plugins build on install...", add the key pnpm printed under `allowBuilds` in the profile `pnpm-workspace.yaml` and re-run):
   >
   > ```bash
   > dsh plugin --profile web add github:Fishquito7/dsh-skill-mcp-panel
   > ```

2. Restart the gateway

   ```bash
   dsh-restart
   ```

   Then refresh the page: Settings → Skills appears right below Plugins.

## CLI

The package ships the unified `dsh-panel` command. Skill management:

```bash
dsh-panel skill --help
```

MCP management:

```bash
dsh-panel skill list                                  # list skills (with scope: global / workspace)
dsh-panel skill add <path>                            # add to global (.md file, bundle dir, or .zip archive)
dsh-panel skill add <path> --workspace D:\projA       # add directly into a workspace
dsh-panel skill scope <name> --global                  # migrate one skill to global
dsh-panel skill scope <name> --workspace D:\projA      # migrate one skill into a workspace (--copy to copy)
dsh-panel skill migrate <name...|--all> --from <global|path> --to <global|path> [--copy] [--yes]
dsh-panel skill update [--profile <name>]  # check for updates and install (default profile: web)
                                                 # batch migrate (copy or move)
dsh-panel skill disable <name>       # disable
dsh-panel skill enable <name>        # enable
dsh-panel skill delete <name>        # delete (asks for confirmation)
```

The CLI only scans the cwd-anchored project roots and the user roots; add `--cwd <workspace-path>` to manage a different workspace's skills. If a skill name exists in several scopes, `enable`/`disable`/`delete` require `--global`/`--project`/`--workspace` to pick which copy to operate on.

## How it works

```bash
dsh-panel mcp list [--profile <name>]
dsh-panel mcp add --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env KEY=VALUE ...] [--cwd <path>] [--profile <name>]
dsh-panel mcp add --name <serverName> --http --url <url> [--header KEY=VALUE ...] [--profile <name>]
dsh-panel mcp enable|disable <serverName> [--profile <name>]
dsh-panel mcp remove <serverName> [--yes] [--profile <name>]
dsh-panel mcp test <serverName> [--profile <name>]
dsh-panel mcp update [--yes] [--profile <name>]
dsh-panel update [--yes] [--profile <name>]      # update the whole package
```

MCP configuration is written to the managed block in the target profile's `cordis.patch.yml`
(markers `# >>> dsh-skill-mcp-panel:mcp:begin` / `# <<< ...end`). Do not edit inside the block.

The plugin doesn't parse skills itself — it's just a management surface over the skill files: every action in the page (or via `dsh-panel skill`) ends up as a change to the skill files on disk (`SKILL.md`), and DSH's own file watcher notices immediately. That's why enable/disable, add, delete and migration are all hot — no gateway restart.

- A skill's entity lives directly in its scope folder: global = `~/.dsh/skills`, workspace = `<workspace>/.dsh/skills` — no hidden store, no junctions: after uninstalling the plugin the skills are plain files DSH keeps discovering
- Disable = rename `SKILL.md` to `SKILL.md.disabled`, enable = rename it back
- Changing where a skill lives = physically copying/moving the files into the target workspace folder (validated first, rolled back on failure)
- Deployment-bundled skills are read-only: they cannot be disabled or deleted

## Development

The source is TypeScript under `src/`; the compiled `lib/*.js` is committed with the repo (so git installs keep working). After editing, run `pnpm build`: `tsc` compiles to `lib/` and strips the extra module marker from the browser bundle. `npm pack` rebuilds automatically via prepack — no manual compile step.

## Uninstall

```bash
dsh plugin --profile web remove dsh-skill-mcp-panel
```



## License

MIT
