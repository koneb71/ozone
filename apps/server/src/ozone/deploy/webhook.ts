import { OZONE_DEPLOY_WEBHOOK_PATH } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import * as AppDeploy from "./AppDeploy.ts";

/**
 * `POST /api/ozone/deploy/<token>` deploys the app's last commit where it runs. The token in the
 * path is the only credential, as with a Git host's deploy hook; the Deploy dialog shows,
 * replaces and removes it.
 */
export const routeLayer = HttpRouter.add(
  "POST",
  `${OZONE_DEPLOY_WEBHOOK_PATH}/:token`,
  Effect.gen(function* () {
    const deploys = yield* AppDeploy.AppDeploy;
    const params = yield* HttpRouter.params;
    const result = yield* deploys
      .redeployByToken(params["token"] ?? "")
      .pipe(Effect.orElseSucceed(() => "unknown" as const));
    return yield* HttpServerResponse.json(
      { result },
      { status: result === "started" ? 202 : result === "busy" ? 409 : 404 },
    );
  }),
);
