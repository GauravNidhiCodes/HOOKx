/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";
import type { HookxApi } from "./client";

const ApiContext = createContext<HookxApi | null>(null);

export function ApiProvider({
  client,
  children,
}: {
  readonly client: HookxApi;
  readonly children: ReactNode;
}) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): HookxApi {
  const api = useContext(ApiContext);
  if (api === null) {
    throw new Error("HOOKX operator console: API client is not provided");
  }
  return api;
}
