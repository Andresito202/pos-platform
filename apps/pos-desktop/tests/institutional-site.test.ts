import { describe, it, expect } from "vitest";
import {
  ALLOWED_EXTERNAL_HTTPS_URLS,
  INSTITUTIONAL_WEBSITE_URL,
  resolveAllowedExternalHttpsUrl,
} from "../src/institutional-site.js";

describe("institutional site allowlist", () => {
  it("pins the official HTTPS origin", () => {
    expect(INSTITUTIONAL_WEBSITE_URL).toBe("https://camachoposcolombia.com");
    expect(ALLOWED_EXTERNAL_HTTPS_URLS).toEqual([INSTITUTIONAL_WEBSITE_URL]);
  });

  it("accepts only the exact institutional URL", () => {
    expect(resolveAllowedExternalHttpsUrl("https://camachoposcolombia.com")).toBe(
      INSTITUTIONAL_WEBSITE_URL,
    );
    expect(resolveAllowedExternalHttpsUrl("https://camachoposcolombia.com/")).toBe(
      INSTITUTIONAL_WEBSITE_URL,
    );
  });

  it("denies alternate hosts, schemes, paths, queries and credentials", () => {
    expect(resolveAllowedExternalHttpsUrl("http://camachoposcolombia.com")).toBeNull();
    expect(resolveAllowedExternalHttpsUrl("https://www.camachoposcolombia.com")).toBeNull();
    expect(resolveAllowedExternalHttpsUrl("https://camachoposcolombia.com/login")).toBeNull();
    expect(resolveAllowedExternalHttpsUrl("https://camachoposcolombia.com/?q=1")).toBeNull();
    expect(resolveAllowedExternalHttpsUrl("https://camachoposcolombia.com/#frag")).toBeNull();
    expect(resolveAllowedExternalHttpsUrl("https://user:pass@camachoposcolombia.com")).toBeNull();
    expect(resolveAllowedExternalHttpsUrl("https://evil.example")).toBeNull();
    expect(resolveAllowedExternalHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(resolveAllowedExternalHttpsUrl(null)).toBeNull();
  });
});
