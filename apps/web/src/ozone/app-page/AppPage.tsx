import { EnvironmentId, ProjectId, type OzoneApp } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ActivityIcon,
  BellIcon,
  BoxIcon,
  DatabaseIcon,
  HistoryIcon,
  KeyRoundIcon,
  ListChecksIcon,
  type LucideIcon,
  RocketIcon,
  ScrollTextIcon,
  ServerCogIcon,
  ServerIcon,
} from "lucide-react";

import { AppRouteModal, AppRouteModalClose } from "~/components/AppRouteModal";
import { SettingsPageContainer } from "~/components/settings/settingsLayout";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";
import { cn } from "~/lib/utils";

import {
  APP_SECTION_GROUPS,
  APP_SECTION_LABEL,
  appSectionOf,
  needsDeploy,
  type AppSection,
} from "../appPage.logic";
import { useApp } from "../state";
import { PendingRow } from "../ui/SectionRows";
import { AppHeaderActions } from "./AppHeaderActions";
import { BuildSection } from "./BuildSection";
import { DataSection } from "./DataSection";
import { DeploymentsSection } from "./DeploymentsSection";
import { DeploySection } from "./DeploySection";
import { EnvironmentSection } from "./EnvironmentSection";
import { HistorySection } from "./HistorySection";
import { LogsSection } from "./LogsSection";
import { MonitoringSection } from "./MonitoringSection";
import { NotificationsSection } from "./NotificationsSection";
import { OverviewSection } from "./OverviewSection";
import { ServersSection } from "./ServersSection";
import { useAppDeploy, type AppDeploy } from "./useAppDeploy";

const SECTION_ICON: Record<AppSection, LucideIcon> = {
  overview: BoxIcon,
  data: DatabaseIcon,
  history: HistoryIcon,
  environment: KeyRoundIcon,
  build: ListChecksIcon,
  logs: ScrollTextIcon,
  deploy: RocketIcon,
  deployments: ServerIcon,
  monitoring: ActivityIcon,
  servers: ServerCogIcon,
  notifications: BellIcon,
};

export function AppPageRoute(props: {
  readonly params: { environmentId: string; projectId: string; section: string };
}) {
  return (
    <AppPage
      environmentId={EnvironmentId.make(props.params.environmentId)}
      projectId={ProjectId.make(props.params.projectId)}
      section={appSectionOf(props.params.section)}
    />
  );
}

/** One app's page, opened over the app the way Settings opens: its sections on the left. */
function AppPage(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly section: AppSection;
}) {
  const { app, loaded, error, retry } = useApp(props.environmentId, props.projectId);
  const deploy = useAppDeploy(app, props.environmentId);
  const deployed = deploy.status?.target != null;

  return (
    <AppRouteModal label={app === null ? "App" : app.name}>
      <div className="relative flex min-h-0 flex-1">
        <AppPageNav {...props} deployed={deployed} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
            <WorkspaceBreadcrumb ariaLabel="App breadcrumb">
              <WorkspaceBreadcrumbItem className="max-sm:hidden">
                {app?.name ?? "App"}
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator className="max-sm:hidden" />
              <WorkspaceBreadcrumbItem current className="truncate">
                {APP_SECTION_LABEL[props.section]}
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <div className="ms-auto flex shrink-0 items-center gap-1">
              {app === null ? null : (
                <AppHeaderActions
                  app={app}
                  environmentId={props.environmentId}
                  deploy={deploy}
                  onDeploySection={props.section === "deploy"}
                />
              )}
              <AppRouteModalClose />
            </div>
          </header>
          <div key={props.section} className="flex min-h-0 flex-1 flex-col">
            {app === null ? (
              !loaded ? (
                <SettingsPageContainer>
                  <PendingRow error={error} onRetry={retry} loadingLabel="Loading the app" />
                </SettingsPageContainer>
              ) : (
                <Empty className="flex-1">
                  <EmptyHeader>
                    <EmptyTitle>This app is not here</EmptyTitle>
                    <EmptyDescription>
                      It was deleted, or it belongs to a computer this window is not connected to.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )
            ) : (
              <Section
                app={app}
                environmentId={props.environmentId}
                section={props.section}
                deploy={deploy}
              />
            )}
          </div>
        </div>
      </div>
    </AppRouteModal>
  );
}

function Section(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly section: AppSection;
  readonly deploy: AppDeploy;
}) {
  const shared = { app: props.app, environmentId: props.environmentId };
  const deployed = props.deploy.status?.target != null;
  switch (props.section) {
    case "overview":
      return <OverviewSection {...shared} deploy={props.deploy} />;
    case "data":
      return <DataSection {...shared} deployed={deployed} />;
    case "history":
      return <HistorySection {...shared} />;
    case "environment":
      return <EnvironmentSection {...shared} />;
    case "build":
      return <BuildSection {...shared} deployed={deployed} />;
    case "logs":
      return <LogsSection {...shared} />;
    case "deploy":
      return <DeploySection {...shared} deploy={props.deploy} />;
    case "deployments":
      return <DeploymentsSection {...shared} deployed={deployed} />;
    case "monitoring":
      return <MonitoringSection {...shared} deploy={props.deploy} />;
    case "servers":
      return <ServersSection environmentId={props.environmentId} />;
    case "notifications":
      return <NotificationsSection environmentId={props.environmentId} />;
  }
}

function AppPageNav(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly section: AppSection;
  readonly deployed: boolean;
}) {
  const navigate = useNavigate();
  return (
    <nav
      aria-label="App sections"
      className="flex w-60 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground max-md:w-14"
    >
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <div className="flex flex-col gap-4">
            {APP_SECTION_GROUPS.map((group, index) => (
              <div
                key={group.heading}
                className="flex flex-col gap-1 max-md:border-t max-md:border-sidebar-border max-md:pt-4 max-md:first:border-t-0 max-md:first:pt-0"
              >
                <h3
                  id={`app-nav-group-${index}`}
                  className="px-2 text-xs font-medium text-sidebar-muted-foreground/80 max-md:sr-only"
                >
                  {group.heading}
                </h3>
                <div role="group" aria-labelledby={`app-nav-group-${index}`}>
                  <SidebarMenu>
                    {group.sections.map((section) => {
                      const Icon = SECTION_ICON[section];
                      const isActive = props.section === section;
                      const unavailable = needsDeploy(section) && !props.deployed;
                      return (
                        <SidebarMenuItem key={section}>
                          <SidebarMenuButton
                            aria-current={isActive ? "page" : undefined}
                            isActive={isActive}
                            disabled={unavailable}
                            onClick={() =>
                              void navigate({
                                to: "/apps/$environmentId/$projectId/$section",
                                params: {
                                  environmentId: props.environmentId,
                                  projectId: props.projectId,
                                  section,
                                },
                                replace: true,
                              })
                            }
                          >
                            <Icon />
                            <span className={cn("truncate", "max-md:sr-only")}>
                              {APP_SECTION_LABEL[section]}
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </div>
              </div>
            ))}
          </div>
        </SidebarGroup>
      </SidebarContent>
    </nav>
  );
}
