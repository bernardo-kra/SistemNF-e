import {
  DIAGNOSTICS_APP_VERSION, MAX_DIAGNOSTIC_EVENTS, diagnosticRoute, diagnosticTimestamp,
  isDiagnosticId, isDiagnosticOperation, operationCatalog, projectDiagnosticEvent,
  type DiagnosticEvent, type DiagnosticRecordInput,
} from "./engine";
export { MAX_DIAGNOSTIC_EVENTS } from "./engine";
export const DIAGNOSTICS_KEY = "sistem:diagnostics:v1";
export interface DiagnosticStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface DiagnosticSnapshot {
  installationId: string;
  events: readonly DiagnosticEvent[];
  persistence: "local" | "memory";
}
export interface DiagnosticRecorder {
  record(input: DiagnosticRecordInput): DiagnosticEvent | null;
  getSnapshot(): DiagnosticSnapshot;
  subscribe(listener: () => void): () => void;
}
export interface DiagnosticRecorderOptions { now?: () => string; id?: () => string }

function randomId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch { /* Opaque local correlation only; no identity or authorization depends on it. */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (part) => {
    const digit = Math.floor(Math.random() * 16);
    return (part === "x" ? digit : (digit & 3) | 8).toString(16);
  });
}

export function createDiagnosticRecorder(storage?: DiagnosticStorage | null, options: DiagnosticRecorderOptions = {}): DiagnosticRecorder {
  const nextId = () => {
    try { const id = options.id?.(); if (isDiagnosticId(id)) return id.toLowerCase(); } catch { /* Fall back to a generated identifier. */ }
    return randomId();
  };
  let installationId = "";
  let events: DiagnosticEvent[] = [];
  let persistence: DiagnosticSnapshot["persistence"] = "memory";
  const listeners = new Set<() => void>();
  const retain = (values: DiagnosticEvent[]) => {
    const ids = new Set<string>();
    return values.filter((event) => {
      if (event.installationId !== installationId || ids.has(event.id)) return false;
      ids.add(event.id); return true;
    }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_DIAGNOSTIC_EVENTS)
      .map((event) => Object.freeze(event));
  };
  const persist = () => {
    persistence = "memory";
    if (!storage) return;
    try {
      storage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ version: 1, installationId, events }));
      persistence = "local";
    } catch { /* No recursion, operational state, or raw storage error in this buffer. */ }
  };
  try {
    const raw = storage?.getItem(DIAGNOSTICS_KEY);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === "object") {
        const saved = value as Record<string, unknown>;
        if (saved.version === 1 && isDiagnosticId(saved.installationId) && Array.isArray(saved.events)) {
          installationId = saved.installationId.toLowerCase();
          events = saved.events.flatMap((event) => { const projected = projectDiagnosticEvent(event); return projected ? [projected] : []; });
        }
      }
    }
  } catch { /* Diagnostics recovery must never block the application. */ }
  if (!installationId) installationId = nextId();
  events = retain(events);
  persist(); // Rewrites only the diagnostic key with the allowed projection.
  const snapshotOf = (): DiagnosticSnapshot => Object.freeze({ installationId, events: Object.freeze([...events]), persistence });
  let snapshot = snapshotOf();
  const publish = () => {
    snapshot = snapshotOf();
    for (const listener of listeners) { try { listener(); } catch { /* Subscriber failures are isolated. */ } }
  };
  return {
    record(input) {
      try {
        if (!input || !isDiagnosticOperation(input.operation)) return null;
        let id = nextId();
        if (id === installationId || events.some((event) => event.id === id)) id = randomId();
        const metadata = operationCatalog[input.operation];
        const event: DiagnosticEvent = Object.freeze({
          id, at: diagnosticTimestamp(options.now ? options.now() : new Date().toISOString()),
          level: metadata.level, code: metadata.code, module: metadata.module, operation: input.operation,
          route: diagnosticRoute(input.route), installationId, appVersion: DIAGNOSTICS_APP_VERSION,
        });
        events = retain([event, ...events]);
        persist(); publish(); return event;
      } catch { return null; }
    },
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

let browserRecorder: DiagnosticRecorder | undefined;
export function getBrowserRecorder(): DiagnosticRecorder {
  if (typeof window === "undefined") return createDiagnosticRecorder();
  if (!browserRecorder) {
    let storage: DiagnosticStorage | undefined;
    try { storage = window.localStorage; } catch { /* Access itself can be denied. */ }
    browserRecorder = createDiagnosticRecorder(storage);
  }
  return browserRecorder;
}
