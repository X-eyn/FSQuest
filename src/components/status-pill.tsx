import type { ImportStatusValue, PaperReviewStatusValue } from "@/types/domain";

const STATUS_STYLES: Record<ImportStatusValue, string> = {
  UPLOADED: "bg-white/70 text-slate-600",
  INDEXING: "bg-amber-100 text-amber-800",
  INDEXED: "bg-emerald-100 text-emerald-800",
  NEEDS_REVIEW: "bg-orange-100 text-orange-800",
  FAILED: "bg-rose-100 text-rose-800",
};

export function StatusPill({
  status,
}: {
  status: ImportStatusValue;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${STATUS_STYLES[status]}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

const PAPER_STATUS_STYLES: Record<PaperReviewStatusValue, string> = {
  DRAFT: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
};

export function PaperStatusPill({
  status,
}: {
  status: PaperReviewStatusValue;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${PAPER_STATUS_STYLES[status]}`}
    >
      {status === "APPROVED" ? "Approved" : "Needs review"}
    </span>
  );
}
