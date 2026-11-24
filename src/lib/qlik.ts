export const QLIK = {
  host: "https://your-tenant.eu.qlikcloud.com",
  appId: "YOUR-APP-ID",
  clientId: "YOUR-OAUTH-CLIENT-ID",
  identity: "dummy-dashboard",
};

export const kpis = [
  { id: "pQam", label: "Actual Amount" },
  { id: "jmhMcE", label: "Budget" },
  { id: "WNhGuc", label: "Margin" },
  { id: "PucAVn", label: "Customer Count" },
  { id: "jJqEnj", label: "Order Count" },
  { id: "TwYTvA", label: "Late Shipments" },
];

export interface QlikVariable {
  getLayout(): Promise<{ qNum?: number; qText?: string }>;
  setNumValue(value: number): Promise<unknown>;
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
}

export interface QlikDoc {
  clearAll(locked: boolean, state: string): Promise<unknown>;
  createSessionObject(definition: unknown): Promise<QlikSessionObject>;
  destroySessionObject?(id: string): Promise<unknown>;
  getAppLayout(): Promise<{ qLastReloadTime?: string }>;
  getVariableByName(name: string): Promise<QlikVariable>;
  getObject(
    id: string,
  ): Promise<{ getLayout(): Promise<{ qError?: { qErrorCode?: number } }> }>;
}

export interface QlikSessionObject {
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
  getLayout(): Promise<{
    qSelectionObject?: {
      qSelections?: Array<{
        qField: string;
        qSelectedCount?: number;
        qTotal?: number;
      }>;
    };
    qListObject?: { qSize?: { qcy?: number } };
  }>;
  getListObjectData?(
    path: string,
    pages: Array<{
      qTop: number;
      qLeft: number;
      qHeight: number;
      qWidth: number;
    }>,
  ): Promise<
    Array<{
      qMatrix?: Array<
        Array<{
          qState?: string;
          qElemNumber?: number;
          qText?: string;
          qNum?: number;
        }>
      >;
    }>
  >;
}

export interface QlikElement extends HTMLElement {
  getRefApi(): Promise<{ getDoc(): Promise<QlikDoc> }>;
}

let sdkPromise: Promise<void> | undefined;

// Configure the SDK before mounting any dynamically created qlik-embed elements.
export function loadQlik(): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/@qlik/embed-web-components@1.7.4/dist/index.min.js";
    script.crossOrigin = "anonymous";
    const attributes: Record<string, string> = {
      "data-host": QLIK.host,
      "data-auth-type": "Oauth2",
      "data-client-id": QLIK.clientId,
      "data-redirect-uri": new URL("/oauth_callback.html", location.origin)
        .href,
      "data-access-token-storage": "session",
      "data-auto-redirect": "true",
    };
    for (const [name, value] of Object.entries(attributes))
      script.setAttribute(name, value);
    script.onerror = () => {
      script.remove();
      sdkPromise = undefined;
      reject(new Error("Qlik could not be downloaded."));
    };
    script.onload = () => {
      customElements.whenDefined("qlik-embed").then(() => resolve());
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export async function connectObject(element: QlikElement, objectId?: string) {
  const ref = await element.getRefApi();
  const doc = await ref.getDoc();
  if (objectId) {
    const model = await doc.getObject(objectId);
    const layout = await model.getLayout();
    if (layout.qError?.qErrorCode)
      throw new Error("This Qlik object could not load its data.");
  }
  return doc;
}
