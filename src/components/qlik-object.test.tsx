// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QlikObject } from "./qlik-object";
import { loadQlik, connectObject, type QlikDoc } from "@/lib/qlik";

vi.mock("@/lib/qlik", () => ({
  QLIK: { appId: "demo-app", identity: "shared-session" },
  loadQlik: vi.fn(),
  connectObject: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(loadQlik).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("Qlik object loading states", () => {
  it("keeps the skeleton until this object connects, then exposes its content", async () => {
    let finish!: (doc: QlikDoc) => void;
    vi.mocked(connectObject).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onDoc = vi.fn();
    const { container } = render(
      <QlikObject objectId="pQam" label="Revenue" kind="kpi" onDoc={onDoc} />,
    );
    await act(async () => {});
    expect(screen.getByTestId("object-skeleton")).toBeTruthy();
    expect(
      container.querySelector("qlik-embed")?.getAttribute("identity"),
    ).toBe("shared-session");
    const doc = {} as QlikDoc;
    await act(async () => finish(doc));
    expect(screen.queryByTestId("object-skeleton")).toBeNull();
    expect(screen.getByRole("region").getAttribute("aria-busy")).toBe("false");
    expect(onDoc).toHaveBeenCalledWith(doc);
  });

  it("reveals slow Qlik UI after the timeout and still recovers when it connects", async () => {
    let finish!: (doc: QlikDoc) => void;
    vi.mocked(connectObject).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<QlikObject objectId="mJHysa" label="Sales chart" kind="chart" />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(20000));
    expect(screen.getByRole("status").textContent).toContain("taking longer");
    expect(screen.queryByTestId("object-skeleton")).toBeNull();
    await act(async () => finish({} as QlikDoc));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a failure instead of an endless skeleton", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(connectObject).mockRejectedValue(
      new Error("Session unavailable"),
    );
    render(<QlikObject objectId="DtNjLk" label="Revenue table" kind="table" />);
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toContain("could not load");
    expect(screen.queryByTestId("object-skeleton")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("does not append a late object or invoke callbacks after unmount", async () => {
    let finish!: () => void;
    vi.mocked(loadQlik).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onDoc = vi.fn();
    const view = render(
      <QlikObject label="Chart" kind="chart" onDoc={onDoc} />,
    );
    view.unmount();
    await act(async () => finish());
    expect(connectObject).not.toHaveBeenCalled();
    expect(onDoc).not.toHaveBeenCalled();
  });
});
