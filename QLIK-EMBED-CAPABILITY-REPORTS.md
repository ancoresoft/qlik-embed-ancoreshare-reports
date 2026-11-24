# Qlik Embed and Capability API report integration

This is the developer reference for the current implementation. See [README.md](README.md) for setup, object IDs and deployment, or [implementation-guide.html](implementation-guide.html) for the walkthrough.

## Components

The dashboard uses `analytics/chart` for six KPIs, a chart and a table. It includes a numeric `vTest` input and Clear selections, with no separate filter pane or selection bar.

`ReportWindow` loads `/api.html?identity=dummy-dashboard` into a same-origin iframe on the first report-action click. **Show Reports Dialog** exposes the native report choices; **1-Click Report** starts the context report directly. The compact, resizable window defaults to 480 × 240 CSS pixels, is constrained to the viewport, and has a 36-pixel header without the variable badge. Native report buttons use 40-pixel containers with 8-pixel spacing; extension progress dialogs are left unchanged. The window is non-modal: the dashboard remains interactive. Closing it hides the window but retains the runtime and context watcher. Retry creates a fresh iframe and context controller without navigating the dashboard.

The Capability API renders two existing objects: Sales Report (`dRenfA`) and Current Selections + Variable (`CJjxGy`). Styling is scoped to `.report-object button`; the installed extension and saved Qlik app are not edited.

## Authentication contracts

Qlik Embed uses OAuth SPA. Capability API and ancoreShare export requests use an interactive Qlik cookie session, Web Integration and CSRF token. The two runtimes must use the same tenant, app and authenticated user. Their shared identity is an application-defined session key, not a credential.

Before loading the extension, `api.html` checks `/api/v1/users/me` with credentials and the Web Integration ID. A 401 or 403 requests sign-in recovery from the host. The embedded page does not redirect to a login provider because that provider can refuse framing. The user signs in to Qlik in a separate tab and retries the report window. Only a directly opened standalone `api.html` uses a top-level login redirect.

A successful OAuth login does not guarantee the cookie session is available. Private browsing and browser policies can block it. A repeated 401 after opening the Qlik hub is a reason to inspect excluded request cookies and compare with a regular browser window, not proof of missing app permissions.

**Keep `window.config = config` before extension loading.** ancoreShare's `setQlikHeaders()` reads `window.config.webIntegrationId` to initialize its export authentication. A lexical `const config` does not expose this property. `getObject()` can resolve before the extension runtime exists, so `api.html` waits for the native initializer, awaits it, and validates the CSRF token and Web Integration ID before announcing readiness.

## Context lifecycle

1. The host reads selected fields and values in Qlik's default state (`$`) through temporary session objects. It rejects incomplete reads and selections exceeding 10,000 values per field, then destroys the temporary objects.
2. The host sends the selection snapshot, committed numeric `vTest`, app ID and request ID to the report iframe. Typing alone does not commit a value; Apply does.
3. The iframe validates the parent origin/source and message payload. The initial context clears its session and applies all selected values and the variable. Later transfers apply only differences.
4. The iframe acknowledges the request after application. Only then are report buttons available.
5. A Qlik selection watcher and committed variable changes request another transfer. The controller debounces requests, serializes updates and skips equivalent snapshots to avoid feedback loops. Only the expected acknowledgement can confirm an update.

No access tokens, cookies or Engine session IDs are included in these messages. Both report buttons consume the same applied context. Context application changes session state, not saved sheet definitions.

## Direct execution bridge (preview)

The dashboard's **1-Click Report** button retains the same iframe, cookie authentication, `window.config`, native `setQlikHeaders()` initialization and context transport as **Show Reports Dialog**. On a direct click, the host queues a single execution. Only the sync controller's confirmed latest context can dispatch `ancoreShare:execute`, carrying an allowlisted report ID, unique execution ID and acknowledged context request ID. Messages validate origin/source; the runtime also checks app, report and context IDs and deduplicates execution IDs for its lifetime.

The runtime waits up to 15 seconds for the native enabled button, then clicks it. `ancoreShare:executionDispatched` confirms dispatch, not report creation, download or completion. A missing acknowledgement or native click failure is shown as uncertain and is never automatically retried. Missing authentication cancels an unsent direct request; signing in/retrying alone does not run it later.

During a direct request, explicit context sync is paused and the compact report window remains visible. Native progress UI is preserved; there is no attempt to move extension dialogs out of the iframe or emulate a completion event. The window can always be closed using X; this hides the iframe and preserves an active export. Closing cancels any unsent automatic start. A subsequent explicit **1-Click Report** click resumes context updates and queues a fresh execution. There is no prepare-another control or explanatory banner. Automatic hiding is enabled when the context report calls the On After Report bridge documented in README.md. The bridge is installed in the iframe and in the same-origin host; host calls are relayed to the iframe for execution correlation. Manual native clicks cannot close an active direct request, and their ambiguity is cleared when a fresh direct request begins unless an earlier automatic execution is unresolved. This is a report-generation event, not a download/delivery completion signal. This does not isolate shared Engine state or govern manual native report clicks. Actual export and progress behavior must be verified against the tenant's installed extension, including popup/download restrictions on programmatic clicks. Preview origins require their own Qlik OAuth callback and Web Integration allowlist entries.

## Errors and cleanup

The dashboard handles `qlik-embed:error` events and connection failures. Explicit app denial replaces the objects with one English Access denied message. Network failures and slow loading are not classified as permission denial.

Report startup and context acknowledgement each time out after 30 seconds. Retry remounts only the report iframe. Effect cleanup removes message/model listeners, disposes the sync controller and destroys the selection watcher. The report window shows sign-in and error details; a compact status remains when it is closed.

## Regression checks

- Match all six KPIs to the Qlik app with the same selections.
- Apply a numeric variable and selections, create the context report, then close and start another report with changed values; verify each export receives its acknowledged context.
- Verify Clear selections, closing during preparation and after dispatch, starting another context report, and iframe-only retry.
- Verify the report buttons remain blocked until context is acknowledged.
- Test app-access denial, missing report login, startup timeout, and blocked-cookie behavior separately.
- Verify both exports complete with data; displaying a button is not sufficient.


## References

- [Qlik Embed authentication](https://qlik.dev/embed/qlik-embed/authenticate/connect-qlik-embed/)
- [Third-party cookies and embedded content](https://qlik.dev/embed/iframe/authenticate/third-party-cookie-handling-with-embedded-content/)
- [Qlik Embed Ref API](https://qlik.dev/embed/qlik-embed/customize/interact-with-ref-api/)
- [Capability APIs](https://qlik.dev/embed/capability-api/)
