import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function loadPage(status, csrfStatus = 200, csrfToken = "test-csrf-token", delayExtension = false) {
  const html = readFileSync("public/api.html", "utf8");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const location = {
    href: "https://mashup.example.com/api.html?identity=dummy-dashboard",
    origin: "https://mashup.example.com",
    search: "?identity=dummy-dashboard",
    assign: vi.fn(),
  };
  const parent = { postMessage: vi.fn(), location: { assign: vi.fn() } };
  const window = { parent, top: parent, location, addEventListener: vi.fn() };
  const elements = {};
  const buttons = { "report-button": { click: vi.fn() }, "context-report-button": { click: vi.fn() } };
  const document = { getElementById: (id) => elements[id] ??= { hidden: true, style: {}, addEventListener: vi.fn(), querySelector: vi.fn(() => buttons[id]) } };
  document.getElementById("report-button");
  document.getElementById("context-report-button");
  const initializeExtension = () => {
    window.ancoreSoft = {
      qlik: { CSRFToken: "", webIntegrationId: "", unrelated: true },
      // Reproduce the public extension's window.config lookup. A lexical
      // `const config` alone must not satisfy this contract.
      setQlikHeaders: vi.fn().mockImplementation(async () => {
        const integration = window.config?.webIntegrationId;
        window.ancoreSoft.qlik.webIntegrationId = integration || "";
        window.ancoreSoft.qlik.CSRFToken = integration && csrfStatus === 200 ? csrfToken : "";
      }),
    };
  };
  const fields = new Map();
  const app = { clearAll: vi.fn().mockResolvedValue(true),
    variable: { setNumValue: vi.fn().mockResolvedValue(true) },
    field: vi.fn((name) => {
      if (!fields.has(name)) fields.set(name, { clear: vi.fn().mockResolvedValue(true), selectValues: vi.fn().mockResolvedValue(true) });
      return fields.get(name);
    }),
    getObject: vi.fn().mockImplementation(async () => {
    if (!delayExtension) initializeExtension();
    return {};
  }) };
  const qlik = { setOnError: vi.fn(), openApp: vi.fn().mockReturnValue(app) };
  const require = Object.assign(vi.fn((deps, callback) => callback(qlik)), { config: vi.fn() });
  const fetch = vi.fn().mockResolvedValueOnce({ status, ok: status === 200 });
  const log = { error: vi.fn() };
  runInNewContext(script, { window, document, location, require, fetch, URL, URLSearchParams, setTimeout, console: log });
  return { location, parent, require, qlik, fetch, app, window, elements, initializeExtension, buttons };
}

it.each([401, 403])("requests external sign-in without redirecting either frame on %s", async (status) => {
  const s = loadPage(status);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "ancoreShare:authenticationRequired" }), s.location.origin));
  expect(s.location.assign).not.toHaveBeenCalled();
  expect(s.parent.location.assign).not.toHaveBeenCalled();
  expect(s.require).not.toHaveBeenCalled();
  expect(s.elements["report-buttons"].hidden).toBe(true);
});

async function executionPage() {
  const s = loadPage(200);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "ancoreShare:ready" }), s.location.origin));
  const receive = s.window.addEventListener.mock.calls.find(([name]) => name === "message")[1];
  const send = (data, origin = s.location.origin, source = s.parent) => receive({ origin, source, data });
  const context = { type: "ancoreShare:setContext", appId: "YOUR-APP-ID", requestId: "context-1", variables: { vTest: 7 }, selections: [] };
  send(context);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "ancoreShare:contextApplied", requestId: "context-1" }), s.location.origin));
  const command = { type: "ancoreShare:execute", appId: context.appId, executionId: "run-1", reportId: "dRenfA", contextRequestId: "context-1" };
  return { ...s, send, context, command };
}

it("only dispatches a trusted report once after matching context; queues further context until released", async () => {
  const s = await executionPage();
  s.send(s.command, "https://untrusted.example");
  s.send(s.command, s.location.origin, {});
  s.send({ ...s.command, appId: "wrong" });
  s.send({ ...s.command, reportId: "unknown" });
  expect(s.buttons["report-button"].click).not.toHaveBeenCalled();
  s.send(s.command);
  s.send(s.command);
  s.send({ ...s.command, executionId: "double-click" });
  expect(s.buttons["report-button"].click).toHaveBeenCalledOnce();
  expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:executionDispatched", executionId: "run-1" }), s.location.origin);
  s.send({ ...s.context, requestId: "context-2", variables: { vTest: 9 } });
  expect(s.app.variable.setNumValue).toHaveBeenCalledTimes(1);
  s.send({ type: "ancoreShare:releaseExecution", appId: s.context.appId });
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:contextApplied", requestId: "context-2" }), s.location.origin));
  s.send({ ...s.command, executionId: "run-2", reportId: "CJjxGy", contextRequestId: "context-2" });
  expect(s.buttons["context-report-button"].click).toHaveBeenCalledOnce();
});

it("rejects a stale context without clicking a native report button", async () => {
  const s = await executionPage();
  s.send({ ...s.command, contextRequestId: "stale" });
  expect(s.buttons["report-button"].click).not.toHaveBeenCalled();
  expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:executionRejected" }), s.location.origin);
});

it("does not repeat an ambiguous native click failure", async () => {
  const s = await executionPage();
  s.buttons["report-button"].click.mockImplementation(() => { throw new Error("native failure"); });
  s.send(s.command);
  s.send(s.command);
  expect(s.buttons["report-button"].click).toHaveBeenCalledOnce();
  expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:executionUncertain" }), s.location.origin);
});

it("forwards On After Report once for the current report without resuming context updates", async () => {
  const s = await executionPage();
  const command = { ...s.command, reportId: "CJjxGy" };
  expect(s.window.ancoreShareReportBridge.afterReport("CJjxGy")).toBe(false);
  s.send(command);
  expect(s.window.ancoreShareReportBridge.afterReport("dRenfA")).toBe(false);
  s.send({ type: "ancoreShare:afterReportEvent", appId: command.appId, reportId: "CJjxGy" });
  expect(s.window.ancoreShareReportBridge.afterReport("CJjxGy")).toBe(false);
  expect(s.parent.postMessage).toHaveBeenCalledWith({
    type: "ancoreShare:afterReport", appId: command.appId,
    executionId: command.executionId, reportId: "CJjxGy",
  }, s.location.origin);
  s.send({ ...s.context, requestId: "next-context", variables: { vTest: 9 } });
  expect(s.app.variable.setNumValue).toHaveBeenCalledTimes(1);
  s.send({ type: "ancoreShare:releaseExecution", appId: command.appId });
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:contextApplied", requestId: "next-context" }), s.location.origin));
  s.send({ ...command, executionId: "next-run", contextRequestId: "next-context" });
  expect(s.window.ancoreShareReportBridge.afterReport("CJjxGy")).toBe(true);
});

it("does not misattribute an old after-report event after an overlapping start", async () => {
  const s = await executionPage();
  s.send({ ...s.command, reportId: "CJjxGy" });
  s.send({ type: "ancoreShare:releaseExecution", appId: s.command.appId });
  s.send({ ...s.command, reportId: "CJjxGy", executionId: "overlapping" });
  expect(s.window.ancoreShareReportBridge.afterReport("CJjxGy")).toBe(false);
  expect(s.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:afterReport" }), s.location.origin);
});

it("does not use a manual native button callback to close an automatic report", async () => {
  const s = await executionPage();
  s.send({ ...s.command, reportId: "CJjxGy" });
  s.elements["report-buttons"].addEventListener.mock.calls[0][1]();
  expect(s.window.ancoreShareReportBridge.afterReport("CJjxGy")).toBe(false);
});

it("allows a fresh direct report after an earlier manual report click", async () => {
  const s = await executionPage();
  s.elements["report-buttons"].addEventListener.mock.calls[0][1]();
  s.send({ type: "ancoreShare:releaseExecution", appId: s.command.appId });
  s.send({ ...s.command, reportId: "CJjxGy", executionId: "direct-after-manual" });
  expect(s.window.ancoreShareReportBridge.afterReport("CJjxGy")).toBe(true);
  expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "ancoreShare:afterReport",
    executionId: "direct-after-manual",
  }), s.location.origin);
});

it("cancels a delayed native start when another report is prepared", async () => {
  const s = await executionPage();
  s.elements["report-button"].querySelector.mockReturnValue(null);
  s.send(s.command);
  s.send({ type: "ancoreShare:releaseExecution", appId: s.context.appId });
  s.elements["report-button"].querySelector.mockReturnValue(s.buttons["report-button"]);
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(s.buttons["report-button"].click).not.toHaveBeenCalled();
});

it("uses the September 9 Capability configuration and current button without a redirect when signed in", async () => {
  const s = loadPage(200);
  await vi.waitFor(() => expect(s.app.getObject).toHaveBeenCalledWith("report-button", "dRenfA"));
  expect(s.qlik.openApp).toHaveBeenCalledWith("YOUR-APP-ID", {
    host: "your-tenant.eu.qlikcloud.com", prefix: "/", port: 443, isSecure: true,
    webIntegrationId: "YOUR-WEB-INTEGRATION-ID", identity: "dummy-dashboard",
  });
  expect(s.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/users/me"),
    expect.objectContaining({ credentials: "include" }));
  expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ancoreShare:ready" }), s.location.origin);
  expect(s.location.assign).not.toHaveBeenCalled();
  expect(s.parent.location.assign).not.toHaveBeenCalled();
});

it("exposes window.config and awaits ancoreShare's own header initialization before readiness", async () => {
  const s = loadPage(200);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "ancoreShare:ready" }), s.location.origin));
  expect(s.window.config).toBe(s.qlik.openApp.mock.calls[0][1]);
  expect(s.window.ancoreSoft.setQlikHeaders).toHaveBeenCalledOnce();
  expect(s.window.ancoreSoft.qlik).toEqual({
    CSRFToken: "test-csrf-token", webIntegrationId: "YOUR-WEB-INTEGRATION-ID", unrelated: true,
  });
  // Credentials must stay in the report runtime, never in context messages.
  expect(JSON.stringify(s.parent.postMessage.mock.calls)).not.toContain("test-csrf-token");
});

it.each([[401, null], [200, null]])("does not enable report execution if export auth is unavailable (%s)", async (status, token) => {
  const s = loadPage(200, status, token);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "ancoreShare:error" }), s.location.origin));
  expect(s.parent.postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "ancoreShare:ready" }), s.location.origin);
  expect(s.elements["report-buttons"].hidden).toBe(true);
  expect(s.location.assign).not.toHaveBeenCalled();
  expect(s.parent.location.assign).not.toHaveBeenCalled();
});

it("waits for asynchronous extension initialization before announcing readiness", async () => {
  const s = loadPage(200, 200, "test-csrf-token", true);
  await vi.waitFor(() => expect(s.app.getObject).toHaveBeenCalled());
  expect(s.parent.postMessage).not.toHaveBeenCalled();
  s.initializeExtension();
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "ancoreShare:ready" }), s.location.origin));
  expect(s.window.ancoreSoft.qlik.CSRFToken).toBe("test-csrf-token");
});

it("embeds both reports and updates their shared context without resetting unchanged selections", async () => {
  const s = loadPage(200);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalled());
  expect(s.app.getObject).toHaveBeenCalledWith("context-report-button", "CJjxGy");
  const receive = s.window.addEventListener.mock.calls.find(([name]) => name === "message")[1];
  const send = (requestId, value, selections) => receive({ origin: s.location.origin, source: s.parent,
    data: { type: "ancoreShare:setContext", appId: "YOUR-APP-ID", requestId, variables: { vTest: value }, selections } });
  const region = { field: "Region", state: "$", values: [{ qText: "Central" }] };
  send("first", 3, [region]);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: "first" }), s.location.origin));
  send("variable", 4, [region]);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: "variable", value: 4 }), s.location.origin));
  expect(s.app.clearAll).toHaveBeenCalledTimes(1);
  expect(s.app.field("Region").selectValues).toHaveBeenCalledTimes(1);
  send("cleared", 4, []);
  await vi.waitFor(() => expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: "cleared", fieldCount: 0 }), s.location.origin));
  expect(s.app.field("Region").clear).toHaveBeenCalledTimes(1);
  expect(s.app.variable.setNumValue).toHaveBeenCalledTimes(2);
  expect(s.elements["report-buttons"].hidden).toBe(false);
  expect(s.location.assign).not.toHaveBeenCalled();
});
