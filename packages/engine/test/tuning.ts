import { DEFAULT_RULES, type RulesConfig } from "@second-half/contracts";

/**
 * Proposed health and strength numbers (see the simulation PR). DEFAULT_RULES is owned by the lead; this is the candidate
 * the balance targets are checked against until the lead adopts or changes it.
 */
export const PROPOSED_RULES: RulesConfig = {
  ...DEFAULT_RULES,
  health: { ...DEFAULT_RULES.health, missCost: 3, doubleMissFactor: 1.5, fullRestore: 5, minimumRestore: 3, setbackDamage: 7 },
  strength: { ...DEFAULT_RULES.strength, fullGain: 0.4, minimumGain: 0.3, missCost: 0, dailyDecay: 0.018 },
};
