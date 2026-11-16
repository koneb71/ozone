import { OzoneAppError } from "@t3tools/contracts";

export const failed = (message: string) => new OzoneAppError({ reason: "failed", message });

export const storageFailed = (action: string) => () => failed(`Ozone could not ${action}.`);
