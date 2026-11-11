# Data safety

Ozone must never lose an app's data. This page is the contract and the reasons behind the code
that keeps it. Read it before changing `apps/server/src/ozone/runtime` or `apps/server/src/ozone/data`.

## The contract

1. **Data lives in named volumes.** A template's stateful service keeps its data in a named Docker
   volume labelled `ozone.data`. Nothing stateful lives in a container layer or an anonymous volume,
   so removing and recreating containers loses nothing.
2. **One code path removes a volume, and a person starts it.** Every Docker command goes through
   [`DockerCli`](../../apps/server/src/ozone/runtime/DockerCli.ts), which refuses `volume rm`,
   `volume prune`, `system prune --volumes` and `compose down|rm` with `-v`. A refusal is a defect,
   not an error to handle: reaching it means new code asked for something Ozone must not do.
   Start, stop, restart and rebuild therefore keep the data by construction. The exception is
   **Delete app**: `AppData.remove` takes a snapshot, and only when that worked asks the guard to
   let the volumes go. A test counts the places that may ask.
3. **Snapshots live outside the app.** [`AppData`](../../apps/server/src/ozone/data/AppData.ts)
   writes them under the server's state directory, in `ozone/backups/<app slug>/<snapshot id>/`.
   They survive the app's containers, its volume, its checkout and the app's own deletion.
4. **Restoring and deleting are a person's decisions.** They are offered in the app's menu and
   nowhere else. No MCP tool restores or deletes data. A restore first snapshots the data it is
   about to replace, so it can be undone. A deleted app leaves its last snapshot and its folder.
   Once confirmed, a restore or a deletion runs to its end in the server's own fiber: a window
   closed halfway must not leave a database dropped and empty.
5. **A destructive migration is never applied silently.**
   [`findDestructiveStatements`](../../apps/server/src/ozone/data/migrationGuard.ts) names the
   statements in a migration that can lose data. A build stops on them and asks.

## Why a restore drops the database

`pg_restore --clean` only replaces objects that are in the dump. A table created after the snapshot
would survive, while the migration journal went back in time, and the next start would fail trying
to create that table again. Restoring into a freshly created database gives exactly the state the
snapshot recorded. The app's service is stopped for the duration so nothing writes in between.

## Going back in History

[`AppHistory`](../../apps/server/src/ozone/history/AppHistory.ts) takes an app back to an earlier
commit with the data of that time: the newest snapshot taken at that commit. It never rewrites
history. Uncommitted changes are committed first, the data is restored (its safety snapshot is
filed under the commit being left, which is the data that belongs with it), and the old tree is
committed as a new commit. Going back is therefore undone by going back to the commit before it.
Build tasks whose commits the restored point lacks go back into their plans, and come back as done
when a later restore brings their commits back. A restore is refused while a build is working.

## Why the dump is copied, not streamed

Ozone reads command output as bounded text. A database dump is binary and can be large, so
`pg_dump` writes inside the container and `docker compose cp` moves the file to the host.

## Agents

An agent has a shell and could run `docker compose down -v` itself. The instructions Ozone writes
into every app forbid it, and no Ozone tool offers it. If it happens anyway, the newest snapshot is
the recovery, which is why a snapshot is taken after every task that passes its checks.

## Not covered yet

- Only `postgres` data services are snapshotted. A manifest may declare a service of kind `volume`,
  and Ozone runs it, but does not archive it.
- Deleting an app's project from upstream's own project menu, instead of **Delete app**, leaves its
  containers and volumes in Docker until someone removes them by hand.
- A deleted app's snapshot cannot be restored from the interface yet: there is no app left to
  restore it into.
- Snapshots Ozone takes by itself are pruned to the newest 20 per app. Ones a person takes are kept
  until removed by hand.
