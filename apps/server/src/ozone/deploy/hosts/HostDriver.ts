import type { OzoneAppError, OzoneHostProvider } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** What a host has made for an app, by the names the host's driver gives them. */
export type HostIds = Readonly<Record<string, string>>;

/** What a driver needs to know about the app it puts on a host. */
export interface HostApp {
  readonly name: string;
  readonly slug: string;
  readonly port: number;
  readonly healthPath: string;
  /** Null: the app keeps no data. */
  readonly database: { readonly user: string; readonly database: string } | null;
}

/** The commit a host builds: pushed to a remote it clones, or a folder of its files. */
export interface HostSource {
  readonly commitSha: string;
  readonly remote: { readonly url: string; readonly branch: string } | null;
  /** The commit's files on this machine, for a host that takes an upload. */
  readonly files: Effect.Effect<string, OzoneAppError>;
}

export interface HostPlace {
  readonly ids: HostIds;
  /** Where people reach the app. */
  readonly url: string;
  /** `internal` is what the app connects to; `external` is what this machine migrates through. */
  readonly database: { readonly internal: string; readonly external: string } | null;
}

export type HostOutcome =
  /** `url` is set by a host that only knows the app's address once it runs. */
  { readonly ok: true; readonly url?: string } | { readonly ok: false; readonly log: string };
export type HostState = "running" | "stopped" | "deploying" | "failed";
type Note = (text: string) => Effect.Effect<void>;

/**
 * One hosting platform. A driver makes what the app needs there once, then builds and starts a
 * commit. It never deletes a service, a database or a project: their data is the host's to keep.
 */
export interface HostDriver {
  /** The host's name, as a person reads it. */
  readonly label: string;
  /** False for a host that takes the files themselves instead of cloning a remote. */
  readonly clones: boolean;
  /** False for a host that cannot run a database beside the app. */
  readonly keepsData: boolean;
  /** Fails, in words a person can act on, unless the token works. */
  readonly verify: (token: string) => Effect.Effect<void, OzoneAppError>;
  /**
   * Makes the project, the database and the service that are not there yet. `save` keeps each id
   * as soon as it exists, so a deploy that stops halfway does not make them twice.
   */
  readonly ensure: (input: {
    readonly token: string;
    readonly app: HostApp;
    readonly source: HostSource;
    readonly ids: HostIds;
    readonly save: (ids: HostIds) => Effect.Effect<void, OzoneAppError>;
    readonly note: Note;
  }) => Effect.Effect<HostPlace, OzoneAppError>;
  /** Sets the app's variables, builds the commit, and waits until it runs or fails. */
  readonly release: (input: {
    readonly token: string;
    readonly app: HostApp;
    readonly source: HostSource;
    readonly place: HostPlace;
    readonly env: ReadonlyMap<string, string>;
    readonly note: Note;
  }) => Effect.Effect<HostOutcome, OzoneAppError>;
  readonly state: (token: string, ids: HostIds) => Effect.Effect<HostState, OzoneAppError>;
  /** Stops the app and keeps everything it has. */
  readonly stop: (token: string, ids: HostIds) => Effect.Effect<void, OzoneAppError>;
  readonly logs: (
    token: string,
    ids: HostIds,
    tail: number,
  ) => Effect.Effect<string, OzoneAppError>;
}

/** The driver of each host Ozone knows. */
export class HostDrivers extends Context.Service<
  HostDrivers,
  { readonly of: (provider: OzoneHostProvider) => HostDriver }
>()("t3/ozone/deploy/hosts/HostDriver/HostDrivers") {}
