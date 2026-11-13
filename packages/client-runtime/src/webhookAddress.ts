import type { ScheduledTaskWebhookEndpoint } from "@t3tools/contracts";

export interface WebhookAddress {
  readonly address: string;
  /** False when only the path is known, because no address for the environment is. */
  readonly copyable: boolean;
}

export function webhookAddress(
  endpoint: ScheduledTaskWebhookEndpoint,
  httpBaseUrl: string | null,
): WebhookAddress {
  return httpBaseUrl === null
    ? { address: endpoint.path, copyable: false }
    : { address: new URL(endpoint.path, httpBaseUrl).href, copyable: true };
}
