import { z } from 'zod/v3';
import type { AppInvocation } from '../../lib/contract.js';

/**
 * People's action definitions, in the shape they had in Ri. src/people/kit.ts
 * turns each into an App Builder action (an MCP tool and a web action).
 * `audience` user means the person's own browser only; agent means assistant
 * connections (and the view inside an assistant); schedule means the job.
 */
export interface ActionDefinition<I = unknown, O = unknown> {
  name: string;
  /** A short title for MCP clients (60 characters at most). */
  title?: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  audience: ('user' | 'agent' | 'schedule')[];
  effect: 'read' | 'app_write';
  retry: 'read_safe' | 'idempotent';
  timeoutMs?: number;
  errors?: string[];
  visibility?: 'app' | 'model';
  examples: { input: I; output: O }[];
  handler(input: I, invocation: AppInvocation): O | Promise<O>;
}
import { coverageSchema } from '../schemas.js';

type Descriptor = Pick<ActionDefinition, 'name' | 'description' | 'audience' | 'effect' | 'retry' | 'timeoutMs' | 'errors' | 'visibility'>;
/**
 * A typed action: input and output types come only from the schemas, so
 * examples are checked against them instead of widening them.
 */
export function action<S extends z.ZodType, R extends z.ZodType>(definition: Descriptor & {
  input: S;
  output: R;
  examples: { input: z.input<S>; output: z.output<R> }[];
  handler(input: z.output<S>, invocation: AppInvocation): z.output<R> | Promise<z.output<R>>;
}): ActionDefinition<z.output<S>, z.output<R>> {
  return definition as unknown as ActionDefinition<z.output<S>, z.output<R>>;
}

export const listInput = {
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
};
export const listOutput = <T extends z.ZodType, E extends z.ZodRawShape = {}>(item: T, extra?: E) =>
  z.object({ items: z.array(item).max(100), nextCursor: z.string().max(2048).nullable(), coverage: coverageSchema, revision: z.string().max(80), ...(extra ?? {}) as E }).strict();

export const READ_ERRORS = ['invalid_input', 'not_found', 'forbidden', 'revoked'] as ('invalid_input' | 'not_found' | 'forbidden' | 'revoked' | 'conflict' | 'unsupported' | 'busy' | 'timeout')[];
export const WRITE_ERRORS = ['invalid_input', 'not_found', 'forbidden', 'revoked', 'conflict'] as typeof READ_ERRORS;
export const SYNC_ERRORS = ['invalid_input', 'forbidden', 'revoked', 'busy', 'timeout', 'unsupported'] as typeof READ_ERRORS;
export const RESOURCE = 'ui://people/main' as const;

/**
 * Tools name an account `sourceAccount`, never `account`: Ri reserves `account`
 * on every tool it connects (it fills it in to choose one of the person's
 * accounts) and refuses a server whose tool declares it. The domain keeps `account`.
 */
export function withAccount<T extends { sourceAccount: string }>(input: T): Omit<T, 'sourceAccount'> & { account: string } {
  const { sourceAccount, ...rest } = input;
  return { ...rest, account: sourceAccount };
}
