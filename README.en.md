# dsh-skill-viewer

English | [简体中文](README.md)

A DSH plugin for managing skills right from the web UI and terminal

<img width="602" height="599" alt="image" src="https://github.com/user-attachments/assets/23aabaf8-b1fa-43a7-8a9e-ea7c2186917e" />


## Features

- Skill card list: preview installed skills; expand a card to read the full content
- Status tags: Enabled / Disabled, styled like the built-in plugin list
- Management: hot enable/disable switch, delete, search by name; the page refreshes on entry
- Add skills: choose a single `.md` file or a directory bundle (folder with a top-level `SKILL.md`); invalid content is rejected with a reason
- **Workspace views** (0.3.0): a skill's files live directly where they belong — global skills in `~/.dsh/skills`, workspace skills in that workspace's `.dsh/skills`. A workspace bar below “Skills” (Global + each workspace, horizontally scrollable) filters the list to one scope.
- **Batch migration**: the button left of “+” opens a dialog where you pick the source workspace, one or more target workspaces, and the skills yourself, then batch-**copy** or batch-**move** them (nothing pre-selected; items migrate independently — one failure never aborts the rest; move mode allows a single target).
- **Skill groups** (0.5.0): a second bar below the scope bar (All + group names, horizontally scrollable) filters the list to one group. The “Groups” button (left of the migrate button) opens the group editor: create/rename/delete groups, pick a scope, name the group and batch-check members. Groups live only in the plugin's own display config (`~/.dsh/skills/.system/skill-viewer/groups.json`) — skill directories are never touched.

## Install

1. Install the package (its bundle layer auto-mounts it — no config editing)

   ```bash
   dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-viewer/releases/download/v0.6.3/dsh-skill-viewer-0.6.3.tgz
   ```

   > Prefer the release tarball: no git involved, no pnpm v11 build-script
   > restriction. Installing from git also works (git-hosted dependencies are
   > blocked from running their prepare build scripts by default; if you see
   > “git-hosted plugins build on install...”, add the key pnpm printed above
   > under `allowBuilds` in the profile's `pnpm-workspace.yaml` and re-run):
   >
   > ```bash
   > dsh plugin --profile web add github:Fishquito7/dsh-skill-viewer
   > ```

2. Restart the gateway

   ```bash
   dsh-restart
   ```

   Then refresh the page: Settings → Skills appears right below Plugins.

## CLI

The package ships a `dsh-skill` command for terminal-based management (also hot; works while the gateway is down):

```bash
dsh-skill list                                  # list skills (with scope: global / workspace)
dsh-skill add <path>                            # add to global (a single .md file, or a bundle dir with a top-level SKILL.md)
dsh-skill add <path> --workspace D:\projA       # add directly into a workspace
dsh-skill scope <name> --global                  # migrate one skill to global
dsh-skill scope <name> --workspace D:\projA      # migrate one skill into a workspace (--copy to copy)
dsh-skill migrate <name...|--all> --from <global|path> --to <global|path> [--copy] [--yes]
dsh-skill update [--profile <name>]  # check for updates and install (default profile: web)
                                                 # batch migrate (copy or move)
dsh-skill disable <name>       # disable
dsh-skill enable <name>        # enable
dsh-skill delete <name>        # delete (asks for confirmation)
```

The CLI only scans the cwd-anchored project roots and the user roots; add `--cwd <workspace-path>` to manage a different workspace's skills.

## How it works

The plugin doesn't parse skills itself — it's just a management surface over the skill files: every action in the page (or via `dsh-skill`) ends up as a change to the skill files on disk (`SKILL.md`), and DSH's own file watcher notices immediately. That's why enable/disable, add, delete and migration are all hot — no gateway restart.

- A skill's entity lives directly in its scope folder: global = `~/.dsh/skills`, workspace = `<workspace>/.dsh/skills` — no hidden store, no junctions: after uninstalling the plugin the skills are plain files DSH keeps discovering
- Disable = rename `SKILL.md` to `SKILL.md.disabled`, enable = rename it back
- Changing where a skill lives = physically copying/moving the files into the target workspace folder (validated first, rolled back on failure)
- Deployment-bundled skills are read-only: they cannot be disabled or deleted

## Development

The source is TypeScript under `src/`; the compiled `lib/*.js` is committed with the repo (so git installs keep working). After editing, run `pnpm build`: `tsc` compiles to `lib/` and strips the extra module marker from the browser bundle. `npm pack` rebuilds automatically via prepack — no manual compile step.

## Uninstall

```bash
dsh plugin --profile web remove dsh-skill-viewer
```



## License

MIT
