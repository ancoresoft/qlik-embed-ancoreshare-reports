// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type QlikDoc } from "@/lib/qlik";
import { ReportWindow } from "./report-window";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function qlikDoc(): QlikDoc {
  return {
    clearAll: vi.fn(),
    createSessionObject: vi.fn().mockResolvedValue({
      getLayout: vi
        .fn()
        .mockResolvedValue({ qSelectionObject: { qSelections: [] } }),
    }),
    destroySessionObject: vi.fn().mockResolvedValue(true),
    getAppLayout: vi.fn(),
    getVariableByName: vi.fn(),
    getObject: vi.fn(),
  };
}

it("lazy loads the internal report window and keeps it mounted", () => {
  render(<ReportWindow doc={qlikDoc()} variableValue="7" />);
  expect(screen.queryByTitle("ancoreShare Reports")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Show Reports Dialog" }));
  const frame = screen.getByTitle("ancoreShare Reports");
  expect(frame.getAttribute("src")).toBe(
    "/api.html?identity=dummy-dashboard",
  );
  expect(screen.getByRole("dialog")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Close reports" }));
  expect(screen.getByTestId("report-overlay").getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByTestId("report-overlay").hasAttribute("inert")).toBe(true);
  expect(screen.getByTitle("ancoreShare Reports")).toBe(frame);
});

it("starts the chosen report once after context acknowledgement and keeps progress visible", async () => {
  const doc = qlikDoc();
  const view = render(<ReportWindow doc={doc} variableValue="7" />);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  const frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const receive = (data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, source: frame.contentWindow, data,
  })));
  receive({ type: "ancoreShare:ready" });
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:setContext" }), location.origin));
  const snapshot = post.mock.calls[0][0];
  expect(post.mock.calls.some(([data]) => data.type === "ancoreShare:execute")).toBe(false);
  receive({ type: "ancoreShare:contextApplied", requestId: "wrong" });
  expect(post.mock.calls.some(([data]) => data.type === "ancoreShare:execute")).toBe(false);
  receive({ type: "ancoreShare:contextApplied", requestId: snapshot.requestId });
  const execution = post.mock.calls.find(([data]) => data.type === "ancoreShare:execute")![0];
  expect(execution).toMatchObject({ reportId: "CJjxGy", contextRequestId: snapshot.requestId });
  receive({ type: "ancoreShare:contextApplied", requestId: snapshot.requestId });
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  expect(post.mock.calls.filter(([data]) => data.type === "ancoreShare:execute")).toHaveLength(1);
  receive({ type: "ancoreShare:executionDispatched", executionId: execution.executionId, appId: execution.appId });
  expect(screen.getByRole("button", { name: "Close reports" }).hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByText(/Follow ancoreShare's progress/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Prepare another report" })).toBeNull();
  view.rerender(<ReportWindow doc={doc} variableValue="9" />);
  expect(screen.queryByLabelText("Updating report context")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close reports" }));
  expect(screen.getByTestId("report-overlay").getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByTestId("report-overlay").hasAttribute("inert")).toBe(true);
  expect(post.mock.calls.filter(([data]) => data.type === "ancoreShare:setContext")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:setContext", variables: { vTest: 9 } }), location.origin));
  expect(screen.getByTitle("ancoreShare Reports")).toBe(frame);
  const nextSnapshot = post.mock.calls.filter(([data]) => data.type === "ancoreShare:setContext").at(-1)![0];
  receive({ type: "ancoreShare:contextApplied", requestId: nextSnapshot.requestId });
  const executions = post.mock.calls.filter(([data]) => data.type === "ancoreShare:execute");
  expect(executions).toHaveLength(2);
  expect(executions[1][0].executionId).not.toBe(execution.executionId);
});

it("offers the manual dialog and direct report actions and cancels an unsent start when closed", async () => {
  render(<ReportWindow doc={qlikDoc()} variableValue="7" />);
  expect(screen.getByRole("button", { name: "Show Reports Dialog" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "1-Click Report" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  const frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  fireEvent.click(screen.getByRole("button", { name: "Close reports" }));
  const receive = (data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, source: frame.contentWindow, data,
  })));
  receive({ type: "ancoreShare:ready" });
  await waitFor(() => expect(post).toHaveBeenCalled());
  receive({ type: "ancoreShare:contextApplied", requestId: post.mock.calls[0][0].requestId });
  expect(post.mock.calls.some(([data]) => data.type === "ancoreShare:execute")).toBe(false);
  expect(screen.getByTestId("report-overlay").getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByTestId("report-overlay").hasAttribute("inert")).toBe(true);
});

it("auto-closes only on a trusted matching after-report event and preserves the iframe", async () => {
  render(<ReportWindow doc={qlikDoc()} variableValue="7" />);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  const frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const receive = (data: unknown, origin = location.origin, source: Window = frame.contentWindow!) => act(() => window.dispatchEvent(new MessageEvent("message", { origin, source, data })));
  receive({ type: "ancoreShare:ready" });
  await waitFor(() => expect(post).toHaveBeenCalled());
  receive({ type: "ancoreShare:contextApplied", requestId: post.mock.calls[0][0].requestId });
  const execution = post.mock.calls.find(([data]) => data.type === "ancoreShare:execute")![0];
  const finished = { ...execution, type: "ancoreShare:afterReport" };
  const hostBridge = (window as unknown as { ancoreShareReportBridge: { afterReport: (reportId: string) => boolean } }).ancoreShareReportBridge;
  expect(hostBridge.afterReport("dRenfA")).toBe(false);
  expect(hostBridge.afterReport("CJjxGy")).toBe(true);
  expect(post).toHaveBeenCalledWith({
    type: "ancoreShare:afterReportEvent",
    appId: execution.appId,
    reportId: "CJjxGy",
  }, location.origin);
  receive(finished, "https://untrusted.example");
  receive(finished, location.origin, window);
  receive({ ...finished, executionId: "old-run" });
  receive({ ...finished, reportId: "dRenfA" });
  receive({ ...finished, appId: "wrong" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  const beforeClose = post.mock.calls.length;
  receive(finished);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTitle("ancoreShare Reports")).toBe(frame);
  expect(screen.getByTestId("report-overlay").hasAttribute("inert")).toBe(true);
  expect(post.mock.calls).toHaveLength(beforeClose);
  expect(screen.getByRole("button", { name: "1-Click Report" }).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  receive(finished);
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("cancels an automatic start on missing authentication and does not replay it after retry", async () => {
  render(<ReportWindow doc={qlikDoc()} variableValue="7" />);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  let frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  const receive = (data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, source: frame.contentWindow, data,
  })));
  receive({ type: "ancoreShare:authenticationRequired" });
  expect(screen.getByText("Report session unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  receive({ type: "ancoreShare:ready" });
  await waitFor(() => expect(post).toHaveBeenCalled());
  receive({ type: "ancoreShare:contextApplied", requestId: post.mock.calls[0][0].requestId });
  expect(post.mock.calls.some(([data]) => data.type === "ancoreShare:execute")).toBe(false);
  expect(screen.getByRole("button", { name: "1-Click Report" }).hasAttribute("disabled")).toBe(false);
});

it("sends selections and vTest only after the trusted iframe is ready", async () => {
  const doc = qlikDoc();
  render(<ReportWindow doc={doc} variableValue="12.5" />);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  const frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
  await waitFor(() => expect(doc.createSessionObject).toHaveBeenCalled());

  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://untrusted.example",
        source: frame.contentWindow,
        data: { type: "ancoreShare:ready" },
      }),
    );
  });
  expect(postMessage).not.toHaveBeenCalled();

  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: frame.contentWindow,
        data: { type: "ancoreShare:ready" },
      }),
    );
  });
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "ancoreShare:setContext",
      appId: "YOUR-APP-ID",
      selections: [],
      variables: { vTest: 12.5 },
    }),
    location.origin,
  ));
});

it("reveals the report after the iframe applies its context", async () => {
  render(<ReportWindow doc={qlikDoc()} variableValue="4" />);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  const frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;

  const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
  act(() => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, source: frame.contentWindow, data: { type: "ancoreShare:ready" },
  })));
  await waitFor(() => expect(postMessage).toHaveBeenCalled());
  const sent = postMessage.mock.calls[0][0];

  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: frame.contentWindow,
        data: { type: "ancoreShare:contextApplied", value: 4, requestId: sent.requestId },
      }),
    );
  });

  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:execute", contextRequestId: sent.requestId }), location.origin);
  expect(screen.queryByTestId("report-skeleton")).toBeNull();
});

it("keeps Reports disabled until the Qlik document is connected", () => {
  render(<ReportWindow variableValue="7" />);
  expect(
    screen.getByRole("button", { name: "1-Click Report" }).hasAttribute("disabled"),
  ).toBe(true);
});

it("keeps the floating window open and displays report errors without navigating", () => {
  render(<ReportWindow doc={qlikDoc()} variableValue="4" />);
  const button = screen.getByRole("button", { name: "1-Click Report" });
  expect(button.getAttribute("type")).toBe("button");
  fireEvent.click(button);
  const frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      origin: location.origin,
      source: frame.contentWindow,
      data: { type: "ancoreShare:error" },
    }));
  });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Report could not be prepared.")).toBeTruthy();
  expect(screen.queryByTestId("report-skeleton")).toBeNull();
  expect(screen.getByTitle("ancoreShare Reports")).toBe(frame);
});
it("uses current variables and selections for each new request and removes its watcher", async () => {
  const doc = qlikDoc();
  let changed = () => {};
  let selected = false;
  const observer = { getLayout: vi.fn().mockResolvedValue({}), on: vi.fn((_, cb) => { changed = cb; }), removeListener: vi.fn() };
  vi.mocked(doc.createSessionObject).mockImplementation(async (definition: any) => {
    if (definition.qInfo.qType === "ReportContextWatch") return observer;
    if (definition.qListObjectDef) return {
      getLayout: vi.fn().mockResolvedValue({ qListObject: { qSize: { qcy: 1 } } }),
      getListObjectData: vi.fn().mockResolvedValue([{ qMatrix: [[{ qState: "S", qElemNumber: 0, qText: "Central" }]] }]),
    };
    return { getLayout: vi.fn().mockResolvedValue({ qSelectionObject: { qSelections: selected ? [{ qField: "Region", qSelectedCount: 1, qTotal: 1 }] : [] } }) };
  });
  const view = render(<ReportWindow doc={doc} variableValue="4" />);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  const frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const snapshots = () => post.mock.calls.filter(([data]) => data.type === "ancoreShare:setContext");
  const executions = () => post.mock.calls.filter(([data]) => data.type === "ancoreShare:execute");
  const receive = (data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data })));
  receive({ type: "ancoreShare:ready" });
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  receive({ type: "ancoreShare:contextApplied", requestId: post.mock.calls[0][0].requestId });
  expect(executions()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Close reports" }));
  view.rerender(<ReportWindow doc={doc} variableValue="9" />);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  await waitFor(() => expect(snapshots()).toHaveLength(2));
  expect(snapshots()[1][0]).toMatchObject({ variables: { vTest: 9 } });
  expect(executions()).toHaveLength(1);
  receive({ type: "ancoreShare:contextApplied", requestId: "wrong", value: 100 });
  expect(executions()).toHaveLength(1);
  receive({ type: "ancoreShare:contextApplied", requestId: snapshots()[1][0].requestId });
  expect(executions()).toHaveLength(2);
  expect(executions()[1][0]).toMatchObject({ contextRequestId: snapshots()[1][0].requestId });
  selected = true;
  act(() => changed());
  fireEvent.click(screen.getByRole("button", { name: "Close reports" }));
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  await waitFor(() => expect(snapshots()).toHaveLength(3));
  expect(snapshots()[2][0]).toMatchObject({ variables: { vTest: 9 }, selections: [{ field: "Region", values: [{ qText: "Central" }] }] });
  expect(observer.getLayout).toHaveBeenCalledTimes(2);
  expect(screen.getByTitle("ancoreShare Reports")).toBe(frame);
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("false");
  view.unmount();
  expect(observer.removeListener).toHaveBeenCalledWith("changed", changed);
});

it("offers external report sign-in and retries only the iframe", async () => {
  render(<ReportWindow doc={qlikDoc()} variableValue="4" />);
  fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
  const frame = screen.getByTitle("ancoreShare Reports") as HTMLIFrameElement;
  act(() => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, source: frame.contentWindow,
    data: { type: "ancoreShare:authenticationRequired" },
  })));
  expect(screen.queryByTestId("report-skeleton")).toBeNull();
  expect(screen.getByText("Report session unavailable")).toBeTruthy();
  expect(frame.hasAttribute("inert")).toBe(true);
  expect(screen.getByText(/cross-site cookies required by ancoreShare/)).toBeTruthy();
  expect(screen.getByText(/regular browser window/).textContent).toContain("allow third-party cookies");
  const login = screen.getByRole("link", { name: "Sign in to Qlik" });
  expect(login.getAttribute("target")).toBe("_blank");
  expect(login.getAttribute("href")).toBe("https://your-tenant.eu.qlikcloud.com");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByTitle("ancoreShare Reports")).not.toBe(frame);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByTestId("report-skeleton")).toBeTruthy();
});
it("ends an unresponsive report startup after 30 seconds without declaring a permission error", async () => {
  vi.useFakeTimers();
  try {
    render(<ReportWindow doc={qlikDoc()} variableValue="4" />);
    fireEvent.click(screen.getByRole("button", { name: "1-Click Report" }));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(30000));
    expect(screen.queryByTestId("report-skeleton")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("could not connect to Qlik");
    expect(screen.getByRole("alert").textContent).not.toContain("does not have permission");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    cleanup();
  } finally { vi.useRealTimers(); }
});
