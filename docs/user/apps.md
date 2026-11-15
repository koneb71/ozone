# Apps and builds

An app is a real project on your disk that Ozone creates from a template, runs with Docker
Compose and builds with coding agents. You describe what you want; Ozone plans the work, checks
each step itself and shows you the running app.

![Home](../ozone/assets/home.png)

## Before you start

You need Docker with Compose running on the same machine, and one signed-in provider. Home says
so when either is missing.

## Create an app

1. On Home, choose **Build**.
2. Pick a template beside the message box:
   - **Web app**: pages, sign-in and a Postgres database.
   - **Landing page**: pages only, no database.
   - **API**: an HTTP API with a Postgres database.
3. To use a model other than your default, pick it beside the template.
4. Describe the app and press Enter. You can attach sketches or files.

The first time, Ozone asks where to keep your apps. Each app gets its own folder inside the one
you choose, on the machine Ozone's server runs on. To change it later, open **Settings →
Threads** and set **Apps are saved in**. Apps you already have stay where they are.

Ozone creates the project in a git repository of its own, starts its containers and opens a
thread where the build runs. The preview opens beside the thread when the app is up.

To see the plan before any work starts, turn on **Plan first**. The agent then cannot change
anything while it plans: it reads the app, asks you its questions on a card in the conversation,
and shows its plan on a card with **View plan**, **Approve**, **Keep planning** and **Decline**.
Approve starts the build. Keep planning lets you say what to change. Decline drops the plan.

Plan first applies to every request while it is on, including a small change to an app that is
already built. Turn it off when you want quick edits made straight away. The same switch sits
above the message box in an app's thread, and as **Show me the plan first** on the app's Build
page.

A few providers have no plan mode of their own. With those the agent files its plan as a task
list instead, and **Start building** on that card begins the work.

## What a build does

A lead agent turns your request into tasks. A worker agent does each task. After every task
Ozone itself runs the app's type check, linter and tests inside the app's container. A task that
fails goes to a fresh worker with the evidence. A task that passes becomes a commit and a
snapshot of the app's data.

When every task has passed, a tester can use the app in a browser against what you asked for.
Turn that on or off under **Build** on the app's page.

Ask for a change in the same thread to start another build on the same app.

## The app's page

Open it from Home, or from the app's status bar above the message box.

- **Overview**: the app's address and state, and start, stop, restart and rebuild.
- **Data**: snapshots of the app's database, and restoring one.
- **History**: every finished task. Go back to any of them, code and data together, and undo
  that the same way.
- **Environment**: settings and secrets for the app. They reach its container and never its code.
- **Build**: whether to show the plan first, whether a tester tries the finished app, which model
  the workers use, and whether to deploy when a build completes.
- **Logs**: what the app's containers print.
- **Deploy**, **Deployments**, **Monitoring**: see [Deploying an app](./deploy.md).

## Your data is kept

An app's database lives in a Docker volume that only **Delete app** removes, and only after a
snapshot. Home can bring a deleted app back with that data.

A migration that could lose data does not run by itself. Ozone shows you its statements and waits
until you apply it, after taking a snapshot.

## Chats

Choose **Chat** on Home for a plain conversation that takes files. Ask a chat for an app and it
starts one.
