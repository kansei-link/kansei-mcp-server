// Minimal local typings for `psl` — the package ships types but its
// package.json "exports" doesn't expose them to moduleResolution=node16.
declare module "psl" {
  export function get(domain: string): string | null;
  export function parse(domain: string): unknown;
  export function isValid(domain: string): boolean;
  const _default: { get: typeof get; parse: typeof parse; isValid: typeof isValid };
  export default _default;
}
