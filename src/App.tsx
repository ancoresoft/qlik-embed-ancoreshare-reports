import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { QlikObject } from "@/components/qlik-object";
import { ReportWindow } from "@/components/report-window";
import { QLIK, kpis, type QlikDoc, type QlikVariable } from "@/lib/qlik";

export default function App() {
  const [accessDenied, setAccessDenied] = useState(false);
  const [doc, setDoc] = useState<QlikDoc>();
  const [reloaded, setReloaded] = useState("Consumer Sales (Mashup)");
  const [variable, setVariable] = useState<QlikVariable>();
  const [value, setValue] = useState("…");
  const [committedValue, setCommittedValue] = useState("…");
  const [clearing, setClearing] = useState(false);
  const [updatingVariable, setUpdatingVariable] = useState(false);
  const [error, setError] = useState("");
  const denyAccess = useCallback(() => {
    setAccessDenied(true);
    setDoc(undefined);
    setVariable(undefined);
    setError("");
  }, []);
  const connected = useCallback((nextDoc: QlikDoc) => setDoc(nextDoc), []);

  useEffect(() => {
    if (!doc) return;
    let active = true;
    let currentVariable: QlikVariable | undefined;
    const refresh = async () => {
      const layout = await currentVariable!.getLayout();
      if (active) {
        const next = Number.isFinite(layout.qNum) ? String(layout.qNum) : layout.qText || "0";
        setValue(next);
        setCommittedValue(next);
      }
    };
    const changed = () => {
      void refresh().catch(() => {
        if (active) setValue("Unavailable");
      });
    };
    void doc
      .getAppLayout()
      .then((layout) => {
        const date = new Date(layout.qLastReloadTime || "");
        if (active && !Number.isNaN(date.getTime()))
          setReloaded(
            `Data last reloaded: ${date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
          );
      })
      .catch(() => {});
    void doc
      .getVariableByName("vTest")
      .then(async (model) => {
        if (!active) return;
        currentVariable = model;
        setVariable(model);
        model.on?.("changed", changed);
        await refresh();
      })
      .catch(() => {
        if (active) setValue("Unavailable");
      });
    return () => {
      active = false;
      currentVariable?.removeListener?.("changed", changed);
    };
  }, [doc]);

  async function clear() {
    if (!doc) return;
    setClearing(true);
    setError("");
    try {
      await doc.clearAll(true, "$");
    } catch {
      setError("Selections could not be cleared. Please try again.");
    } finally {
      setClearing(false);
    }
  }
  async function updateVariable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!variable) return;
    const next = Number.parseFloat(value);
    if (!Number.isFinite(next)) {
      setError("Enter a numeric value for vTest.");
      return;
    }
    setUpdatingVariable(true);
    setError("");
    try {
      await variable.setNumValue(next);
      setValue(String(next));
      setCommittedValue(String(next));
    } catch {
      setError("The demo variable could not be updated.");
    } finally {
      setUpdatingVariable(false);
    }
  }

  return (
    <>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-8 px-4 sm:px-6">
          <nav
            aria-label="Main navigation"
            className="order-3 flex w-full gap-6 text-sm sm:order-none sm:w-auto"
          >
            <a
              href="/index.html"
              className="py-4 text-muted-foreground hover:text-primary"
            >
              Overview
            </a>
            <a
              href="/dashboard.html"
              aria-current="page"
              className="border-b-2 border-primary py-4 font-semibold text-primary"
            >
              Dashboard
            </a>
            <a
              href="/implementation-guide.html"
              className="py-4 text-muted-foreground hover:text-primary"
            >
              Guide
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1920px] space-y-5 p-3 sm:p-6">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Consumer Sales
            </h1>
            {!accessDenied && <p className="mt-1 text-xs text-muted-foreground">{reloaded}</p>}
          </div>
          {!accessDenied && <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={!doc || clearing}
              onClick={clear}
            >
              <RotateCcw className="size-4" />
              Clear selections
            </Button>
            <ReportWindow doc={doc} variableValue={committedValue} />
          </div>}
        </section>
        {accessDenied ? (
          <Card role="alert" className="gap-3 p-6 shadow-none">
            <h2 className="text-xl font-semibold">Access denied</h2>
            <p>Your Qlik account does not have permission to open this dashboard.</p>
            <p className="text-sm text-muted-foreground">
              Ask your Qlik administrator to grant you access to this app.
              If you are using the wrong account, sign out of Qlik and sign in with an authorized account.
            </p>
            <div className="mt-2 flex items-center gap-4">
              <Button type="button" onClick={() => window.location.reload()}>Try again</Button>
              <a href={QLIK.host} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Open Qlik</a>
            </div>
          </Card>
        ) : <>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <section
          aria-label="Sales key performance indicators"
          className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7"
        >
          <Card className="justify-center gap-3 p-3 shadow-none">
            <form className="grid gap-2" onSubmit={updateVariable}>
              <label className="text-sm font-medium" htmlFor="vtest-value">
                vTest
              </label>
              <div className="flex gap-2">
                <Input
                  id="vtest-value"
                  aria-label="vTest value"
                  type="number"
                  step="any"
                  value={value === "Unavailable" ? "" : value}
                  onChange={(event) => setValue(event.target.value)}
                  disabled={!variable || updatingVariable}
                  className="min-w-0 text-right font-semibold tabular-nums"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!variable || updatingVariable}
                >
                  Apply
                </Button>
              </div>
            </form>
          </Card>
          {kpis.map((kpi) => (
            <Card
              key={kpi.id}
              className="gap-0 overflow-hidden py-0 shadow-none"
            >
              <QlikObject
                onAccessDenied={denyAccess}
                objectId={kpi.id}
                label={kpi.label}
                kind="kpi"
                className="h-32"
              />
            </Card>
          ))}
        </section>
        <section
          className="grid gap-4 xl:grid-cols-[1fr_1.08fr]"
          aria-label="Sales analysis"
        >
          <Card className="min-w-0 gap-0 overflow-hidden py-0 shadow-none">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Sales by Region</h2>
              <Badge variant="secondary">Region · Product line</Badge>
            </div>
            <QlikObject
              onAccessDenied={denyAccess}
              objectId="mJHysa"
              label="Sales by region and product line"
              kind="chart"
              className="h-[430px] p-2 sm:h-[520px]"
            />
          </Card>
          <Card className="min-w-0 gap-0 overflow-hidden py-0 shadow-none">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Revenue details</h2>
              <Badge variant="secondary">Region · Product</Badge>
            </div>
            <QlikObject
              onAccessDenied={denyAccess}
              objectId="DtNjLk"
              label="Revenue by region and product"
              kind="table"
              className="h-[430px] p-2 sm:h-[520px]"
              onDoc={connected}
            />
          </Card>
        </section>
        </>}
      </main>
    </>
  );
}
