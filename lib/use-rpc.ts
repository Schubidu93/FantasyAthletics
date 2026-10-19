"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createClient } from "./supabase/client";

/** Ruft eine Datenbankfunktion auf, zeigt Fehler an und lädt die Seite danach neu. */
export function useRpc() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) {
      setError(error.message);
      return undefined;
    }
    startTransition(() => router.refresh());
    return data as T;
  }

  return { call, pending: pending || busy, error, setError };
}
