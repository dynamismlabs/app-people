import { describe, it, expect } from 'vitest';
import { actionContract } from '@app-builder/core';
import { application } from '../src/app.js';
import { definition } from '../src/people/actions.js';

describe('contract', () => {
  it('turns every People action into an App Builder action, and every example still parses', () => {
    const kit = new Map(application.actions.map((action) => [action.name, action]));
    for (const action of definition.actions) {
      expect(kit.has(action.name), action.name).toBe(true);
      for (const example of action.examples) {
        expect(() => action.input.parse(example.input), `${action.name} input`).not.toThrow();
        expect(() => action.output.parse(example.output), `${action.name} output`).not.toThrow();
      }
    }
    expect(application.actions.length).toBeLessThanOrEqual(100);
  });

  it('names every action the People spec lists, plus the common actions', () => {
    const names = new Set(definition.actions.map((action) => action.name));
    const required = [
      'list_people', 'get_person', 'search_people', 'save_person', 'list_organizations', 'get_organization', 'save_organization', 'save_affiliation', 'list_interactions', 'link_interaction', 'preview_company_attribution', 'apply_company_attribution',
      'save_note', 'list_commitments', 'review_commitment', 'review_fact', 'get_briefing', 'request_briefing', 'get_relationship_context',
      'list_views', 'save_view', 'list_lists', 'save_list', 'update_list_members', 'bulk_update_records',
      'list_pipelines', 'save_pipeline', 'save_pipeline_stages', 'list_opportunities', 'get_opportunity', 'save_opportunity', 'move_opportunity',
      'resolve_identity', 'merge_people', 'merge_organizations', 'undo_merge',
      'open_view', 'describe_view_context', 'list_sources', 'run_background_step', 'sync_step', 'enrich_step', 'preview_import', 'apply_import', 'create_follow_up',
      'continue_import',
    ];
    for (const name of required) expect(names.has(name), name).toBe(true);
    // Ri's per-chat scopes are the kit's consent screen now.
    for (const name of ['create_scope', 'list_scopes', 'revoke_scope']) expect(names.has(name), name).toBe(false);
  });

  it('makes source management, merges, navigation and pipeline structure view-only, and the steps job-only', () => {
    const viewOnly = ['list_sources', 'configure_source', 'pause_source', 'delete_source_data', 'set_extraction', 'continue_import', 'preview_import', 'apply_import', 'export_records',
      'save_navigation', 'save_pipeline', 'save_pipeline_stages', 'merge_people', 'merge_organizations', 'undo_merge', 'resolve_identity', 'apply_company_attribution', 'delete_record', 'save_exclusion',
      'list_exclusions', 'save_collection', 'preview_company_attribution', 'open_view', 'get_record_title'];
    const kit = new Map(application.actions.map((action) => [action.name, action]));
    for (const name of viewOnly) {
      // In Ri these were the owner's view only. Now the view can call them in a host, and the host keeps them from the model.
      expect(kit.get(name)!.audience, name).toEqual(['user', 'agent']);
      expect(kit.get(name)!.visibility, name).toEqual(['app']);
    }
    for (const action of application.actions) if (!viewOnly.includes(action.name)) expect(action.visibility, action.name).toBeUndefined();
    for (const name of ['run_background_step', 'sync_step', 'enrich_step', 'update_people']) expect(kit.get(name)!.audience, name).toEqual([]);
    for (const action of definition.actions) {
      if (action.effect === 'read') expect(action.retry, action.name).toBe('read_safe');
      expect(action.examples.length, action.name).toBeGreaterThan(0);
    }
  });

  it('offers assistants exactly the agent actions, the show_* views, open_people and the @ menu search, each with an output schema', () => {
    const contract = actionContract({ ...application, viewHTML: '<!doctype html>' });
    const tools = contract.mcp.tools as { name: string; title?: string; outputSchema?: unknown }[];
    const names = tools.map((tool) => tool.name).sort();
    const expected = [
      ...application.actions.filter((action) => action.audience.includes('agent')).map((action) => action.name),
      ...(application.views ?? []).map((view) => view.name), 'open_people', 'search_mentions',
      // Settings inside the view: the core's own view-only tools.
      'read_settings', 'change_settings',
    ].sort();
    expect(names).toEqual(expected);
    const viewOnly = tools.filter((tool) => (tool as { _meta?: { ui?: { visibility?: string[] } } })._meta?.ui?.visibility?.join() === 'app').map((tool) => tool.name).sort();
    expect(viewOnly).toContain('delete_record');
    expect(viewOnly).toContain('search_mentions');
    expect(viewOnly).toEqual(expect.arrayContaining(['read_settings', 'change_settings']));
    expect(viewOnly).not.toContain('search_people');
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeTruthy();
      expect(tool.name, tool.name).not.toMatch(/__|\.\.|\._|_\./);
      expect((tool.title ?? '').length, tool.name).toBeLessThanOrEqual(60);
    }
    expect(contract.jobs).toEqual([{ name: 'update_people', title: 'Update from your accounts', schedule: 'every 5 minutes', action: 'update_people' }]);
    expect(contract.connectors?.capabilities).toEqual(['mail.read', 'calendar.read']);
  });

  it('every read is synchronous, so each runs as one transaction of the core\'s (src/people/kit.ts)', () => {
    const reads = definition.actions.filter((action) => action.effect === 'read');
    expect(reads.length).toBeGreaterThan(20);
    expect(reads.filter((action) => action.handler.constructor.name === 'AsyncFunction').map((action) => action.name)).toEqual([]);
  });

  it('no tool takes an input named account, which Ri reserves and refuses a server for', () => {
    const contract = actionContract({ ...application, viewHTML: '<!doctype html>' });
    const tools = contract.mcp.tools as { name: string; inputSchema?: { properties?: Record<string, unknown>; anyOf?: { properties?: Record<string, unknown> }[] } }[];
    const declaring = tools.filter((tool) => [tool.inputSchema, ...(tool.inputSchema?.anyOf ?? [])].some((schema) => schema?.properties && 'account' in schema.properties)).map((tool) => tool.name);
    expect(declaring).toEqual([]);
  });

  it('copy avoids long dashes and semicolons in user-visible descriptions', () => {
    for (const item of [...definition.actions, ...application.actions, { name: 'instructions', description: application.config.instructions ?? '' }]) {
      expect(item.description, item.name).not.toMatch(/[–—]/);
      expect(item.description, item.name).not.toMatch(/;/);
    }
  });
});
