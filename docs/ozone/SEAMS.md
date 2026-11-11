# Seams

Every upstream file Ozone edits. `apps/server/src/ozone/seams.test.ts` checks this list against the
`ozone-seam` tags in the repository, in both directions. Keep the reason to one line.

## Tagged

These files contain a comment with `ozone-seam` at each edit.

| File                                     | Why                                                        |
| ---------------------------------------- | ---------------------------------------------------------- |
| `knip.jsonc`                             | finds the scripts upstream's parked workflows still name   |
| `scripts/notify-discord-release.test.ts` | reads upstream's release workflow from its parked location |

## Untagged

These files cannot carry a comment, or were moved rather than edited.

| File                          | Why                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `CLAUDE.md`                   | also imports `docs/ozone/AGENTS.md`                                                 |
| `.github/workflows-upstream/` | upstream's workflows, moved out of `.github/workflows/` so GitHub does not run them |
