import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QLIK, type QlikSessionObject, type QlikDoc } from "@/lib/qlik";
import { readReportContext } from "@/lib/selection-context";
import { createReportSync } from "@/lib/report-sync";

type Phase = "idle" | "loading" | "syncing" | "auth" | "ready" | "error";
type Launch = { executionId: string; reportId: string; sent: boolean };
type ReportBridgeWindow = Window & {
  ancoreShareReportBridge?: { afterReport: (reportId: string) => boolean };
};

export function ReportWindow({
  doc,
  variableValue,
}: {
  doc?: QlikDoc;
  variableValue: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sync = useRef<ReturnType<typeof createReportSync> | undefined>(undefined);
  const currentValue = useRef(variableValue);
  currentValue.current = variableValue;
  const ready = useRef(false);
  const problem = useRef(false);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const hasApplied = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const pendingLaunch = useRef<Launch | undefined>(undefined);
  const launchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [launchState, setLaunchState] = useState<"preparing" | "requested" | "uncertain" | null>(null);
  const [launchError, setLaunchError] = useState("");

  function cancelUnsentLaunch() {
    if (pendingLaunch.current?.sent) return;
    pendingLaunch.current = undefined;
    setLaunchState(null);
  }

  useEffect(() => {
    if (!loaded || !doc) return;
    let active = true;
    let observer: QlikSessionObject | undefined;
    const id = `report-watch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const controller = createReportSync({
      read: () => readReportContext(doc, currentValue.current),
      send: context => frame.current?.contentWindow?.postMessage(context, location.origin),
      busy: () => {
        if (problem.current) return;
        setPhase(hasApplied.current ? "syncing" : "loading");
        setError("");
      },
      applied: (_value, contextRequestId) => {
        problem.current = false;
        hasApplied.current = true;
        setPhase("ready");
        setError("");
        const launch = pendingLaunch.current;
        if (launch && !launch.sent) {
          launch.sent = true;
          controller.pause();
          setLaunchState("requested");
          frame.current?.contentWindow?.postMessage({
            type: "ancoreShare:execute", appId: QLIK.appId,
            executionId: launch.executionId, reportId: launch.reportId, contextRequestId,
          }, location.origin);
          launchTimer.current = setTimeout(() => {
            setLaunchState("uncertain");
            setLaunchError("The report start could not be confirmed.");
          }, 30000);
        }
      },
      error: error => {
        problem.current = true;
        clearTimeout(startupTimer.current);
        console.error("Report context update failed:", error);
        setPhase("error");
        setError("Report context could not be updated. Please retry Reports.");
        cancelUnsentLaunch();
      },
    });
    sync.current = controller;
    if (ready.current) controller.ready();
    controller.request();
    const changed = () => {
      if (!active) return;
      controller.request();
      // Read the watched model itself to re-arm Qlik's changed notification.
      void observer?.getLayout().catch(controller.fail);
    };
    void doc.createSessionObject({
      qInfo: { qId: id, qType: "ReportContextWatch" },
      qSelectionObjectDef: { qStateName: "$" },
    }).then(async model => {
      if (!active) { await doc.destroySessionObject?.(id); return; }
      observer = model;
      model.on?.("changed", changed);
      await model.getLayout();
    }).catch(error => { if (active) controller.fail(error); });
    return () => {
      active = false;
      observer?.removeListener?.("changed", changed);
      if (observer) void doc.destroySessionObject?.(id).catch(console.debug);
      controller.dispose();
      sync.current = undefined;
    };
  }, [doc, loaded, attempt]);

  useEffect(() => {
    if (!loaded) return;
    startupTimer.current = setTimeout(() => {
      if (ready.current || problem.current) return;
      problem.current = true;
      setPhase("error");
      setError("The report window could not connect to Qlik. Sign in to Qlik in a new tab, then try again. If this continues, your browser may be blocking the report session, or the report service may be unavailable.");
      cancelUnsentLaunch();
    }, 30000);
    return () => clearTimeout(startupTimer.current);
  }, [loaded, attempt]);

  useEffect(() => { sync.current?.request(); }, [variableValue, open]);

  useEffect(() => {
    const host = window as ReportBridgeWindow;
    const previousBridge = host.ancoreShareReportBridge;
    const bridge = {
      afterReport(reportId: string) {
        const launch = pendingLaunch.current;
        if (!launch?.sent || launch.reportId !== reportId) return false;
        frame.current?.contentWindow?.postMessage({
          type: "ancoreShare:afterReportEvent",
          appId: QLIK.appId,
          reportId,
        }, location.origin);
        return true;
      },
    };
    host.ancoreShareReportBridge = bridge;
    return () => {
      if (host.ancoreShareReportBridge !== bridge) return;
      if (previousBridge) host.ancoreShareReportBridge = previousBridge;
      else delete host.ancoreShareReportBridge;
    };
  }, []);

  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "ancoreShare:afterReport") {
        const launch = pendingLaunch.current;
        if (!launch?.sent || event.data.appId !== QLIK.appId ||
            event.data.executionId !== launch.executionId || event.data.reportId !== launch.reportId) return;
        // Hide only. Native downloads/exports may still run after this event.
        closeReports();
        return;
      }
      if (["ancoreShare:executionDispatched", "ancoreShare:executionRejected", "ancoreShare:executionUncertain"].includes(event.data?.type)) {
        if (event.data.appId !== QLIK.appId || event.data.executionId !== pendingLaunch.current?.executionId) return;
        clearTimeout(launchTimer.current);
        if (event.data.type === "ancoreShare:executionDispatched") {
          setLaunchState("requested");
          setLaunchError("");
        } else {
          setLaunchState("uncertain");
          setLaunchError(event.data.type === "ancoreShare:executionRejected"
            ? "The report was not started because its context was not ready."
            : "The report start could not be confirmed.");
        }
        return;
      }
      if (event.data?.type === "ancoreShare:ready") {
        clearTimeout(startupTimer.current);
        problem.current = false;
        ready.current = true;
        setPhase("loading");
        setError("");
        sync.current?.ready();
      }
      if (event.data?.type === "ancoreShare:contextApplied")
        sync.current?.acknowledge(event.data.requestId);
      if (event.data?.type === "ancoreShare:authenticationRequired") {
        clearTimeout(startupTimer.current);
        problem.current = true;
        setPhase("auth");
        setError("The dashboard is connected, but the report window cannot access your Qlik session.");
        cancelUnsentLaunch();
      }
      if (event.data?.type === "ancoreShare:error") {
        sync.current?.fail(new Error("Report could not be prepared."));
        setError(event.data.code === "report-access-denied"
          ? "Your Qlik report account does not have permission to open this app. Sign in with the same account as the dashboard, or ask your Qlik administrator to grant access."
          : event.data.code === "report-auth-failed"
            ? "Qlik could not authorize report exports. Sign in to Qlik in a new tab, then try again. If this continues, ask your administrator to check the browser cookie policy and the Qlik web integration."
            : "Report could not be prepared.");
      }
    };
    window.addEventListener("message", message);
    return () => { window.removeEventListener("message", message); clearTimeout(launchTimer.current); };
  }, []);

  function retryReports() {
    ready.current = false;
    problem.current = false;
    hasApplied.current = false;
    setPhase("loading");
    setError("");
    setAttempt(value => value + 1);
  }

  function showReports() {
    if (!doc) return;
    setLoaded(true);
    setOpen(true);
    if (problem.current) retryReports();
    else sync.current?.request();
  }

  function startReport() {
    if (!doc || pendingLaunch.current) return;
    // A new user click releases the previous context lock. Closing the window
    // alone keeps the mounted runtime and any active export untouched.
    frame.current?.contentWindow?.postMessage({ type: "ancoreShare:releaseExecution", appId: QLIK.appId }, location.origin);
    sync.current?.resume();
    pendingLaunch.current = { executionId: crypto.randomUUID(), reportId: "CJjxGy", sent: false };
    setLaunchState("preparing");
    setLaunchError("");
    showReports();
  }

  function closeReports() {
    clearTimeout(launchTimer.current);
    pendingLaunch.current = undefined;
    setLaunchState(null);
    setLaunchError("");
    setOpen(false);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {error && !open && (
          <span role="status" className="text-xs text-destructive">
            {phase === "auth" ? "Report session unavailable" : "Reports unavailable"}
          </span>
        )}
        <Button type="button" disabled={!doc} onClick={showReports}>
          Show Reports Dialog
        </Button>
        <Button type="button" disabled={!doc || launchState !== null} onClick={startReport}>
          1-Click Report
        </Button>
      </div>

      {loaded && (
        <div
          className={open ? "fixed right-4 top-20 z-50" : "fixed -left-[10000px] top-20 pointer-events-none"}
          data-testid="report-overlay"
          aria-hidden={!open}
          inert={!open}
        >
          <aside
            role="dialog"
            aria-modal="false"
            aria-labelledby="report-window-title"
            className="flex h-[min(240px,calc(100dvh-6rem))] w-[min(480px,calc(100vw-2rem))] min-h-[min(180px,calc(100dvh-6rem))] min-w-[min(320px,calc(100vw-2rem))] max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-2rem)] resize flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
          >
            <header className="flex h-9 shrink-0 items-center gap-2 border-b pl-3 pr-1">
              <h2
                id="report-window-title"
                className="flex-1 text-sm font-semibold"
              >
                ancoreShare Reports
              </h2>
              {phase === "syncing" && <span role="status" className="text-xs text-muted-foreground">Updating…</span>}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close reports"
                className="size-8"
                onClick={closeReports}
              >
                <X className="size-4" />
              </Button>
            </header>
            {launchError && <p role="alert" className="shrink-0 border-b px-4 py-3 text-sm text-destructive">{launchError}</p>}
            <div className="relative min-h-0 flex-1 bg-white">
              <iframe
                key={attempt}
                ref={frame}
                inert={phase === "syncing" || phase === "error" || phase === "auth"}
                title="ancoreShare Reports"
                src={`/api.html?identity=${encodeURIComponent(QLIK.identity)}`}
                className="h-full w-full border-0"
              />
              {phase === "loading" && (
                <div
                  className="pointer-events-none absolute inset-0 bg-white p-4"
                  data-testid="report-skeleton"
                  aria-hidden="true"
                >
                  <div className="h-16 w-full animate-pulse rounded bg-muted" />
                </div>
              )}
              {phase === "syncing" && <div className="absolute inset-0 cursor-wait" aria-label="Updating report context" />}
              {(phase === "error" || phase === "auth") && (
                <div role={phase === "auth" ? "status" : "alert"} className="absolute inset-0 overflow-auto bg-card p-4 text-sm">
                  <h3 className="mb-2 font-semibold">{phase === "auth" ? "Report session unavailable" : "Reports unavailable"}</h3>
                  <p>{error}</p>
                  {phase === "auth" && (
                    <div className="mt-3 space-y-2 text-muted-foreground">
                      <p>Your browser may be blocking the cross-site cookies required by ancoreShare. This commonly happens in InPrivate or Incognito windows.</p>
                      <p>Open this dashboard in a regular browser window, or allow third-party cookies for {new URL(QLIK.host).host}. Then choose Try again.</p>
                      <p>If cookies are already allowed, sign in to Qlik with the same account as the dashboard. If the problem continues, contact your administrator.</p>
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-4">
                    <Button type="button" size="sm" onClick={retryReports}>Try again</Button>
                    <a href={QLIK.host} target="_blank" rel="noopener noreferrer" className="text-primary underline">Sign in to Qlik</a>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
