import type { Method, Params } from "../shared/protocol";
export function rpc<T = unknown, M extends Method = Method>(
  method: M,
  params: Params<M>,
): Promise<T> {
  if (!window.studio)
    return Promise.reject(
      new Error(
        "Launch the Electron application to connect to the native engine.",
      ),
    );
  return window.studio.request(method, params) as Promise<T>;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
