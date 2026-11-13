import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { HostDrivers, type HostDriver } from "./HostDriver.ts";
import { makeKoyeb } from "./Koyeb.ts";
import { makeRailway } from "./Railway.ts";
import { makeRender } from "./Render.ts";
import { makeVercel } from "./Vercel.ts";

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const newSecret = Effect.map(Effect.all([random.uuidV4(), random.uuidV4()]), (parts) =>
    parts.join("").replaceAll("-", ""),
  );
  const drivers = {
    railway: makeRailway(http, newSecret),
    render: makeRender(http),
    koyeb: makeKoyeb(http),
    vercel: makeVercel(http, fs, path),
  } satisfies Record<string, HostDriver>;
  return HostDrivers.of({ of: (provider) => drivers[provider] });
});

export const layer = Layer.effect(HostDrivers, make);
