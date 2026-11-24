// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { connectObject, loadQlik } from "@/lib/qlik";
vi.mock("@/lib/qlik", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/qlik")>(),
  loadQlik: vi.fn(), connectObject: vi.fn(),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(loadQlik).mockResolvedValue();
  vi.mocked(connectObject).mockImplementation(() => new Promise(() => {}));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("replaces all charts and controls with one English access message on the actual embed fatal event", async () => {
  const view = render(<App />);
  await act(async () => {});
  const element = view.container.querySelector("qlik-embed")!;
  expect(element).toBeTruthy();
  act(() => element.dispatchEvent(new CustomEvent("qlik-embed:error", { detail: {
    message: "Failed to open app YOUR-APP-ID on https://your-tenant.eu.qlikcloud.com: No permission to open the app",
  } })));
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Access denied" })).toBeTruthy();
  expect(screen.getByText("Your Qlik account does not have permission to open this dashboard.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show Reports Dialog" })).toBeNull();
  expect(screen.queryByRole("button", { name: "1-Click Report" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  expect(view.container.querySelector("qlik-embed")).toBeNull();
  await act(async () => vi.advanceTimersByTime(45000));
  expect(screen.queryAllByTestId("object-skeleton")).toHaveLength(0);
  expect(screen.queryByText(/taking longer/)).toBeNull();
  expect(screen.getByRole("link", { name: "Open Qlik" }).getAttribute("rel")).toBe("noopener noreferrer");
});
it("does not mislabel an ordinary network failure as denied access", async () => {
  const view = render(<App />);
  await act(async () => {});
  act(() => view.container.querySelector("qlik-embed")!.dispatchEvent(new CustomEvent("qlik-embed:error", {
    detail: { message: "Network connection lost" },
  })));
  expect(screen.queryByRole("heading", { name: "Access denied" })).toBeNull();
  expect(screen.getByText("Actual Amount could not load.")).toBeTruthy();
});
