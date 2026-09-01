import * as path from 'path';
import { assertSafeRefId } from './ref-id-safety';

export const BUILD_ROOT = '/tmp/launchly-builds';

/** Single source of truth for the source directory shared by clone/template and BuildKit stages. */
export function buildContextDir(refId: string): string {
  assertSafeRefId(refId, 'refId');
  return path.join(BUILD_ROOT, refId);
}
