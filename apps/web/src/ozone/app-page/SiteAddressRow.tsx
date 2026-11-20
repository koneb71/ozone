import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";

import { siteAddress } from "../deploy.logic";
import { useAppReach } from "../useAppReach";

/** Where the deployed app answers: a link, or plain text when only its own machine can open it. */
export function SiteAddressRow(props: {
  readonly url: string;
  readonly environmentId: EnvironmentId;
}) {
  const reach = useAppReach(props.environmentId);
  const site = siteAddress(props.url, reach.sharesMachine);
  if (site.href === null) {
    return (
      <SettingsRow
        title="Address"
        description={`Only ${reach.machine ?? "the computer that runs it"} can open this address. Add a domain, or deploy to a server, to open it from other devices.`}
        control={<span className="font-mono text-sm">{site.text}</span>}
      />
    );
  }
  return (
    <SettingsRow
      title="Address"
      control={
        <Button
          render={<a href={site.href} rel="noreferrer" target="_blank" />}
          size="xs"
          variant="ghost"
        >
          <span className="font-mono">{site.text}</span>
          <ExternalLinkIcon />
        </Button>
      }
    />
  );
}
