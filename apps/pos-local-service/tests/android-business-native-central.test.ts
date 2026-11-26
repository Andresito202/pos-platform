import { expect, it, vi } from "vitest";
import { AndroidBusinessNativeCentralClient } from "../src/android/android-business-native-central.js";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://central.example.dev";
const clientId = "android-commercial";
const audience = "commercial";
const refreshToken = "r".repeat(64);
const nextRefreshToken = "s".repeat(64);

it("renews the selected Android session with fresh possession and requests the new SSA and SAS", async () => {
  const now = new Date();
  const until = new Date(now.getTime() + 60_000);
  const claims = {
    ver: 2, iss: origin, aud: audience, sub: id(1), sid: id(2), tid: id(3), mid: id(4),
    did: id(5), iid: id(6), cid: id(7), client_id: clientId, fid: id(8), jti: id(9),
    iat: Math.floor(now.getTime() / 1_000), exp: Math.floor(until.getTime() / 1_000),
    cnf: { jkt: "x".repeat(43) },
  };
  const accessToken = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  const shared = {
    user_id: claims.sub, installation_id: claims.iid, device_id: claims.did, sequence: 2,
    issued_at: now.toISOString(), key_id: "TEST_KEY",
  };
  const signature = "x".repeat(86);
  const ssa = { claims: { ...shared, session_id: claims.sid, tenant_membership_id: claims.mid, offline_valid_until: until.toISOString() }, signature };
  const sas = { claims: { ...shared, snapshot_id: id(10), expires_at: until.toISOString(), assignments: [] }, signature };
  const refreshPossession = vi.fn(async () => "refresh-proof");
  const revokePossession = vi.fn(async () => "revoke-proof");
  const credential = {
    authorization: vi.fn(), refreshPossession, revokePossession,
    sessionAssertionPossession: vi.fn(async () => "ssa-proof"),
    authorizationSnapshotPossession: vi.fn(async () => "sas-proof"),
  };
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    switch (new URL(String(url)).pathname) {
      case "/v1/commercial/refresh":
        expect(new Headers(init?.headers).get("authorization")).toBe("refresh-proof");
        return Response.json({ accessToken, refreshToken: nextRefreshToken });
      case "/v1/business-session/assertions":
        return Response.json({ session_assertion: ssa });
      case "/v1/business-session/authorization":
        return Response.json({ authorization_snapshot: sas });
      case "/v1/commercial/revoke":
        expect(new Headers(init?.headers).get("authorization")).toBe("revoke-proof");
        return Response.json({ revoked: true });
      default:
        throw new Error("Unexpected test route");
    }
  });
  const client = new AndroidBusinessNativeCentralClient(origin, credential, transport, 1_000,
    { clientId, audience, redirectUri: `${origin}/android/callback` });

  await expect(client.refresh(refreshToken, claims.sid, claims.sub)).resolves.toEqual({
    session_assertion: ssa, authorization_snapshot: sas, refreshToken: nextRefreshToken,
  });
  expect(refreshPossession).toHaveBeenCalledWith(expect.objectContaining({
    token: refreshToken, clientId, audience,
    body: JSON.stringify({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }),
  }));
  expect(transport).toHaveBeenCalledTimes(3);
  await expect(client.refresh(refreshToken, id(11), claims.sub)).rejects.toThrow("CENTRAL_ACCESS_BINDING_REJECTED");
  expect(transport).toHaveBeenCalledTimes(4);
  await expect(client.revoke(nextRefreshToken)).resolves.toBeUndefined();
  expect(revokePossession).toHaveBeenCalledWith(expect.objectContaining({ token: nextRefreshToken }));
  expect(credential.authorization).not.toHaveBeenCalled();
});
