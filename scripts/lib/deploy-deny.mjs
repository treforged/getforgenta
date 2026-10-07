/**
 * Which edge functions must never be deployed, and why. Pure, so the rule is tested without a deploy.
 * A function is refused when it is named in supabase/functions/DEPLOY-DENY.json OR its folder holds a
 * PRODUCTION-IS-TOMBSTONED.md - the second catches a tombstone somebody forgot to list.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Returns null when `name` may be deployed, else the reason it may not. */
export function deployRefusal(name, functionsDir = 'supabase/functions') {
  if (typeof name !== 'string' || !NAME.test(name)) return `"${name}" is not a function name`;
  const deny = JSON.parse(readFileSync(join(functionsDir, 'DEPLOY-DENY.json'), 'utf8'));
  if (Object.prototype.hasOwnProperty.call(deny, name)) return `${name} is on DEPLOY-DENY.json: ${deny[name]}`;
  if (existsSync(join(functionsDir, name, 'PRODUCTION-IS-TOMBSTONED.md'))) return `${name}/PRODUCTION-IS-TOMBSTONED.md says production must not run this body`;
  if (!existsSync(join(functionsDir, name, 'index.ts'))) return `${name} has no index.ts`;
  return null;
}
