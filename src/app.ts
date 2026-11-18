import type { Application } from "@app-builder/core";
import { appConfig } from "../app.config";
import { PEOPLE_MIGRATIONS } from "./people/domain/migrations";
import { HUB_TOOLS } from "./people/runtime";
import { peopleJobs, peopleKitActions, peopleRecords, peopleSources, peopleViews } from "./people/kit";
import { exportPeople } from "./people/export";
import { peoplePrompts } from "./people/prompts";

/**
 * People on App Builder. The actions, views, job and sources come from
 * src/people (People's own code from Ri, plus kit.ts, which adapts it).
 */
export const application: Application = {
  config: appConfig,
  actions: peopleKitActions,
  views: peopleViews,
  // People's three skills from Ri, offered as MCP prompts (src/people/prompts.ts).
  prompts: peoplePrompts,
  sources: peopleSources,
  records: peopleRecords,
  jobs: peopleJobs,
  connectors: {
    purpose: "to keep track of the people you write to and meet, from your mail and calendar",
    capabilities: ["mail.read", "calendar.read"],
    // Gmail's history and Calendar's sync tokens keep updates small, and Ri's
    // own services do follow-up tasks and the optional AI. People calls these by name.
    tools: Object.values(HUB_TOOLS).filter((name) => !["gmail__search_messages", "gmail__get_message"].includes(name)),
  },
  migrations: PEOPLE_MIGRATIONS,
  exportData: exportPeople,
};
