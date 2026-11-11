import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, OzoneApp, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpIcon, BoxIcon, HammerIcon, MessageCircleIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { DiscoveryList, DiscoveryListRow } from "~/components/ui/discovery-list";
import { SidebarInset } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import { useThreadShells } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { buildThreadRouteParams } from "~/threadRoutes";

import { runtimePhaseLabel } from "./home.logic";
import { OzoneMark } from "./OzoneMark";
import { ozoneEnvironment } from "./state";
import { useOzoneLaunch } from "./useOzoneLaunch";

type HomeMode = "build" | "chat";

const MODE_COPY = {
  build: {
    title: "What do you want to build?",
    description: "Describe an app. Ozone builds it, runs it in Docker and keeps its data safe.",
    placeholder: "A habit tracker with streaks and a weekly chart",
    action: "Build the app",
  },
  chat: {
    title: "What is on your mind?",
    description: "Ask anything. You can attach files once the chat is open.",
    placeholder: "Ask a question, or think something through",
    action: "Start the chat",
  },
} as const;

export function OzoneHome() {
  const contentArea = workspaceAreaProps("home", 1, "Home");
  const environmentId = usePrimaryEnvironmentId();
  const launch = useOzoneLaunch();
  const [mode, setMode] = useState<HomeMode>("build");
  const [prompt, setPrompt] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apps = useEnvironmentQuery(
    environmentId === null ? null : ozoneEnvironment.apps({ environmentId, input: {} }),
  );
  const copy = MODE_COPY[mode];
  const docker = apps.data?.docker;
  const dockerMissing = mode === "build" && docker !== undefined && !docker.available;
  const canSubmit =
    environmentId !== null && !launching && !dockerMissing && prompt.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || environmentId === null) return;
    setLaunching(true);
    setError(null);
    const outcome =
      mode === "build"
        ? await launch.build(environmentId, prompt.trim())
        : await launch.chat(environmentId, prompt.trim());
    setLaunching(false);
    if (outcome !== null) setError(outcome);
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="scrollbar-gutter-both flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background">
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-12">
          <header className="flex flex-col items-center gap-3 text-center">
            <OzoneMark aria-hidden="true" className="size-9 text-foreground" />
            <h1 className="text-balance font-semibold text-3xl text-foreground tracking-tight">
              {copy.title}
            </h1>
            <p className="text-pretty text-muted-foreground text-sm">{copy.description}</p>
          </header>

          <form
            className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-ring [&_textarea]:resize-none"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Textarea
              unstyled
              aria-label={copy.title}
              autoFocus
              disabled={launching}
              placeholder={copy.placeholder}
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={submitOnEnter}
            />
            <div className="flex items-center justify-between gap-2">
              <ToggleGroup
                aria-label="What to start"
                disabled={launching}
                value={[mode]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "build" || value === "chat") setMode(value);
                  setError(null);
                }}
              >
                <Toggle value="build">
                  <HammerIcon />
                  Build
                </Toggle>
                <Toggle value="chat">
                  <MessageCircleIcon />
                  Chat
                </Toggle>
              </ToggleGroup>
              <Button aria-label={copy.action} disabled={!canSubmit} size="icon" type="submit">
                {launching ? <Spinner /> : <ArrowUpIcon />}
              </Button>
            </div>
          </form>

          {dockerMissing ? (
            <Alert variant="warning">
              <AlertTitle>Ozone needs Docker to build and run apps</AlertTitle>
              <AlertDescription>{docker.message}</AlertDescription>
            </Alert>
          ) : null}
          {error === null ? null : (
            <Alert variant="error">
              <AlertTitle>That did not start</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {environmentId !== null && apps.data !== null && apps.data.apps.length > 0 ? (
            <section aria-label="Your apps" className="flex flex-col gap-2">
              <h2 className="font-medium text-muted-foreground text-xs">Your apps</h2>
              <AppList apps={apps.data.apps} environmentId={environmentId} />
            </section>
          ) : null}
        </div>
      </div>
    </SidebarInset>
  );
}

function AppList(props: {
  readonly apps: ReadonlyArray<OzoneApp>;
  readonly environmentId: EnvironmentId;
}) {
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const threads = useThreadShells();

  const latestThreadByProject = new Map<string, { id: ThreadId; updatedAt: string }>();
  for (const thread of threads) {
    if (thread.environmentId !== props.environmentId) continue;
    const latest = latestThreadByProject.get(thread.projectId);
    if (latest === undefined || thread.updatedAt > latest.updatedAt) {
      latestThreadByProject.set(thread.projectId, thread);
    }
  }

  const open = (app: OzoneApp) => {
    const latest = latestThreadByProject.get(app.projectId);
    if (latest === undefined) {
      void handleNewThread(scopeProjectRef(props.environmentId, app.projectId));
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, latest.id)),
    });
  };

  return (
    <DiscoveryList>
      {props.apps.map((app) => (
        <AppRow
          key={app.projectId}
          app={app}
          environmentId={props.environmentId}
          onOpen={() => open(app)}
        />
      ))}
    </DiscoveryList>
  );
}

function AppRow(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly onOpen: () => void;
}) {
  const status = useEnvironmentQuery(
    ozoneEnvironment.runtimeStatus({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId },
    }),
  );
  const phase = runtimePhaseLabel(status.data?.phase);
  return (
    <DiscoveryListRow
      icon={<BoxIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
      title={props.app.name}
      description={`localhost:${props.app.port}`}
      action={<Badge variant={phase.tone}>{phase.label}</Badge>}
      onClick={props.onOpen}
    />
  );
}
