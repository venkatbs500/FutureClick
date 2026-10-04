/**
 * FC-007 location authorization tests.
 */

import { describe, expect, it } from "vitest";
import {
  authorizeFc007SettingsLocation,
  isSupportedEnglishLocale,
  isSupportedOwnerSegment,
  isSupportedRepoSegment,
} from "../src/fc007/location.js";

describe("FC-007 location", () => {
  it("authorizes exact settings path and trailing slash", () => {
    const a = authorizeFc007SettingsLocation(
      {
        protocol: "https:",
        hostname: "github.com",
        port: "",
        pathname: "/fixture-owner/fixture-repo/settings",
      },
      { requireTopFrame: false },
    );
    expect(a.status).toBe("authorized");
    if (a.status !== "authorized") return;
    expect(a.route.ownerNormalized).toBe("fixture-owner");
    expect(a.route.pathnameCanonical).toBe("/fixture-owner/fixture-repo/settings");

    const b = authorizeFc007SettingsLocation(
      {
        protocol: "https:",
        hostname: "github.com",
        port: "443",
        pathname: "/fixture-owner/fixture-repo/settings/",
      },
      { requireTopFrame: false },
    );
    expect(b.status).toBe("authorized");
  });

  it("rejects wrong host, http, port, subroutes, encoding, unicode, grammar", () => {
    expect(
      authorizeFc007SettingsLocation(
        {
          protocol: "https:",
          hostname: "gist.github.com",
          port: "",
          pathname: "/a/b/settings",
        },
        { requireTopFrame: false },
      ).status,
    ).toBe("abstain");

    expect(
      authorizeFc007SettingsLocation(
        {
          protocol: "http:",
          hostname: "github.com",
          port: "",
          pathname: "/a/b/settings",
        },
        { requireTopFrame: false },
      ).status,
    ).toBe("abstain");

    expect(
      authorizeFc007SettingsLocation(
        {
          protocol: "https:",
          hostname: "github.com",
          port: "8443",
          pathname: "/a/b/settings",
        },
        { requireTopFrame: false },
      ).status,
    ).toBe("abstain");

    expect(
      authorizeFc007SettingsLocation(
        {
          protocol: "https:",
          hostname: "github.com",
          port: "",
          pathname: "/a/b/settings/actions",
        },
        { requireTopFrame: false },
      ).status,
    ).toBe("abstain");

    expect(
      authorizeFc007SettingsLocation(
        {
          protocol: "https:",
          hostname: "github.com",
          port: "",
          pathname: "/a%2Fb/c/settings",
        },
        { requireTopFrame: false },
      ).status,
    ).toBe("abstain");

    expect(isSupportedOwnerSegment("owner_name")).toBe(false);
    expect(isSupportedRepoSegment(".")).toBe(false);
    expect(isSupportedRepoSegment("..")).toBe(false);
    expect(isSupportedOwnerSegment("-bad")).toBe(false);
    expect(isSupportedRepoSegment("ok-repo")).toBe(true);
  });

  it("ignores query/fragment for identity (not retained)", () => {
    // Location type only receives pathname — query never enters authorization input.
    const r = authorizeFc007SettingsLocation(
      {
        protocol: "https:",
        hostname: "github.com",
        port: "",
        pathname: "/Owner/Repo/settings",
      },
      { requireTopFrame: false },
    );
    expect(r.status).toBe("authorized");
    if (r.status !== "authorized") return;
    expect(JSON.stringify(r.route)).not.toContain("?");
    expect(JSON.stringify(r.route)).not.toContain("#");
    expect(r.route.ownerNormalized).toBe("owner");
  });

  it("supports en and en-US locale only", () => {
    expect(isSupportedEnglishLocale("en")).toBe(true);
    expect(isSupportedEnglishLocale("en-US")).toBe(true);
    expect(isSupportedEnglishLocale("en-us")).toBe(true);
    expect(isSupportedEnglishLocale("fr")).toBe(false);
    expect(isSupportedEnglishLocale("")).toBe(false);
  });
});
