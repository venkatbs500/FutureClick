import { describe, expect, it } from "vitest";
import { assessControlPrivacy, authorizeFixtureLocation } from "@futureclick/browser-adapter";
import { isLocationAuthorized } from "../src/content/capture.js";

describe("Extension Capture Policy & Privacy (DOM-Independent)", () => {
  describe("Location Authorization", () => {
    it("Probe 1: Approves exact fixture host, port, protocol, and path", () => {
      const mockLocation = {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      } as Location;

      expect(isLocationAuthorized(mockLocation)).toBe(true);
    });

    it("Probe 2: Rejects unauthorized port (e.g. 3000)", () => {
      const mockLocation = {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "3000",
        pathname: "/fc005/repository-visibility.html",
      } as Location;

      expect(isLocationAuthorized(mockLocation)).toBe(false);
    });

    it("Probe 3: Rejects unauthorized hostname (e.g. localhost)", () => {
      const mockLocation = {
        protocol: "http:",
        hostname: "localhost",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      } as Location;

      expect(isLocationAuthorized(mockLocation)).toBe(false);
    });

    it("Probe 4: Rejects unauthorized route (e.g. root path)", () => {
      const mockLocation = {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/",
      } as Location;

      expect(isLocationAuthorized(mockLocation)).toBe(false);
    });

    it("Probe 5: Rejects HTTPS protocol for local test harness", () => {
      const mockLocation = {
        protocol: "https:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      } as Location;

      expect(isLocationAuthorized(mockLocation)).toBe(false);
    });

    it("Probe 6: URL query string and fragment are completely excluded from authorized result", () => {
      const auth = authorizeFixtureLocation({
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      });

      expect(auth.authorized).toBe(true);
      expect(auth.origin).toBe("http://127.0.0.1:4173");
      expect(auth.routeId).toBe("synthetic.repository-visibility");

      // Verify no query string or fragment can exist on auth result
      expect("search" in auth).toBe(false);
      expect("query" in auth).toBe(false);
      expect("hash" in auth).toBe(false);
      expect("fragment" in auth).toBe(false);
    });
  });

  describe("Control Privacy & Sensitive Exclusions", () => {
    it("Probe 7: Native button with type='button' is permitted", () => {
      const res = assessControlPrivacy({
        tagName: "button",
        inputType: "button",
      });
      expect(res.permitted).toBe(true);
    });

    it("Probe 8: Excludes input element without reading value", () => {
      const res = assessControlPrivacy({
        tagName: "input",
        inputType: "text",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("EXCLUDED_FORM_TAG");
    });

    it("Probe 9: Excludes textarea element", () => {
      const res = assessControlPrivacy({
        tagName: "textarea",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("EXCLUDED_FORM_TAG");
    });

    it("Probe 10: Excludes select element", () => {
      const res = assessControlPrivacy({
        tagName: "select",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("EXCLUDED_FORM_TAG");
    });

    it("Probe 11: Excludes contenteditable elements", () => {
      const res = assessControlPrivacy({
        tagName: "button",
        isContentEditable: true,
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("CONTENTEDITABLE_EXCLUDED");
    });

    it("Probe 12: Excludes buttons with sensitive identifiers (password, secret, token)", () => {
      const res = assessControlPrivacy({
        tagName: "button",
        id: "github-access-token-button",
      });
      expect(res.permitted).toBe(false);
      expect(res.reasonCode).toBe("SENSITIVE_IDENTIFIER_EXCLUDED");
    });
  });
});
