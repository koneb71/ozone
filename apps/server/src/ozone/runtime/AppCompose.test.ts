import { assert, it } from "@effect/vitest";

import { composeOverride } from "./AppCompose.ts";

it("gives the app service its variables as typed, with Compose's interpolation escaped", () => {
  assert.isNull(composeOverride("app", { hostCaPath: null, variables: [] }));
  assert.strictEqual(
    composeOverride("app", {
      hostCaPath: "/etc/ca.crt",
      variables: [
        { name: "PRICE", value: 'costs $5 "today"\nand more' },
        // The person's own value for a name Ozone sets wins.
        { name: "SSL_CERT_FILE", value: "/mine.crt" },
      ],
    }),
    [
      "services:",
      '  "app":',
      "    environment:",
      '      NODE_EXTRA_CA_CERTS: "/ozone-host-ca.crt"',
      '      SSL_CERT_FILE: "/mine.crt"',
      '      PRICE: "costs $$5 \\"today\\"\\nand more"',
      "    volumes:",
      '      - "/etc/ca.crt:/ozone-host-ca.crt:ro"',
      "",
    ].join("\n"),
  );
});
