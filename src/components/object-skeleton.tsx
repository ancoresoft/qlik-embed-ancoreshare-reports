import { Skeleton } from "@/components/ui/skeleton";

export type ObjectKind = "kpi" | "chart" | "table";

export function ObjectSkeleton({ kind }: { kind: ObjectKind }) {
  if (kind === "kpi")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-2 w-16" />
      </div>
    );
  if (kind === "table")
    return (
      <div className="h-full space-y-4 p-4">
        <Skeleton className="h-4 w-56" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 36 }, (_, i) => (
            <Skeleton key={i} className={i < 4 ? "h-8" : "h-4"} />
          ))}
        </div>
      </div>
    );
  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <Skeleton className="h-4 w-52" />
      <div className="flex gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex flex-1 items-end justify-around gap-6 border-b border-l px-6 pt-4">
        {["h-[82%]", "h-[60%]", "h-[45%]", "h-[25%]"].map((height) => (
          <Skeleton
            key={height}
            className={`w-full max-w-24 rounded-b-none ${height}`}
          />
        ))}
      </div>
      <div className="flex justify-around gap-6 px-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>
    </div>
  );
}
