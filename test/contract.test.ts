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

  it('keeps source management, merges, navigation and pipeline structure in the browser only, and the steps for the job only', () => {
    const userOnly = ['list_sources', 'configure_source', 'pause_source', 'delete_source_data', 'set_extraction', 'continue_import', 'preview_import', 'apply_import', 'export_records',
      'save_navigation', 'save_pipeline', 'save_pipeline_stages', 'merge_people', 'merge_organizations', 'undo_merge', 'resolve_identity', 'apply_company_attribution', 'delete_record', 'save_exclusion'];
    const kit = new Map(application.actions.map((action) => [action.name, action]));
    for (const name of userOnly) {
      expect(definition.actions.find((action) => action.name === name)!.audience, name).toEqual(['user']);
      expect(kit.get(name)!.audience, name).toEqual(['user']);
    }
    for (const name of ['run_background_step', 'sync_step', 'enrich_step', 'update_people']) expect(kit.get(name)!.audience, name).toEqual([]);
    for (const action of definition.actions) {
      if (action.effect === 'read') expect(action.retry, action.name).toBe('read_safe');
      expect(action.examples.length, action.name).toBeGreaterThan(0);
    }
  });

  it('offers assistants exactly the agent actions, the show_* views and open_people, each with an output schema', () => {
    const contract = actionContract({ ...application, viewHTML: '<!doctype html>' });
    const tools = contract.mcp.tools as { name: string; title?: string; outputSchema?: unknown }[];
    const names = tools.map((tool) => tool.name).sort();
    const expected = [
      ...application.actions.filter((action) => action.audience.includes('agent')).map((action) => action.name),
      ...(application.views ?? []).map((view) => view.name), 'open_people',
    ].sort();
    expect(names).toEqual(expected);
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeTruthy();
      expect(tool.name, tool.name).not.toMatch(/__|\.\.|\._|_\./);
      expect((tool.title ?? '').length, tool.name).toBeLessThanOrEqual(60);
    }
    expect(contract.jobs).toEqual([{ name: 'update_people', title: 'Update from your accounts', schedule: 'every 5 minutes', action: 'update_people' }]);
    expect(contract.connectors?.capabilities).toEqual(['mail.read', 'calendar.read']);
  });

  it('copy avoids long dashes and semicolons in user-visible descriptions', () => {
    for (const action of [...definition.actions, ...application.actions]) {
      expect(action.description, action.name).not.toMatch(/[–—]/);
      expect(action.description, action.name).not.toMatch(/;/);
    }
  });
});
