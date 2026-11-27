import { DEFAULT_RULES, type RulesConfig } from "@second-half/contracts";

/**
 * The rule set the balance targets are checked against. It is DEFAULT_RULES now that the tuned numbers are
 * applied; to try a change, override fields here and run the balance suite.
 */
export const PROPOSED_RULES: RulesConfig = { ...DEFAULT_RULES };
