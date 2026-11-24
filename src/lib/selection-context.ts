import { QLIK, type QlikDoc } from "@/lib/qlik";

const DEFAULT_STATE = "$";
const MAX_SELECTED_VALUES_PER_FIELD = 10_000;
let objectSequence = 0;

export type ReportSelection = {
  field: string;
  state: string;
  values: Array<{ qText: string; qNum?: number }>;
};

export type ReportContext = {
  type: "ancoreShare:setContext";
  requestId: string;
  appId: string;
  selections: ReportSelection[];
  variables: { vTest: number };
};

async function destroy(doc: QlikDoc, id: string) {
  if (!doc.destroySessionObject) return;
  try {
    await doc.destroySessionObject(id);
  } catch (error) {
    console.debug("Could not destroy temporary selection object:", error);
  }
}

async function getSelectedValues(
  doc: QlikDoc,
  selection: {
    qField: string;
    qSelectedCount?: number;
    qTotal?: number;
  },
) {
  const selectedCount = Number(selection.qSelectedCount || 0);
  if (!selectedCount) return [];
  if (selectedCount > MAX_SELECTED_VALUES_PER_FIELD)
    throw new Error(
      `Field "${selection.qField}" has too many selected values to transfer.`,
    );

  const id = `ancoreShare-selection-${Date.now()}-${++objectSequence}`;
  const listObject = await doc.createSessionObject({
    qInfo: { qId: id, qType: "ancoreShareSelectionTransfer" },
    qListObjectDef: {
      qStateName: DEFAULT_STATE,
      qDef: {
        qFieldDefs: [selection.qField],
        qSortCriterias: [{ qSortByState: 1, qSortByLoadOrder: 1 }],
      },
      qInitialDataFetch: [
        { qTop: 0, qLeft: 0, qHeight: selectedCount, qWidth: 1 },
      ],
    },
  });

  try {
    const values: Array<{ qText: string; qNum?: number }> = [];
    const seen = new Set<number>();
    const layout = await listObject.getLayout();
    const total = Number(
      layout.qListObject?.qSize?.qcy || selection.qTotal || 0,
    );
    let top = 0;
    while (top < total && values.length < selectedCount) {
      const height = Math.min(1_000, total - top);
      const pages = await listObject.getListObjectData?.(
        "/qListObjectDef",
        [{ qTop: top, qLeft: 0, qHeight: height, qWidth: 1 }],
      );
      for (const page of pages || []) {
        for (const row of page.qMatrix || []) {
          const cell = row[0];
          if (
            !cell ||
            (cell.qState !== "S" && cell.qState !== "L") ||
            cell.qElemNumber === undefined ||
            seen.has(cell.qElemNumber)
          )
            continue;
          seen.add(cell.qElemNumber);
          const value: { qText: string; qNum?: number } = {
            qText: cell.qText || "",
          };
          if (Number.isFinite(cell.qNum)) value.qNum = cell.qNum;
          values.push(value);
        }
      }
      top += height;
    }
    if (values.length !== selectedCount)
      throw new Error(`Could not resolve selections for ${selection.qField}.`);
    return values;
  } finally {
    await destroy(doc, id);
  }
}

export async function readReportContext(
  doc: QlikDoc,
  variableValue: string,
): Promise<ReportContext> {
  const id = `ancoreShare-current-selections-${Date.now()}-${++objectSequence}`;
  const selectionObject = await doc.createSessionObject({
    qInfo: { qId: id, qType: "CurrentSelections" },
    qSelectionObjectDef: { qStateName: DEFAULT_STATE },
  });
  try {
    const layout = await selectionObject.getLayout();
    const currentSelections = layout.qSelectionObject?.qSelections || [];
    const selections: ReportSelection[] = [];
    for (const selection of currentSelections) {
      selections.push({
        field: selection.qField,
        state: DEFAULT_STATE,
        values: await getSelectedValues(doc, selection),
      });
    }
    const vTest = Number.parseFloat(variableValue);
    if (!Number.isFinite(vTest)) throw new Error("vTest is not numeric.");
    return {
      type: "ancoreShare:setContext",
      requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      appId: QLIK.appId,
      selections,
      variables: { vTest },
    };
  } finally {
    await destroy(doc, id);
  }
}
