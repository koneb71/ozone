/** Settings pages a Settings row opens. */
export const SETTINGS_PAGE_TARGETS = [
  "SettingsEnvironments",
  "SettingsNotifications",
  "SettingsThreads",
  "SettingsAbout",
  "SettingsArchive",
  "SettingsAppearance",
  "SettingsLanguage",
  "SettingsNavigation",
  "SettingsOrganization",
  "SettingsProjectOverview",
  "SettingsEnvironmentSourceControl",
  "SettingsWorktrees",
  "SettingsLabs",
  "SettingsEnvironmentMaintenance",
  "SettingsProviderAccounts",
  "SettingsKeyboard",
  "SettingsVoice",
  "SettingsFollowUp",
  "SettingsScheduledTasks",
  "SettingsProjectGrouping",
  "SettingsClientStorage",
  "SettingsDiagnostics",
  "SettingsOpenSourceLicenses",
  "SettingsUsage",
  // ozone-seam: the page that lists Ozone's apps.
  "SettingsOzoneApps",
] as const;

export type SettingsPageTarget = (typeof SETTINGS_PAGE_TARGETS)[number];

export type SettingsLegalDocumentTarget = "SettingsLegal";
