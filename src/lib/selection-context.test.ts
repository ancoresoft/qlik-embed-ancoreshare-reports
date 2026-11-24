// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { type QlikDoc } from "@/lib/qlik";
import { readReportContext } from "./selection-context";

it("copies active Qlik selections and vTest into the report context", async () => {
  const currentSelections = {
    getLayout: vi.fn().mockResolvedValue({
      qSelectionObject: {
        qSelections: [
          { qField: "Region Name", qSelectedCount: 2, qTotal: 3 },
        ],
      },
    }),
  };
  const selectedValues = {
    getLayout: vi.fn().mockResolvedValue({
      qListObject: { qSize: { qcy: 3 } },
    }),
    getListObjectData: vi.fn().mockResolvedValue([
      {
        qMatrix: [
          [{ qState: "S", qElemNumber: 0, qText: "Central" }],
          [{ qState: "O", qElemNumber: 1, qText: "Northeast" }],
          [{ qState: "L", qElemNumber: 2, qText: "Western" }],
        ],
      },
    ]),
  };
  const doc = {
    clearAll: vi.fn(),
    createSessionObject: vi
      .fn()
      .mockResolvedValueOnce(currentSelections)
      .mockResolvedValueOnce(selectedValues),
    destroySessionObject: vi.fn(),
    getAppLayout: vi.fn(),
    getVariableByName: vi.fn(),
    getObject: vi.fn(),
  } as QlikDoc;

  const context = await readReportContext(doc, "10");

  expect(context).toMatchObject({
    type: "ancoreShare:setContext",
    selections: [
      {
        field: "Region Name",
        state: "$",
        values: [{ qText: "Central" }, { qText: "Western" }],
      },
    ],
    variables: { vTest: 10 },
  });
  expect(doc.destroySessionObject).toHaveBeenCalledTimes(2);
});
