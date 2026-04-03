"use client";

import { useEffect, useState } from "react";

import type { SettingsPayload, SettingsResponse } from "@/lib/settings/types";

type SettingsState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  saved: boolean;
  data: SettingsResponse | null;
};

const initialState: SettingsState = {
  loading: true,
  saving: false,
  error: null,
  saved: false,
  data: null,
};

export function useSettings() {
  const [state, setState] = useState<SettingsState>(initialState);

  // Load settings once on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const res = await fetch("/api/settings");
        if (!res.ok) {
          throw new Error(`Failed to load settings: ${res.status}`);
        }

        const data = (await res.json()) as SettingsResponse;
        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          loading: false,
          error: null,
          data,
        }));
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "Failed to load settings",
        }));
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const update = (updater: (current: SettingsResponse | null) => SettingsResponse) => {
    setState((prev) => ({
      ...prev,
      data: updater(prev.data),
      saved: false,
      error: null,
    }));
  };

  const save = async (partial?: SettingsPayload) => {
    setState((prev) => ({ ...prev, saving: true, error: null, saved: false }));

    try {
      // When no explicit partial payload is provided, derive it from the
      // Databricks configuration lives in env / server-side config and is not
      // persisted per user.
      const payload: SettingsPayload =
        partial ?? {
          additionalInstructions: state.data?.additionalInstructions ?? null,
        };

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to save settings: ${res.status}`);
      }

      const data = (await res.json()) as SettingsResponse;

      setState((prev) => ({
        ...prev,
        saving: false,
        saved: true,
        error: null,
        data,
      }));
    } catch (err) {
      console.error(err);
      setState((prev) => ({
        ...prev,
        saving: false,
        saved: false,
        error: err instanceof Error ? err.message : "Failed to save settings",
      }));
    }
  };

  return {
    ...state,
    update,
    save,
  };
}
