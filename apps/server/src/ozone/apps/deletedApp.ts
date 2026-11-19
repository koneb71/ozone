import { OzoneApp } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** Kept beside a deleted app's snapshots: what it takes to register it again. */
export const DELETED_RECORD_FILE = "app.json";
export const DeletedRecord = Schema.Struct({
  app: OzoneApp,
  workspaceRoot: Schema.String,
  deletedAt: Schema.NullOr(Schema.String),
});
export type DeletedRecord = typeof DeletedRecord.Type;
const DeletedRecordJson = Schema.fromJsonString(DeletedRecord);
export const decodeDeletedRecord = Schema.decodeUnknownEffect(DeletedRecordJson);
export const encodeDeletedRecord = Schema.encodeEffect(DeletedRecordJson);
