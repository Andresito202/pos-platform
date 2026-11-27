import * as z from "zod";

export const ANDROID_COMMERCIAL_MIGRATION_IDS=["011_session_assertion_sequences","012_device_request_proof_replays","013_business_browser_sessions","014_commercial_refresh_binding","015_authorization_snapshot_sequences","016_native_business_authorization","022_license_activations","029_cash_register_master","033_cash_register_license_bindings","036_business_login_abuse_budget"];
const positive=z.number().int().positive().max(2147483647);
const file=z.string().min(1).max(4096);
const pin=z.string().regex(/^[a-f0-9]{64}$/);
export const AndroidCommercialProvisionSchema=z.strictObject({profile:z.literal("CAMACHO_ANDROID_CENTRAL_V1"),origin:z.url(),environment:z.enum(["PREPRODUCTION","PRODUCTION"]),
 migration_checksums:z.record(z.string(),pin),audience:z.string().min(1).max(128),
 access_private:file,access_public:file,access_key_id:z.string().min(1).max(96),access_valid_from:z.iso.datetime(),access_valid_until:z.iso.datetime(),
 ssa_private:file,ssa_root:file,ssa_root_pin:pin,ssa_operational:file,sas_private:file,sas_root:file,sas_root_pin:pin,sas_recipient_directory:file,
 challenge_ms:positive,request_ms:positive,challenges_per_minute:positive,code_ms:positive,access_ms:positive,refresh_ms:positive,artifact_ms:positive,
 proof_skew_ms:positive,rotation_window_ms:positive,rotations_per_window:positive,requests_per_address:positive});
