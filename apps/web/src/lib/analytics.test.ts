// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { beforeSend, isPublicPath } from "./analytics";

const ORIGIN = "https://inframole.com";
const view = (url: string, referrer = "") => ({ url, referrer, title: "t", website: "w" });

describe("public pages", () => {
  it("allows the website, docs, legal, agent, demo and self-hosted pages in both languages", () => {
    for (const p of [
      "/",
      "/es",
      "/es/",
      "/docs",
      "/docs/agent/install",
      "/es/docs/reference/api",
      "/legal/privacy",
      "/es/legal/terms",
      "/agent",
      "/es/agent",
      "/demo",
      "/es/demo",
      "/self-hosted",
    ])
      expect(isPublicPath(p), p).toBe(true);
  });

  it("never allows the app, shared maps, accounts or auth pages", () => {
    for (const p of [
      "/w/acme/library",
      "/w/acme/resources/cm123",
      "/share/dmp_shr_abc",
      "/account",
      "/onboarding",
      "/invite/dmp_inv_x",
      "/sign-in",
      "/reset-password",
      "/digest/unsubscribe",
      "/api/analytics",
      "/docsx",
      "/demox",
      "/es/w/acme",
    ])
      expect(isPublicPath(p), p).toBe(false);
  });
});

describe("before-send filter", () => {
  it("keeps a public page view, without query or fragment", () => {
    expect(beforeSend("event", view(`${ORIGIN}/docs/quickstart?token=x#y`), ORIGIN)).toMatchObject({
      url: `${ORIGIN}/docs/quickstart`,
      referrer: "",
      title: "t",
    });
  });

  it("drops private pages and anything but events", () => {
    expect(beforeSend("event", view(`${ORIGIN}/w/acme/map`), ORIGIN)).toBe(false);
    expect(beforeSend("event", view(`${ORIGIN}/share/dmp_shr_abc`), ORIGIN)).toBe(false);
    expect(beforeSend("identify", view(`${ORIGIN}/docs`), ORIGIN)).toBe(false);
    expect(beforeSend("event", view("https://evil.example/docs"), ORIGIN)).toBe(false);
    expect(beforeSend("event", { referrer: "" }, ORIGIN)).toBe(false);
  });

  it("never leaks a private page through the referrer", () => {
    // Moving from the app to the docs: the tracker sends the app path as referrer.
    expect(
      beforeSend("event", view(`${ORIGIN}/docs`, "/w/acme/resources/cm1"), ORIGIN),
    ).toMatchObject({
      referrer: "",
    });
    expect(beforeSend("event", view(`${ORIGIN}/docs`, "/demo"), ORIGIN)).toMatchObject({
      referrer: "/demo",
    });
    expect(
      beforeSend("event", view(`${ORIGIN}/`, "https://news.ycombinator.com/item?id=1#c"), ORIGIN),
    ).toMatchObject({ referrer: "https://news.ycombinator.com/item" });
  });
});
