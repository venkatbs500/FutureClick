import { describe, expect, it } from "vitest";
import {
  AUTHORIZED_FIXTURE_ORIGIN,
  AUTHORIZED_FIXTURE_PATHNAME,
  AUTHORIZED_FIXTURE_ROUTE_ID,
  assessControlPrivacy,
  authorizeFixtureLocation,
} from "../src/index.js";

describe("Privacy Boundaries & Control Exclusions", () => {
  describe("Location Authorization", () => {
    it("Probe 1: Exact local fixture URL is authorized", () => {
      const res = authorizeFixtureLocation({
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      });

      expect(res.authorized).toBe(true);
      expect(res.origin).toBe(AUTHORIZED_FIXTURE_ORIGIN);
      expect(res.routeId).toBe(AUTHORIZED_FIXTURE_ROUTE_ID);
    });

    it("Probe 2: Rejects wrong port (e.g. 8080 or 3000)", () => {
      const res = authorizeFixtureLocation({
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "8080",
        pathname: "/fc005/repository-visibility.html",
      });
      expect(res.authorized).toBe(false);
      expect(res.rejectionReason).toBe("UNAUTHORIZED_PORT");
    });

    it("Probe 3: Rejects wrong hostname (e.g. localhost or 127.0.0.2)", () => {
      const res = authorizeFixtureLocation({
        protocol: "http:",
        hostname: "localhost",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      });
      expect(res.authorized).toBe(false);
      expect(res.rejectionReason).toBe("UNAUTHORIZED_HOSTNAME");
    });

    it("Probe 4: Rejects wrong protocol (e.g. https:)", () => {
      const res = authorizeFixtureLocation({
        protocol: "https:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      });
      expect(res.authorized).toBe(false);
      expect(res.rejectionReason).toBe("UNAUTHORIZED_PROTOCOL");
    });

    it("Probe 5: Rejects wrong pathname (e.g. root or other page)", () => {
      const res = authorizeFixtureLocation({
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/other.html",
      });
      expect(res.authorized).toBe(false);
      expect(res.rejectionReason).toBe("UNAUTHORIZED_PATHNAME");
    });
  });

  describe("Control Privacy Assessment", () => {
    it("Probe 6: Native <button type='button'> is permitted", () => {
      const res = assessControlPrivacy({
        tagName: "button",
        inputType: "button",
        id: "btn-valid-visibility",
      });
      expect(res.permitted).toBe(true);
    });

    it("Probe 7: Rejects <input> element", () => {
      const res = assessControlPrivacy({
        tagName: "input",
        inputType: "text",
        id: "username",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("EXCLUDED_FORM_TAG");
    });

    it("Probe 8: Rejects <textarea> element", () => {
      const res = assessControlPrivacy({
        tagName: "textarea",
        id: "comment",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("EXCLUDED_FORM_TAG");
    });

    it("Probe 9: Rejects <select> element", () => {
      const res = assessControlPrivacy({
        tagName: "select",
        id: "dropdown",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("EXCLUDED_FORM_TAG");
    });

    it("Probe 10: Rejects contenteditable elements", () => {
      const res = assessControlPrivacy({
        tagName: "button",
        isContentEditable: true,
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("CONTENTEDITABLE_EXCLUDED");
    });

    it("Probe 11: Rejects submit and reset button types", () => {
      const submitRes = assessControlPrivacy({
        tagName: "button",
        inputType: "submit",
      });
      expect(submitRes.permitted).toBe(false);
      expect(submitRes.reasonCode).toBe("UNSUPPORTED_BUTTON_TYPE");

      const resetRes = assessControlPrivacy({
        tagName: "button",
        inputType: "reset",
      });
      expect(resetRes.permitted).toBe(false);
      expect(resetRes.reasonCode).toBe("UNSUPPORTED_BUTTON_TYPE");
    });

    it("Probe 12: Excludes controls with sensitive / password identifiers", () => {
      const res = assessControlPrivacy({
        tagName: "button",
        id: "user-password-confirm",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("SENSITIVE_IDENTIFIER_EXCLUDED");
    });

    it("Probe 13: Excludes controls with api-key or token identifiers", () => {
      const res = assessControlPrivacy({
        tagName: "button",
        name: "btn_api_key_revoke",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("SENSITIVE_IDENTIFIER_EXCLUDED");
    });
  });
});
