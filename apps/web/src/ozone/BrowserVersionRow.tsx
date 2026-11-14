import type { EnvironmentId, OzoneVersionCheck } from "@t3tools/contracts";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useAtomCommand } from "~/state/use-atom-command";
import { manualServerUpdateCommand } from "~/versionSkew";

import { ozoneEnvironment } from "./state";
import { useOzoneCommand } from "./ui/useOzoneCommand";

/**
 * The Version row where no desktop shell updates Ozone. Nothing looks for a newer version until
 * the person presses the button, and then the server that runs Ozone asks, not this browser.
 */
export function BrowserVersionRow(props: {
  readonly id: string;
  readonly title: ReactNode;
  readonly environmentId: EnvironmentId | null;
}) {
  const check = useAtomCommand(ozoneEnvironment.checkVersion, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [found, setFound] = useState<OzoneVersionCheck | null>(null);
  const environmentId = props.environmentId;
  const command = found?.newer ? manualServerUpdateCommand(found.latest) : null;

  const look = async () => {
    if (environmentId === null) return;
    const result = await run("check", "Could not check for updates", () =>
      check({ environmentId, input: {} }),
    );
    if (result._tag === "Success") setFound(result.value);
  };

  return (
    <SettingsRow
      id={props.id}
      title={props.title}
      description={
        found === null ? (
          "Current version of the application."
        ) : command === null ? (
          `Ozone ${found.current} is the newest version.`
        ) : (
          <>
            Ozone {found.latest} is available. On the computer that runs Ozone, run{" "}
            <code className="font-mono">{command}</code>.
          </>
        )
      }
      control={
        command === null ? (
          <Button
            disabled={environmentId === null || working !== null}
            size="sm"
            variant="outline"
            onClick={() => void look()}
          >
            {working === "check" ? <Spinner /> : null}
            Check for Updates
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => copyToClipboard(command, undefined)}>
            {isCopied ? <CheckIcon /> : <CopyIcon />}
            {isCopied ? "Copied" : "Copy command"}
          </Button>
        )
      }
    />
  );
}
