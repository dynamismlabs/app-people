import type { AppConfig } from "@app-builder/core";
export const appConfig: AppConfig = {
  id: "people",
  name: "People",
  description: "Your relationships, conversations and follow-ups in one place.",
  port: 4364,
  // People's records are synchronous SQL transactions that read their own writes (the core's
  // transaction()), which Cloudflare's D1 can't run yet. It runs as a Mac or Linux service.
  platforms: ["node"],
};
