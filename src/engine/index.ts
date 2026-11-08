// Public entry point of the rules. Other layers must import from here only.

import { initState, legalMoves, step } from './rules';
import type { EngineApi } from './types';

export { CONFIG } from './config';
export { initState, legalMoves, step };
export type * from './types';

export const ruleEngine: EngineApi = { initState, legalMoves, step };
