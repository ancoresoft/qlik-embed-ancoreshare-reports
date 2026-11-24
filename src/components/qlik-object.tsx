import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ObjectSkeleton, type ObjectKind } from "./object-skeleton";
import {
  connectObject,
  loadQlik,
  QLIK,
  type QlikDoc,
  type QlikElement,
} from "@/lib/qlik";
import { isAppAccessDenied } from "@/lib/qlik-errors";
import { cn } from "@/lib/utils";

type Phase = "loading" | "ready" | "slow" | "error";
type Props = {
  objectId?: string;
  label: string;
  kind: ObjectKind;
  className?: string;
  onDoc?: (doc: QlikDoc) => void;
  onAccessDenied?: () => void;
};

export function QlikObject({ objectId, label, kind, className, onDoc, onAccessDenied }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let active = true;
    let failed = false;
    let element: QlikElement | undefined;
    const target = mount.current!;
    setPhase("loading");
    const timer = window.setTimeout(() => {
      if (active && !failed) setPhase("slow");
    }, 20000);
    function fail(error: unknown) {
      if (!active || failed) return;
      failed = true;
      window.clearTimeout(timer);
      setPhase("error");
      if (isAppAccessDenied(error)) onAccessDenied?.();
      console.error(`Could not load ${label}:`, error);
    }
    const embedError = (event: Event) => fail((event as CustomEvent).detail);
    async function connect() {
      try {
        await loadQlik();
        if (!active) return;
        element = document.createElement("qlik-embed") as QlikElement;
        element.addEventListener("qlik-embed:error", embedError);
        element.setAttribute("ui", "analytics/chart");
        element.setAttribute("app-id", QLIK.appId);
        element.setAttribute("identity", QLIK.identity);
        if (objectId) element.setAttribute("object-id", objectId);
        target.appendChild(element);
        const doc = await connectObject(element, objectId);
        if (!active || failed) return;
        window.clearTimeout(timer);
        setPhase("ready");
        onDoc?.(doc);
      } catch (error) {
        fail(error);
      }
    }
    void connect();
    return () => {
      active = false;
      window.clearTimeout(timer);
      element?.removeEventListener("qlik-embed:error", embedError);
      target.replaceChildren();
    };
  }, [objectId, kind, label, onDoc, onAccessDenied]);

  const busy = phase === "loading" || phase === "slow";
  return (
    <div
      className={cn("relative min-w-0", className)}
      role="region"
      aria-label={label}
      aria-busy={busy}
      data-load-state={phase}
    >
      <div ref={mount} className="qlik-mount" hidden={phase === "error"} />
      {phase === "loading" && (
        <div
          className="pointer-events-none absolute inset-0 rounded-lg bg-card"
          data-testid="object-skeleton"
          aria-hidden="true"
        >
          <ObjectSkeleton kind={kind} />
        </div>
      )}
      {phase === "loading" && (
        <span role="status" className="sr-only">
          Loading {label}…
        </span>
      )}
      {(phase === "slow" || phase === "error") && (
        <div
          className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 rounded-md border bg-card/95 px-3 py-2 text-center text-xs text-muted-foreground"
          role="status"
        >
          <span>
            {phase === "error"
              ? `${label} could not load.`
              : `${label} is taking longer to load.`}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </div>
      )}
    </div>
  );
}
