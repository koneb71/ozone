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
   **Delete app**: `AppData.remove` takes a snapshot, removes the containers, and only then asks
   the guard to let go of the volumes that snapshot holds. A test checks it is the only asker. The
   Compose project is named after the app's slug, never read from its compose file: agents can edit
   that file, and Delete app must not reach another project, such as the app's production one.
3. **Snapshots live outside the app.** [`AppData`](../../apps/server/src/ozone/data/AppData.ts)
   writes them under the server's state directory, in `ozone/backups/<app slug>/<snapshot id>/`.
   They survive the app's containers, its volume, its checkout and the app's own deletion.
4. **Restoring and deleting are a person's decisions.** They are offered in the app's menu and
   nowhere else. No MCP tool restores or deletes data. A restore first snapshots the data it is
   about to replace, so it can be undone. A deleted app leaves its last snapshot, its folder and
   a record beside the snapshot, and Home brings it back from those: a project for the folder,
   the same slug, and the snapshot loaded before the app first starts. Volumes still in Docker
   are newer than any snapshot and are left as they are.
   Once confirmed, a restore or a deletion runs to its end in the server's own fiber: a window
   closed halfway must not leave a database dropped and empty. While one runs, every start and stop
   of the app waits for it, so an agent's restart cannot run the app on a database just dropped.
5. **A migration that can lose data runs only when a person applies it.** The check lives in each
   app's own migrate command (`src/db/migration-guard.ts`), because every path runs that command:
   the container's start, and so every restart, rebuild, settings change and restore; an agent's
   `./dev npm run db:migrate`; a build's check; and production's `migrate` step. It holds back a
   pending migration with a statement that
   [`findDestructiveStatements`](../../apps/server/src/ozone/data/migrationGuard.ts) flags, applies
   nothing, and writes `.ozone/migrations.json`. The app's banner shows it, and **Apply after a
   snapshot** takes a snapshot and runs it with a token naming the exact SQL the person saw, once.
   No MCP tool can apply it, and a build's lead cannot accept such a task until the person has. A
   test keeps the app's copy of the rules and Ozone's the same.

## Why a restore drops the database

`pg_restore --clean` only replaces objects that are in the dump. A table created after the snapshot
would survive, while the migration journal went back in time, and the next start would fail trying
to create that table again. Restoring into a freshly created database gives exactly the state the
snapshot recorded. The app's service is stopped for the duration so nothing writes in between.

## Going back in History

[`AppHistory`](../../apps/server/src/ozone/history/AppHistory.ts) takes an app back to an earlier
commit with the data of that time: the newest snapshot taken at that commit. It never rewrites
history. Uncommitted changes are committed first. The app is stopped, the data is restored (its
safety snapshot is filed under the commit being left, which is the data that belongs with it), the
old tree is committed as a new commit, and only then does the app start: started on the newer
code, it would migrate the restored data forward. Going back is therefore undone by going back to
the commit before it.
Build tasks whose commits the restored point lacks go back into their plans, and come back as done
when a later restore brings their commits back. A restore is refused while a build is working.

## Production

[`AppDeploy`](../../apps/server/src/ozone/deploy/AppDeploy.ts) treats production's data as another
target of the same snapshot code. Every deploy after the first to a place saves it before its
migrations run, and the Data dialog takes and restores snapshots of it. A restore runs the deployed
version's migrations afterwards, because that version expects its own schema whatever the snapshot
had. A first deploy to a new place can start from the data of the place before: that data is
saved, loaded into the new database before the app starts, and the old deploy is stopped with its
volume left in place. Each command runs against an export of the commit that is deployed, never the
working tree. An app whose production is running cannot be deleted: Ozone could no longer reach it.

## Why the dump is copied, not streamed

Ozone reads command output as bounded text. A database dump is binary and can be large, so
`pg_dump` writes inside the container and `docker compose cp` moves the file to the host.

## Agents

An agent has a shell and could run `docker compose down -v` itself, or edit the migrate command
to get past its check. The instructions Ozone writes into every app forbid both, and no Ozone tool
offers either. If it happens anyway, the newest snapshot is the recovery, which is why a snapshot
is taken after every task that passes its checks.

## Not covered yet

- Apps made before the migrate command held migrations back still apply them silently. A build
  stops on a new one, possibly after a worker applied it. Copying `src/db/migration-guard.ts`,
  `src/db/migrate.ts`, `docker/dev-entrypoint.sh` and the `.gitignore` line from the template
  upgrades an app.
- Only `postgres` data services are snapshotted. A manifest may declare a service of kind `volume`,
  and Ozone runs it, but does not archive it.
- Deleting an app's project from upstream's own project menu, instead of **Delete app**, leaves its
  containers and volumes in Docker until someone removes them by hand.
- A deleted app comes back without its threads: upstream deletes them with the project.
- A deployed app's data lives in a volume of its own (`<slug>-prod_pgdata`) that nothing in Ozone
  removes. Its snapshots are kept apart, in `backups/<slug>/production/`, on this machine even when
  the app runs on a server. Moving to another server was tried with scripted Docker only.
- Routine snapshots, the one after each task and the one before a rebuild, are pruned to the newest
  20 per app. A person's own snapshots and the undo points of a restore or a delete are kept until
  removed by hand.
- Delete app leaves the volumes its snapshot does not hold, such as a `volume` service's data or a
  dependency cache, in Docker. They lose nothing and take disk space until removed by hand.
