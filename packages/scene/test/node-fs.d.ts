// The repo has no @types/node. Tests only need this one call to read the model files.
declare module "node:fs" {
  export function readFileSync(path: URL | string): Uint8Array;
}
