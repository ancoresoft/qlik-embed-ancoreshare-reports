// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { connectObject, type QlikElement } from "./qlik";

describe("Qlik initial data readiness", () => {
  it("waits for object data, not just the shared app connection", async () => {
    let resolveLayout!: (layout: object) => void;
    const getLayout = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveLayout = resolve;
        }),
    );
    const getObject = vi.fn(async () => ({ getLayout }));
    const doc = { getObject };
    const element = {
      getRefApi: async () => ({ getDoc: async () => doc }),
    } as unknown as QlikElement;
    let ready = false;
    const result = connectObject(element, "pQam").then((value) => {
      ready = true;
      return value;
    });
    await vi.waitFor(() => expect(getLayout).toHaveBeenCalled());
    expect(ready).toBe(false);
    resolveLayout({});
    expect(await result).toBe(doc);
    expect(getObject).toHaveBeenCalledWith("pQam");
  });

  it("propagates Qlik layout errors instead of treating them as ready", async () => {
    const element = {
      getRefApi: async () => ({
        getDoc: async () => ({
          getObject: async () => ({
            getLayout: async () => ({ qError: { qErrorCode: 7005 } }),
          }),
        }),
      }),
    } as unknown as QlikElement;
    await expect(connectObject(element, "missing")).rejects.toThrow(
      "could not load its data",
    );
  });
});
