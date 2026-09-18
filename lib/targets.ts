"use client";

import { useCallback, useEffect, useState } from "react";
import type { Business, Target, TargetStatus } from "./types";

const STORAGE_KEY = "finder.targets.v1";

export const STATUSES: { id: TargetStatus; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "replied", label: "Replied" },
  { id: "quoted", label: "Quoted" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

function read(): Target[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Target =>
        Boolean(entry?.business?.id) && typeof entry.business.name === "string",
    );
  } catch {
    // A corrupt or unavailable store must never take the app down with it.
    return [];
  }
}

function write(targets: Target[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
  } catch {
    // Private mode / quota. The in-memory list still works for this session.
  }
}

/**
 * The freelancer's shortlist. It lives in localStorage rather than on a server
 * because it is personal working state — no account, no sync, nothing to leak.
 */
export function useTargets() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Read after mount so the server and client render the same first paint.
  useEffect(() => {
    setTargets(read());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) write(targets);
  }, [targets, loaded]);

  // Keep multiple tabs in step.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setTargets(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const add = useCallback((business: Business) => {
    setTargets((current) =>
      current.some((t) => t.business.id === business.id)
        ? current
        : [...current, { business, status: "new", notes: "", addedAt: Date.now() }],
    );
  }, []);

  const remove = useCallback((id: string) => {
    setTargets((current) => current.filter((t) => t.business.id !== id));
  }, []);

  const toggle = useCallback((business: Business) => {
    setTargets((current) =>
      current.some((t) => t.business.id === business.id)
        ? current.filter((t) => t.business.id !== business.id)
        : [...current, { business, status: "new", notes: "", addedAt: Date.now() }],
    );
  }, []);

  const addMany = useCallback((businesses: Business[]) => {
    setTargets((current) => {
      const known = new Set(current.map((t) => t.business.id));
      const additions = businesses
        .filter((business) => !known.has(business.id))
        .map((business) => ({
          business,
          status: "new" as TargetStatus,
          notes: "",
          addedAt: Date.now(),
        }));
      return additions.length ? [...current, ...additions] : current;
    });
  }, []);

  const update = useCallback((id: string, patch: Partial<Omit<Target, "business">>) => {
    setTargets((current) =>
      current.map((t) => (t.business.id === id ? { ...t, ...patch } : t)),
    );
  }, []);

  const clear = useCallback(() => setTargets([]), []);

  return { targets, loaded, add, addMany, remove, toggle, update, clear };
}
