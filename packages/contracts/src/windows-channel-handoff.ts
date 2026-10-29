import * as z from "zod";

/** Candidate installer-owned transport binding. No BUSINESS/GLOBAL identity or
 * grant. NOT a production enablement contract: SCM remains denied until native
 * peer validation and restricted pipe access are implemented and certified. */
export const WindowsChannelHandoffSchema=z.strictObject({
  profile:z.literal("CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1"),
  service_id:z.literal("CamachoPOSLocalService"),
  service_sid:z.string().regex(/^S-1-5-80-(?:[0-9]+-){4}[0-9]+$/),
  installation_id:z.uuid(),device_id:z.uuid(),
  recipient_sid:z.string().regex(/^S-1-5-21-(?:[0-9]+-){3}[0-9]+$/),
  recipient_logon_sid:z.string().regex(/^S-1-5-5-[0-9]+-[0-9]+$/),
  recipient_session_id:z.number().int().positive().max(2147483647),
  recipient_public_key_pem:z.string().min(400).max(4096),
  recipient_key_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  capsule_file:z.string().min(1).max(2048),
  not_before:z.iso.datetime(),expires_at:z.iso.datetime(),
  revision:z.number().int().positive().safe(),
  poll_ms:z.number().int().min(100).max(60000),
  policy_reference:z.string().min(1).max(256),
}).refine(v=>Date.parse(v.expires_at)>Date.parse(v.not_before),"HANDOFF_WINDOW_INVALID");
export type WindowsChannelHandoff= z.infer<typeof WindowsChannelHandoffSchema>;
