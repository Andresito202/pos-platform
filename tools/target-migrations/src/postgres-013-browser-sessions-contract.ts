import type {MigrationDescriptor} from "./contract.js";
export const BROWSER_SESSION_013_TABLES=["identity.browser_session_handoffs","identity.browser_sessions"] as const;
export const POSTGRES_013_DESCRIPTOR:MigrationDescriptor={
  migrationId:"013_business_browser_sessions",manifestVersion:1,
  dependencies:["012_device_request_proof_replays"],
  upArtifact:"postgres/013_business_browser_sessions.up.sql",downArtifact:"postgres/013_business_browser_sessions.down.sql",
  checksum:"DERIVED_FROM_UP_ARTIFACT",ownedSchemas:["identity"],ownedTables:BROWSER_SESSION_013_TABLES,
  ownedPolicies:"DERIVED_FROM_UP_ARTIFACT",ownedConstraints:"DERIVED_FROM_UP_ARTIFACT",ownedIndexes:"DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions:[],expectedLedgerState:"APPLIED",
};
