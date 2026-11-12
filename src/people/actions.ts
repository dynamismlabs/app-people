import { commonActions, registerViewActions } from './actions/common.js';
import { identityActions } from './actions/identity.js';
import { organizeActions } from './actions/organize.js';
import { peopleActions } from './actions/people.js';
import { relationshipActions } from './actions/relationship.js';
import type { ActionDefinition } from './actions/shared.js';

/**
 * People: relationships, conversations and follow-ups. Importing this module
 * defines the actions only. It opens no database and performs no I/O, so the
 * kit's build can generate the contract from it.
 *
 * In Ri this also listed People's record types (person, company, opportunity)
 * with their read actions and view paths, for Ri's record links. MCP has no
 * such registry, so they are gone (docs/parity.md).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const actions: ActionDefinition<any, any>[] = [...commonActions, ...peopleActions, ...relationshipActions, ...organizeActions, ...identityActions];
registerViewActions(actions);

export const definition = { packageId: 'people', actions };
