import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request, type Server } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { createGlobalAdministrationAssets } from "../src/global-administration-assets.js";
import { businessTestTls } from "./helpers/business-test-tls.js";

const tls = businessTestTls();
const servers: Server[] = [];

function fixtureDir() {
  const root = mkdtempSync(join(tmpdir(), "pos-assets-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "platform.html"), "<!doctype html><title>t</title>");
  return root;
}

async function serve(turnstileEnabled: boolean): Promise<{ origin: string; port: number }> {
  const directory = fixtureDir();
  const server = createServer(tls);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw Error("TEST_LISTENER_MISSING");
  const origin = `https://127.0.0.1:${address.port}`;
  const handler = createGlobalAdministrationAssets({
    directory, origin, maximumAssetBytes: 1_048_576, turnstileEnabled,
  });
  server.on("request", (req, res) => { void handler(req, res); });
  return { origin, port: address.port };
}

async function csp(port: number): Promise<string | undefined> {
  return await new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1", port, path: "/platform/", method: "GET", ca: tls.cert,
    }, res => {
      res.resume();
      res.on("end", () => {
        const header = res.headers["content-security-policy"];
        resolve(Array.isArray(header) ? header[0] : header);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server =>
    new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))));
});

describe("administration asset CSP", () => {
  it("keeps closed CSP when Turnstile is off", async () => {
    const { port } = await serve(false);
    const header = await csp(port);
    expect(header).toContain("script-src 'self'");
    expect(header).not.toContain("challenges.cloudflare.com");
  });

  it("opens Cloudflare script/frame hosts when Turnstile is enabled", async () => {
    const { port } = await serve(true);
    const header = await csp(port);
    expect(header).toContain("https://challenges.cloudflare.com");
    expect(header).toContain("frame-src https://challenges.cloudflare.com");
  });
});
