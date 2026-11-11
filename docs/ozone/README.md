# Ozone

Ozone is an app builder and chat client built as a tracked fork of
[T3 Code](https://github.com/pingdotgg/t3code) (MIT). T3 Code supplies the agent runtimes, the
event-sourced orchestration, threads, attachments, checkpoints and the preview browser. Ozone adds
the product on top: prompt-to-app building, a Docker Compose runtime that never loses app data, a
build orchestrator, a chat-first surface and in-app Claude subscription sign-in.

## Fork rules

1. **Beside, not inside.** Ozone code lives in its own modules:
   `apps/server/src/ozone/`, `apps/web/src/ozone/`, `packages/contracts/src/ozone*.ts`,
   `packages/client-runtime/src/state/ozone.ts`, `packages/ozone-templates/` and `docs/ozone/`.
2. **Upstream files change only at seams.** A seam is the smallest edit that registers Ozone code
   with upstream code. Tag it with a comment containing `ozone-seam` and list the file in
   [SEAMS.md](./SEAMS.md). `apps/server/src/ozone/seams.test.ts` fails when the two disagree.
3. **Do not rename upstream identifiers.** Package names, the `T3CODE_*` environment prefix, the
   `t3-code` MCP server key, URL schemes and storage keys stay as they are. Renaming them buys
   nothing and turns every upstream merge into a conflict.
4. **Do not put Ozone state in the orchestration core.** `Orchestrator.ts`, `ProjectionStore.ts`
   and the V2 command and event unions are upstream's hottest files. Ozone composes upstream's public
   services instead and keeps its own tables.

## Syncing with upstream

```sh
git fetch upstream main
git merge upstream/main
```

- Conflicts should only appear in files listed in [SEAMS.md](./SEAMS.md). Keep upstream's side and
  re-apply the seam.
- Upstream's GitHub workflows are parked in `.github/workflows-upstream/` because they need
  upstream's runners and secrets. If a merge adds a file to `.github/workflows/`, move it there.
- Re-read `packages/provider-core/src/server/orchestrationInstructions.ts` after each merge. The
  build kickoff and worker briefs are written against that text.
- Run `vp run typecheck` and the Ozone tests, then the app once.

## Defaults that differ from upstream

| Setting                     | Upstream                                   | Ozone      | Why                                                    |
| --------------------------- | ------------------------------------------ | ---------- | ------------------------------------------------------ |
| Product telemetry           | on, sent to upstream                       | off        | a fork must not report to upstream's servers           |
| Release checks              | upstream's npm package and GitHub releases | off        | Ozone is not that package                              |
| Data directory              | `~/.t3`                                    | `~/.ozone` | both can be installed on one machine                   |
| Default port                | 3773                                       | 3737       | same reason                                            |
| Ambient `ANTHROPIC_API_KEY` | passed to Claude                           | dropped    | subscription sign-in must not silently bill an API key |

Further reading: [orchestrator](./orchestrator.md), [data safety](./data-safety.md).
