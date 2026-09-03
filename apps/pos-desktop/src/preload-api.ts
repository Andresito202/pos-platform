export const RENDERER_API_KEY = "posService" as const;

export const RENDERER_API_METHODS = [
  "runtime.status.get",
  "operation.result.get",
  "operation.confirm",
] as const;

export type RendererApiMethod = (typeof RENDERER_API_METHODS)[number];

export function isValidMethod(method: string): method is RendererApiMethod {
  return (RENDERER_API_METHODS as readonly string[]).includes(method);
}
