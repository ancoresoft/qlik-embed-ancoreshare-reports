import type { ReportContext } from "./selection-context";

export function contextKey(context: ReportContext) {
  return JSON.stringify({
    variables: context.variables,
    selections: context.selections.map(s => ({ ...s,
      values: s.values.map(v => JSON.stringify(v)).sort(),
    })).sort((a, b) => `${a.state}:${a.field}`.localeCompare(`${b.state}:${b.field}`)),
  });
}

// Only one snapshot/application is in flight. Qlik invalidations caused by
// applying our own context are re-read, then discarded if semantically equal.
export function createReportSync(options: {
  read: () => Promise<ReportContext>;
  send: (context: ReportContext) => void;
  busy: () => void;
  applied: (value: number, requestId: string) => void;
  error: (error: unknown) => void;
}) {
  let disposed = false, ready = false, reading = false, dirty = false;
  let paused = false;
  let revision = 0;
  let inFlight: ReportContext | undefined;
  let confirmed: ReportContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 150);
  }
  async function flush() {
    if (disposed || paused || !ready || reading || inFlight || !dirty) return;
    dirty = false;
    reading = true;
    const version = revision;
    try {
      const context = await options.read();
      if (disposed) return;
      if (version !== revision) { dirty = true; return; }
      if (confirmed && contextKey(context) === contextKey(confirmed)) {
        options.applied(confirmed.variables.vTest, confirmed.requestId);
        return;
      }
      inFlight = context;
      timeout = setTimeout(() => fail(new Error("Report context acknowledgement timed out.")), 30000);
      options.send(context);
    } catch (error) {
      if (!disposed) fail(error);
    } finally {
      reading = false;
      if (dirty && !disposed) schedule();
    }
  }
  function fail(error: unknown) {
    clearTimeout(timeout);
    confirmed = undefined;
    dirty = false;
    inFlight = undefined;
    if (!disposed) options.error(error);
  }
  return {
    request() {
      if (disposed) return;
      revision++;
      dirty = true;
      if (paused) return;
      options.busy();
      schedule();
    },
    ready() { ready = true; schedule(); },
    acknowledge(requestId: string) {
      if (disposed || !inFlight || inFlight.requestId !== requestId) return;
      clearTimeout(timeout);
      confirmed = inFlight;
      inFlight = undefined;
      if (dirty) schedule();
      else options.applied(confirmed.variables.vTest, confirmed.requestId);
    },
    pause() { paused = true; clearTimeout(timer); },
    resume() {
      paused = false;
      if (dirty && !disposed) { options.busy(); schedule(); }
    },
    fail,
    dispose() { disposed = true; clearTimeout(timer); clearTimeout(timeout); },
  };
}
