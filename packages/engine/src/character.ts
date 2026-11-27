import type { CharacterState } from "@second-half/contracts";

/** The character with `knockedDown` set, or the field removed when standing. */
export function withKnockedDown(c: CharacterState, knockedDown: CharacterState["knockedDown"]): CharacterState {
  const { knockedDown: _drop, ...rest } = c;
  return knockedDown ? { ...rest, knockedDown } : rest;
}
