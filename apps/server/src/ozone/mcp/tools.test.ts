import { assert, it } from "@effect/vitest";
import {
  OZONE_DESIGN_COMPOSITIONS,
  OZONE_DESIGN_MATERIALS,
  OZONE_DESIGN_MOTIONS,
  OZONE_DESIGN_SKILLS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { advertisedJsonSchema } from "../../mcp/advertisedJsonSchema.ts";
import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import { PreviewToolkit } from "../../mcp/toolkits/preview/tools.ts";
import { ProjectToolkit } from "../../mcp/toolkits/project/tools.ts";
import { ThreadToolkit } from "../../mcp/toolkits/thread/tools.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import { OZONE_APP_INSTRUCTIONS } from "../apps/appInstructions.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as OzoneApps from "../apps/OzoneApps.ts";
import { NEXT, WAKE } from "../builds/briefs.ts";
import * as BuildConductor from "../builds/BuildConductor.ts";
import * as BuildDesign from "../builds/BuildDesign.ts";
import { skillFits } from "../builds/designVocabulary.ts";
import { verifierBrief } from "../builds/verification.ts";
import { OZONE_CHAT_INSTRUCTIONS } from "../chat/chatPersona.ts";
import * as AppEnv from "../env/AppEnv.ts";
import * as WebGuidance from "../guidance/WebGuidance.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import * as OzoneMcpHandlers from "./handlers.ts";
import { OzoneToolkit } from "./tools.ts";

// The MCP server rejects a tool whose schema it cannot advertise, and only when it starts.
it.effect("every Ozone tool registers with the MCP server", () =>
  Effect.gen(function* () {
    yield* Layer.build(
      McpHttpServer.toolkitRegistration(OzoneToolkit, OzoneMcpHandlers.layer).pipe(
        Layer.provide(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(BuildConductor.BuildConductor)({}),
            Layer.mock(BuildDesign.BuildDesign)({}),
            Layer.mock(AppRegistry.AppRegistry)({}),
            Layer.mock(AppRuntime.AppRuntime)({}),
            Layer.mock(AppEnv.AppEnv)({}),
            Layer.mock(WebGuidance.WebGuidance)({}),
            Layer.mock(OzoneApps.OzoneApps)({}),
            Layer.mock(ThreadManagementService.ThreadManagementService)({}),
            Layer.mock(ProviderRegistry.ProviderRegistry)({}),
          ),
        ),
      ),
    );
    assert.deepStrictEqual(Object.keys(OzoneToolkit.tools).toSorted(), [
      "ozone_app_create",
      "ozone_app_runtime",
      "ozone_build_advance",
      "ozone_build_check",
      "ozone_build_get",
      "ozone_build_plan",
      "ozone_build_resolve",
      "ozone_design_propose",
      "ozone_web_guidance",
    ]);
  }),
);

// An agent calls the names it reads. A renamed tool would leave these texts pointing at nothing.
it("the instructions Ozone writes name only tools that exist", () => {
  const tools = new Set(
    [OzoneToolkit, ProjectToolkit, ThreadToolkit, PreviewToolkit].flatMap((toolkit) =>
      Object.keys(toolkit.tools),
    ),
  );
  const texts = [
    OZONE_APP_INSTRUCTIONS,
    OZONE_CHAT_INSTRUCTIONS,
    ...Object.values(NEXT).filter((text) => typeof text === "string"),
    NEXT.designDeal([
      {
        skill: "gpt-taste",
        palette: {
          id: "white-link-blue",
          name: "Sheet and biro",
          note: "Blue is the colour of links and the one button.",
          colors: {
            background: "#ffffff",
            surface: "#f4f4f4",
            text: "#111111",
            muted: "#6b6b6b",
            accent: "#1a4be0",
            accentText: "#ffffff",
          },
        },
        type: {
          id: "geist",
          display: { family: "Geist", style: "sans" },
          body: { family: "Geist", style: "sans" },
        },
        fits: skillFits("gpt-taste", { dark: false }),
      },
    ]),
    WAKE.approved.text,
    WAKE.designPicked("Calm").text,
    WAKE.designLeft.text,
    verifierBrief(["A habit can be added."], 41_000),
  ];
  const named: ReadonlyArray<string> =
    texts.join("\n").match(/(?:ozone|t3|preview)_[a-z_]+/g) ?? [];
  assert.deepStrictEqual(
    named.filter((name) => !tools.has(name)),
    [],
  );
  assert.include(named, "t3_thread_launch");
});

// The lead sends what the schema it reads requires: a direction without these draws as a guess.
it("the design tool requires each direction's skill, composition, material, motion and copy", () => {
  const schema = advertisedJsonSchema(OzoneToolkit.tools.ozone_design_propose) as {
    readonly required: ReadonlyArray<string>;
    readonly properties: {
      readonly directions: {
        readonly items: {
          readonly required: ReadonlyArray<string>;
          readonly properties: Readonly<Record<string, { readonly enum?: ReadonlyArray<string> }>>;
        };
      };
    };
  };
  assert.deepStrictEqual(schema.required, ["kind"]);
  const { items } = schema.properties.directions;
  for (const key of ["skill", "composition", "material", "motion", "copy"]) {
    assert.include(items.required, key);
  }
  assert.deepStrictEqual(items.properties.skill?.enum, OZONE_DESIGN_SKILLS);
  assert.deepStrictEqual(items.properties.composition?.enum, OZONE_DESIGN_COMPOSITIONS);
  assert.deepStrictEqual(items.properties.material?.enum, OZONE_DESIGN_MATERIALS);
  assert.deepStrictEqual(items.properties.motion?.enum, OZONE_DESIGN_MOTIONS);
});
