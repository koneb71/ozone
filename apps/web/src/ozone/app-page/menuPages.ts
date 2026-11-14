import {
  BoxIcon,
  DatabaseIcon,
  HistoryIcon,
  KeyRoundIcon,
  ListChecksIcon,
  type LucideIcon,
  RocketIcon,
  ScrollTextIcon,
} from "lucide-react";

import { APP_SECTION_LABEL, type AppSection } from "../appPage.logic";

const page = (section: AppSection, icon: LucideIcon, label = APP_SECTION_LABEL[section]) => ({
  section,
  icon,
  label,
});

/** The app's page as every menu links to it: the same names, icons and order. */
export const APP_MENU_PAGES = [
  page("overview", BoxIcon, "App page"),
  page("deploy", RocketIcon),
  page("data", DatabaseIcon),
  page("logs", ScrollTextIcon),
  page("history", HistoryIcon),
  page("environment", KeyRoundIcon),
  page("build", ListChecksIcon),
] as const;
