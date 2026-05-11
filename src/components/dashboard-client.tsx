"use client";

import type { DragEvent, CSSProperties } from "react";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart2,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  Clipboard,
  Clock,
  Download,
  Edit2,
  Eye,
  FileText,
  GripVertical,
  HelpCircle,
  List,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  ScanText,
  Trash2,
  Trophy,
  Upload,
  X,
} from "lucide-react";

import { PaperStatusPill, StatusPill } from "@/components/status-pill";
import { CLASS_LEVELS } from "@/lib/exam";
import { formatAppDate, formatExamType, getSectionMarkSummary, toBanglaDigits } from "@/lib/utils";
import type {
  DashboardData,
  ExamTypeValue,
  GeneratedPaperData,
  PaperQualityReport,
  QuestionTypeValue,
  SectionBlueprint,
} from "@/types/domain";

// ====================== DESIGN TOKENS ======================
const C = {
  bg: "#F5F7FB",
  panel: "#FFFFFF",
  border: "#E5E9F2",
  borderStrong: "#D6DCE8",
  ink: "#0B1F3A",
  ink2: "#1F2A44",
  muted: "#6B7589",
  muted2: "#8A93A7",
  blue: "#1F6FEB",
  blue50: "#EAF2FF",
  blue100: "#D6E4FF",
  green: "#16A34A",
  green50: "#E7F7EE",
  orange: "#F97316",
  orange50: "#FFF1E5",
  purple: "#8B5CF6",
  purple50: "#F1ECFE",
  red: "#DC2626",
  red50: "#FEF2F2",
  teal: "#0891B2",
  teal50: "#E0F2FE",
} as const;

// ====================== CONSTANTS ======================
const EXAM_TYPES: ExamTypeValue[] = ["CT1", "CT2", "CT3", "CT4", "FINAL_TERM"];
const PALETTE_TRANSFER_TYPE = "application/x-fsquest-question-block";
const SECTION_TRANSFER_TYPE = "application/x-fsquest-builder-section";

type QuestionBlockDefinition = {
  type: QuestionTypeValue;
  label: string;
  subtitle: string;
  explanation: string;
  defaultTitle: string;
  defaultInstructions?: string;
  defaultItemCount: number;
  defaultMarksPerItem: number;
  color: string;
  bg: string;
};

const QUESTION_BLOCKS: QuestionBlockDefinition[] = [
  { type: "WORD_MEANING", label: "শব্দার্থ", subtitle: "Word meaning", explanation: "পাঠের শব্দ দিয়ে তার সহজ অর্থ লিখানো।", defaultTitle: "শব্দার্থ লেখ", defaultItemCount: 4, defaultMarksPerItem: 0.5, color: C.blue, bg: C.blue50 },
  { type: "SENTENCE_MAKING", label: "বাক্য গঠন", subtitle: "Make sentence", explanation: "একটি শব্দ দিয়ে ছাত্র/ছাত্রী নিজের বাক্য লিখবে।", defaultTitle: "বাক্য গঠন কর", defaultItemCount: 2, defaultMarksPerItem: 1, color: C.green, bg: C.green50 },
  { type: "FILL_IN_BLANK", label: "শূন্যস্থান পূরণ", subtitle: "Fill in blank", explanation: "একটি বাক্যের গুরুত্বপূর্ণ শব্দ ফাঁকা রেখে উত্তর লিখানো।", defaultTitle: "খালি ঘরের শব্দটি লেখ", defaultInstructions: "শুদ্ধ উত্তর লেখ।", defaultItemCount: 2, defaultMarksPerItem: 1, color: C.orange, bg: C.orange50 },
  { type: "SHORT_ANSWER", label: "প্রশ্নোত্তর", subtitle: "Short answer", explanation: "পাঠ থেকে সরাসরি ছোট প্রশ্ন, সঙ্গে শিক্ষক উত্তর।", defaultTitle: "নিচের প্রশ্নগুলোর উত্তর লেখ", defaultItemCount: 2, defaultMarksPerItem: 1, color: C.purple, bg: C.purple50 },
  { type: "MCQ", label: "সঠিক উত্তর", subtitle: "MCQ", explanation: "চারটি অপশন থেকে সঠিক উত্তর বাছাই।", defaultTitle: "সঠিক উত্তরটি বেছে লেখ", defaultItemCount: 4, defaultMarksPerItem: 1, color: C.blue, bg: C.blue50 },
  { type: "MATCHING", label: "মিল করো", subtitle: "Matching", explanation: "বাম পাশের শব্দ/ধ্বনির সঙ্গে ডান পাশের সঠিক মিল বসানো।", defaultTitle: "ডান পাশ থেকে শব্দ এনে বাম পাশে বসাই", defaultItemCount: 4, defaultMarksPerItem: 0.5, color: C.green, bg: C.green50 },
  { type: "ANTONYM", label: "বিপরীত শব্দ", subtitle: "Opposite word", explanation: "একটি শব্দের বিপরীত অর্থের শব্দ লিখানো।", defaultTitle: "বিপরীত শব্দ লেখ", defaultItemCount: 2, defaultMarksPerItem: 0.5, color: C.orange, bg: C.orange50 },
  { type: "MEMORIZATION", label: "মুখস্থ অংশ", subtitle: "Memorization", explanation: "নির্দিষ্ট পাঠ/অংশ থেকে মুখস্থ লেখা।", defaultTitle: "মুখস্থ অংশ লেখ", defaultInstructions: "নির্বাচিত পাঠ থেকে মুখস্থ অংশ শুদ্ধভাবে লেখ।", defaultItemCount: 1, defaultMarksPerItem: 5, color: C.purple, bg: C.purple50 },
  { type: "ORAL_READING", label: "স্বরব পাঠ", subtitle: "Oral reading", explanation: "শিক্ষক শুনে পাঠ/উচ্চারণের নম্বর দেবেন।", defaultTitle: "স্বরব পাঠ", defaultItemCount: 1, defaultMarksPerItem: 5, color: C.teal, bg: C.teal50 },
];

// ====================== HELPER FUNCTIONS ======================
function getPreferredBookId(books: DashboardData["books"]) {
  return books.find((b) => b.importStatus === "INDEXED")?.id ?? books[0]?.id ?? "";
}

function getQuestionBlock(type: QuestionTypeValue): QuestionBlockDefinition {
  return QUESTION_BLOCKS.find((b) => b.type === type) ?? QUESTION_BLOCKS[0]!;
}

function makeSectionId(type: QuestionTypeValue, index: number) {
  return `${type.toLowerCase().replaceAll("_", "-")}-${Date.now().toString(36)}-${index}`;
}

function createSectionFromBlock(block: QuestionBlockDefinition, index: number): SectionBlueprint {
  return {
    id: makeSectionId(block.type, index),
    type: block.type,
    title: block.defaultTitle,
    instructions: block.defaultInstructions,
    itemCount: block.defaultItemCount,
    marksPerItem: block.defaultMarksPerItem,
  };
}

function getSectionTotal(section: SectionBlueprint) {
  if (section.marksPattern?.length) {
    return section.marksPattern.reduce((s, m) => s + m, 0);
  }
  return (section.marksPerItem ?? 0) * section.itemCount;
}

function getStructureTotal(structure: SectionBlueprint[]) {
  return structure.reduce((s, sec) => s + getSectionTotal(sec), 0);
}

function reorderSections(structure: SectionBlueprint[], from: number, to: number) {
  const next = [...structure];
  const [moved] = next.splice(from, 1);
  if (!moved) return structure;
  next.splice(to, 0, moved);
  return next;
}

function formatExamLabel(examType: ExamTypeValue): string {
  switch (examType) {
    case "CT1": return "CT 1";
    case "CT2": return "CT 2";
    case "CT3": return "CT 3";
    case "CT4": return "CT 4";
    case "FINAL_TERM": return "Final Term";
    default: return formatExamType(examType);
  }
}

// ====================== TYPES ======================
type TemplateDraft = {
  totalMarks: number;
  durationMinutes: number;
  instructions: string;
  structure: SectionBlueprint[];
};

type RailView = "paper" | "library" | "settings";
type CanvasMode = "build" | "review";

// ====================== SMALL UI PRIMITIVES ======================
function Pill({
  color,
  bg,
  children,
}: {
  color: string;
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 10px",
        borderRadius: 999,
        background: bg,
        color,
        fontSize: 12.5,
        fontWeight: 600,
        border: `1px solid ${bg}`,
        whiteSpace: "nowrap" as const,
      }}
    >
      {children}
    </span>
  );
}

function SelectDropdown({
  value,
  options,
  onChange,
  icon,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          flex: 1,
          width: "100%",
          height: 36,
          background: C.panel,
          border: `1px solid ${open ? C.blue : C.border}`,
          borderRadius: 8,
          padding: "0 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 13,
          cursor: "pointer",
          boxShadow: open ? `0 0 0 3px rgba(31,111,235,0.15)` : "none",
          transition: "border-color 120ms, box-shadow 120ms",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon}
          <span style={{ color: C.ink2, fontWeight: 500 }}>
            {options.find((o) => o.value === value)?.label ?? value}
          </span>
        </span>
        <ChevronDown size={14} color={C.muted} strokeWidth={2} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            boxShadow: "0 4px 14px rgba(15,25,50,0.08)",
            padding: 4,
            zIndex: 40,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 6,
                fontSize: 13,
                color: C.ink2,
                background: opt.value === value ? C.bg : "transparent",
                fontWeight: opt.value === value ? 600 : 500,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                border: "none",
              }}
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check size={13} color={C.blue} strokeWidth={2.4} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ====================== TOP NAV ======================
function TopNav({
  activeBook,
  activeReviewPaper,
  canvasMode,
  busyMessage,
  notice,
  isPending,
  onSaveDraft,
  onExportDocx,
}: {
  activeBook: DashboardData["books"][number] | undefined;
  activeReviewPaper: GeneratedPaperData | undefined;
  canvasMode: CanvasMode;
  busyMessage: string | null;
  notice: string | null;
  isPending: boolean;
  onSaveDraft: () => void;
  onExportDocx: () => void;
}) {
  const title =
    activeReviewPaper && canvasMode === "review"
      ? activeReviewPaper.title
      : activeBook
        ? activeBook.title
        : "Question Paper Builder";

  return (
    <header
      style={{
        height: 64,
        flexShrink: 0,
        background: C.panel,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 20px 0 16px",
        gap: 16,
        zIndex: 30,
      }}
    >
      {/* Left: Logo + Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 240 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: C.blue50,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Clipboard size={20} color={C.blue} strokeWidth={1.9} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>
          Question Paper Builder
        </div>
      </div>

      {/* Center: Paper title */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            color: C.ink2,
            maxWidth: 480,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span>{title}</span>
          {(busyMessage || isPending) && (
            <LoaderCircle size={16} color={C.blue} strokeWidth={2} className="animate-spin" />
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {notice && (
          <span
            style={{
              fontSize: 12.5,
              color: notice.toLowerCase().includes("fail") || notice.toLowerCase().includes("error")
                ? C.red
                : C.green,
              maxWidth: 300,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {notice}
          </span>
        )}
        <button
          className="btn-secondary"
          onClick={onSaveDraft}
          disabled={Boolean(busyMessage)}
          style={{ gap: 8 }}
        >
          <Save size={15} strokeWidth={1.8} />
          <span>Save Draft</span>
        </button>
        <button
          className="btn-primary"
          onClick={onExportDocx}
          disabled={Boolean(busyMessage)}
          style={{ gap: 8 }}
        >
          <Download size={15} strokeWidth={2} />
          <span>Export DOCX</span>
        </button>
        {(busyMessage || isPending) && (
          <div
            style={{
              position: "relative",
              width: 36,
              height: 36,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
            }}
            title={busyMessage ?? "Loading…"}
          >
            <Bell size={18} color={C.ink2} />
            <span
              style={{
                position: "absolute",
                top: 7,
                right: 8,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: C.orange,
                border: `2px solid ${C.panel}`,
              }}
            />
          </div>
        )}
      </div>
    </header>
  );
}

// ====================== LEFT RAIL ======================
function LeftRail({
  active,
  onChange,
}: {
  active: RailView;
  onChange: (v: RailView) => void;
}) {
  const items: { id: RailView; Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>; label: string }[] = [
    { id: "paper", Icon: Clipboard, label: "Paper" },
    { id: "library", Icon: BookOpen, label: "Library" },
    { id: "settings", Icon: Settings, label: "Settings" },
  ];

  return (
    <aside
      style={{
        width: 64,
        flexShrink: 0,
        background: C.panel,
        borderRight: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "14px 0",
      }}
    >
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, alignItems: "center" }}>
        {items.map(({ id, Icon, label }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              title={label}
              style={{
                position: "relative",
                width: 40,
                height: 40,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                background: isActive ? C.blue50 : "transparent",
                border: "none",
                cursor: "pointer",
                transition: "background 120ms ease",
              }}
            >
              <Icon
                size={20}
                color={isActive ? C.blue : C.muted}
                strokeWidth={isActive ? 2 : 1.7}
              />
              {isActive && (
                <span
                  style={{
                    position: "absolute",
                    left: -16,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    borderRadius: 3,
                    background: C.blue,
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>
      <button
        title="Help"
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          border: "none",
          cursor: "pointer",
          background: "transparent",
        }}
      >
        <HelpCircle size={20} color={C.muted2} strokeWidth={1.7} />
      </button>
    </aside>
  );
}

// ====================== EXAM SETUP PANEL ======================
function ExamSetupPanel({
  books,
  activeBook,
  onBookChange,
  examType,
  onExamTypeChange,
  selectedChapterIds,
  onChapterToggle,
  templateDraft,
  onTemplateDraftChange,
  marksByType,
  totalUsed,
}: {
  books: DashboardData["books"];
  activeBook: DashboardData["books"][number] | undefined;
  onBookChange: (id: string) => void;
  examType: ExamTypeValue;
  onExamTypeChange: (t: ExamTypeValue) => void;
  selectedChapterIds: string[];
  onChapterToggle: (id: string, checked: boolean) => void;
  templateDraft: TemplateDraft | null;
  onTemplateDraftChange: (updater: (d: TemplateDraft) => TemplateDraft) => void;
  marksByType: Record<string, number>;
  totalUsed: number;
}) {
  const iconStyle: CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: 5,
    background: C.bg,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  };

  const totalTarget = templateDraft?.totalMarks ?? 0;
  const chapters = activeBook?.chapters ?? [];

  const classOptions = books.map((b) => ({ value: b.id, label: `Class ${b.classLevel} — ${b.title}` }));
  const examOptions = EXAM_TYPES.map((t) => ({ value: t, label: formatExamLabel(t) }));

  return (
    <aside
      style={{
        width: 296,
        flexShrink: 0,
        background: C.panel,
        borderRight: `1px solid ${C.border}`,
        padding: "20px 18px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>
        Exam Setup
      </h2>

      {/* Fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Book / Class */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 72, fontSize: 12.5, color: C.muted, fontWeight: 500, flexShrink: 0 }}>
            Book
          </div>
          <SelectDropdown
            value={activeBook?.id ?? ""}
            options={classOptions.length > 0 ? classOptions : [{ value: "", label: "No books yet" }]}
            onChange={onBookChange}
            icon={<span style={iconStyle}><BookOpen size={12} color={C.muted} strokeWidth={1.8} /></span>}
          />
        </div>

        {/* Subject */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 72, fontSize: 12.5, color: C.muted, fontWeight: 500, flexShrink: 0 }}>
            Subject
          </div>
          <div
            style={{
              flex: 1,
              height: 36,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "0 10px",
              display: "flex",
              alignItems: "center",
              fontSize: 13,
              color: C.ink2,
              fontWeight: 500,
            }}
          >
            <span style={iconStyle}><FileText size={12} color={C.muted} strokeWidth={1.8} /></span>
            <span style={{ marginLeft: 8 }}>{activeBook?.subject ?? "—"}</span>
          </div>
        </div>

        {/* Exam type */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 72, fontSize: 12.5, color: C.muted, fontWeight: 500, flexShrink: 0 }}>
            Exam
          </div>
          <SelectDropdown
            value={examType}
            options={examOptions}
            onChange={(v) => onExamTypeChange(v as ExamTypeValue)}
            icon={<span style={iconStyle}><Clipboard size={12} color={C.muted} strokeWidth={1.8} /></span>}
          />
        </div>

        {/* Duration */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 72, fontSize: 12.5, color: C.muted, fontWeight: 500, flexShrink: 0 }}>
            Duration
          </div>
          <div
            style={{
              flex: 1,
              height: 36,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "0 10px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={iconStyle}><Clock size={12} color={C.muted} strokeWidth={1.8} /></span>
            <input
              type="number"
              min={1}
              value={templateDraft?.durationMinutes ?? ""}
              onChange={(e) =>
                onTemplateDraftChange((d) => ({
                  ...d,
                  durationMinutes: Number(e.target.value) || d.durationMinutes,
                }))
              }
              disabled={!templateDraft}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 13,
                color: C.ink2,
                fontWeight: 500,
                padding: 0,
              }}
            />
            <span style={{ fontSize: 12, color: C.muted }}>min</span>
          </div>
        </div>

        {/* Total Marks */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 72, fontSize: 12.5, color: C.muted, fontWeight: 500, flexShrink: 0 }}>
            Total Marks
          </div>
          <div
            style={{
              flex: 1,
              height: 36,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "0 10px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={iconStyle}><Trophy size={12} color={C.orange} strokeWidth={1.8} /></span>
            <input
              type="number"
              min={1}
              value={templateDraft?.totalMarks ?? ""}
              onChange={(e) =>
                onTemplateDraftChange((d) => ({
                  ...d,
                  totalMarks: Number(e.target.value) || d.totalMarks,
                }))
              }
              disabled={!templateDraft}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 13,
                color: C.ink2,
                fontWeight: 500,
                padding: 0,
              }}
            />
          </div>
        </div>
      </div>

      {/* Included Chapters */}
      <div
        style={{
          background: "#F8FAFD",
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "14px 14px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <BookOpen size={15} color={C.blue} strokeWidth={1.9} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>Included Chapters</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {chapters.length === 0 ? (
            <p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>
              {activeBook ? "No chapters indexed yet." : "Select a book first."}
            </p>
          ) : (
            chapters.map((ch) => {
              const checked = selectedChapterIds.includes(ch.id);
              return (
                <button
                  key={ch.id}
                  onClick={() => onChapterToggle(ch.id, !checked)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "6px 4px",
                    borderRadius: 6,
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      border: `1.5px solid ${checked ? C.blue : "#C9D1E0"}`,
                      background: checked ? C.blue : C.panel,
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      marginTop: 1,
                      transition: "all 120ms ease",
                    }}
                  >
                    {checked && <Check size={11} color="#FFFFFF" strokeWidth={3} />}
                  </span>
                  <div>
                    <span style={{ fontSize: 13, color: C.ink2, fontWeight: 500 }}>
                      {ch.title}
                    </span>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                      pp. {ch.startPage ?? "?"} – {ch.endPage ?? "?"}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Marks Summary */}
      {templateDraft && templateDraft.structure.length > 0 && (
        <div
          style={{
            background: "#F8FAFD",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "14px 14px 12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: C.blue50,
                display: "grid",
                placeItems: "center",
              }}
            >
              <BarChart2 size={13} color={C.blue} strokeWidth={1.9} />
            </div>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>Marks Summary</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {Object.entries(marksByType).map(([type, marks]) => {
              if (marks <= 0) return null;
              const block = getQuestionBlock(type as QuestionTypeValue);
              return (
                <div
                  key={type}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 0",
                    fontSize: 13,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: block.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: C.ink2 }}>{block.label}</span>
                  </span>
                  <span style={{ fontWeight: 600, color: C.ink2 }}>{marks}</span>
                </div>
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 8,
              paddingTop: 12,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <span style={{ color: C.ink2, fontWeight: 600 }}>Total</span>
            <span
              style={{
                color: totalUsed > totalTarget ? C.red : C.blue,
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {totalUsed}{" "}
              <span style={{ color: C.muted, fontWeight: 500 }}>/ {totalTarget} marks</span>
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}

// ====================== PAPER CANVAS ======================
function PaperCanvas({
  canvasMode,
  onCanvasModeChange,
  activeBook,
  selectedExamType,
  templateDraft,
  activeReviewPaper,
  paperDrafts,
  onPaperDraftChange,
  dropTargetIndex,
  onDropTargetChange,
  onBuilderDrop,
  onSectionDragStart,
  onSectionUpdate,
  onSectionMove,
  onSectionDuplicate,
  onSectionRemove,
  settings,
}: {
  canvasMode: CanvasMode;
  onCanvasModeChange: (m: CanvasMode) => void;
  activeBook: DashboardData["books"][number] | undefined;
  selectedExamType: ExamTypeValue;
  templateDraft: TemplateDraft | null;
  activeReviewPaper: GeneratedPaperData | undefined;
  paperDrafts: Record<string, { prompt: string; answerText: string }>;
  onPaperDraftChange: (qId: string, field: "prompt" | "answerText", val: string) => void;
  dropTargetIndex: number | null;
  onDropTargetChange: (i: number | null) => void;
  onBuilderDrop: (e: DragEvent<HTMLDivElement>, i: number) => void;
  onSectionDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onSectionUpdate: (i: number, updater: (s: SectionBlueprint) => SectionBlueprint) => void;
  onSectionMove: (i: number, dir: -1 | 1) => void;
  onSectionDuplicate: (section: SectionBlueprint, i: number) => void;
  onSectionRemove: (i: number) => void;
  settings: DashboardData["settings"];
}) {
  return (
    <main
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: C.bg,
      }}
    >
      {/* Canvas Toolbar */}
      <div
        style={{
          height: 56,
          flexShrink: 0,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${C.border}`,
          background: C.panel,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: C.blue50,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Clipboard size={15} color={C.blue} strokeWidth={1.9} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>
            {canvasMode === "build" ? "Live Paper Preview" : "Review Questions"}
          </span>
        </div>

        {/* Mode toggle tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {activeReviewPaper && (
            <>
              <button
                onClick={() => onCanvasModeChange("build")}
                style={{
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 500,
                  border: `1px solid ${C.border}`,
                  background: canvasMode === "build" ? C.blue : "transparent",
                  color: canvasMode === "build" ? "#FFFFFF" : C.ink2,
                  cursor: "pointer",
                }}
              >
                Builder
              </button>
              <button
                onClick={() => onCanvasModeChange("review")}
                style={{
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 500,
                  border: `1px solid ${C.border}`,
                  background: canvasMode === "review" ? C.blue : "transparent",
                  color: canvasMode === "review" ? "#FFFFFF" : C.ink2,
                  cursor: "pointer",
                }}
              >
                Review
              </button>
            </>
          )}

          {/* Status pills */}
          {activeBook?.importStatus === "INDEXED" && (
            <Pill color={C.green} bg={C.green50}>
              <Check size={12} strokeWidth={2.2} />
              <span>Indexed</span>
            </Pill>
          )}
          {activeReviewPaper && (
            <Pill color={C.green} bg={C.green50}>
              <Sparkles size={12} strokeWidth={2} />
              <span>Paper Ready</span>
            </Pill>
          )}
        </div>
      </div>

      {/* Canvas scroll area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "28px 36px 60px",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      >
        {/* ---- BUILD MODE: Template Structure ---- */}
        {canvasMode === "build" && templateDraft && (
          <article
            className="serif"
            style={{
              width: "100%",
              maxWidth: 720,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              boxShadow: "0 6px 24px rgba(15,25,50,0.08), 0 2px 6px rgba(15,25,50,0.04)",
              padding: "36px 52px 44px",
              color: C.ink,
            }}
          >
            {/* Paper header */}
            <header style={{ textAlign: "center", marginBottom: 24 }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: "-0.005em",
                  color: C.ink,
                }}
              >
                {settings.schoolName}
              </h1>
              {settings.schoolTagline && (
                <div style={{ marginTop: 4, fontSize: 14, color: C.muted }}>
                  {settings.schoolTagline}
                </div>
              )}
              <div
                style={{
                  marginTop: 8,
                  fontSize: 18,
                  fontWeight: 600,
                  color: C.ink2,
                }}
              >
                {activeBook?.subject ?? "—"} – {formatExamLabel(selectedExamType)}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 14,
                  color: C.ink2,
                  display: "flex",
                  justifyContent: "center",
                  gap: 12,
                }}
              >
                <span>Class {activeBook?.classLevel ?? "—"}</span>
                <span style={{ color: C.borderStrong }}>|</span>
                <span>Time: {templateDraft.durationMinutes} min</span>
                <span style={{ color: C.borderStrong }}>|</span>
                <span>Full Marks: {templateDraft.totalMarks}</span>
              </div>
              {templateDraft.instructions && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12.5,
                    color: C.muted,
                    fontStyle: "italic",
                  }}
                >
                  {templateDraft.instructions}
                </div>
              )}
              <div style={{ borderTop: `1.5px solid ${C.ink}`, marginTop: 14 }} />
            </header>

            {/* Paper sections */}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {templateDraft.structure.length === 0 && (
                <div
                  style={{
                    padding: "40px 20px",
                    textAlign: "center",
                    border: `2px dashed ${C.border}`,
                    borderRadius: 8,
                    color: C.muted,
                    fontSize: 14,
                    fontFamily: "var(--font-inter), system-ui, sans-serif",
                  }}
                >
                  Add question blocks from the right panel to build your paper.
                </div>
              )}

              {templateDraft.structure.map((section, sectionIndex) => {
                const block = getQuestionBlock(section.type);
                const sectionTotal = getSectionTotal(section);
                const isDrop = dropTargetIndex === sectionIndex;

                return (
                  <div key={section.id}>
                    {/* Drop zone before section */}
                    <div
                      style={{
                        height: isDrop ? 48 : 4,
                        borderRadius: 6,
                        background: isDrop ? C.blue50 : "transparent",
                        border: isDrop ? `2px dashed ${C.blue}` : "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: isDrop ? 8 : 0,
                        transition: "height 120ms, background 120ms",
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        onDropTargetChange(sectionIndex);
                      }}
                      onDrop={(e) => onBuilderDrop(e, sectionIndex)}
                    >
                      {isDrop && (
                        <span style={{ fontSize: 13, color: C.blue, fontWeight: 600, fontFamily: "var(--font-inter), system-ui" }}>
                          Drop here
                        </span>
                      )}
                    </div>

                    {/* Section */}
                    <section
                      draggable
                      onDragStart={(e) => onSectionDragStart(e, section.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        onDropTargetChange(sectionIndex);
                      }}
                      onDrop={(e) => onBuilderDrop(e, sectionIndex)}
                      style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        padding: "16px",
                        background: "#FAFBFD",
                        fontFamily: "var(--font-inter), system-ui, sans-serif",
                      }}
                    >
                      {/* Section head */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          marginBottom: 10,
                          gap: 10,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                          <GripVertical size={16} color={C.muted2} style={{ cursor: "grab", flexShrink: 0 }} />
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: block.bg,
                              color: block.color,
                              fontSize: 11.5,
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {block.label}
                          </span>
                          <input
                            value={section.title}
                            onChange={(e) =>
                              onSectionUpdate(sectionIndex, (s) => ({ ...s, title: e.target.value }))
                            }
                            style={{
                              flex: 1,
                              border: `1px solid transparent`,
                              borderRadius: 6,
                              padding: "3px 8px",
                              fontSize: 15,
                              fontWeight: 700,
                              color: C.ink,
                              background: "transparent",
                              outline: "none",
                              fontFamily: "var(--font-source-serif), Georgia, serif",
                            }}
                            onFocus={(e) => {
                              e.target.style.border = `1px solid ${C.blue}`;
                              e.target.style.background = C.panel;
                            }}
                            onBlur={(e) => {
                              e.target.style.border = "1px solid transparent";
                              e.target.style.background = "transparent";
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: C.ink,
                            whiteSpace: "nowrap",
                            fontFamily: "var(--font-source-serif), Georgia, serif",
                          }}
                        >
                          ({sectionTotal} marks)
                        </span>
                      </div>

                      {/* Item count & marks controls */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr auto",
                          gap: 8,
                          alignItems: "center",
                          marginTop: 8,
                        }}
                      >
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          Items
                          <input
                            className="field"
                            type="number"
                            min={1}
                            value={section.itemCount}
                            onChange={(e) =>
                              onSectionUpdate(sectionIndex, (s) => ({
                                ...s,
                                itemCount: Number(e.target.value) || s.itemCount,
                              }))
                            }
                            style={{ marginTop: 4, fontSize: 13 }}
                          />
                        </label>
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          {section.marksPattern ? "Mark Pattern" : "Marks Each"}
                          <input
                            className="field"
                            value={section.marksPattern?.join(", ") ?? String(section.marksPerItem ?? 1)}
                            onChange={(e) =>
                              onSectionUpdate(sectionIndex, (s) => {
                                const parts = e.target.value.split(/[, ]+/).map(Number).filter((n) => n > 0);
                                if (parts.length > 1) {
                                  return { ...s, itemCount: parts.length, marksPattern: parts, marksPerItem: undefined };
                                }
                                return { ...s, marksPattern: undefined, marksPerItem: parts[0] ?? s.marksPerItem ?? 1 };
                              })
                            }
                            style={{ marginTop: 4, fontSize: 13 }}
                          />
                        </label>
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          Instructions
                          <input
                            className="field"
                            value={section.instructions ?? ""}
                            onChange={(e) =>
                              onSectionUpdate(sectionIndex, (s) => ({
                                ...s,
                                instructions: e.target.value || undefined,
                              }))
                            }
                            style={{ marginTop: 4, fontSize: 13 }}
                          />
                        </label>

                        {/* Action buttons */}
                        <div style={{ display: "flex", gap: 4, alignSelf: "flex-end", paddingBottom: 1 }}>
                          <button
                            onClick={() => onSectionMove(sectionIndex, -1)}
                            disabled={sectionIndex === 0}
                            title="Move up"
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              border: `1px solid ${C.border}`,
                              background: C.panel,
                              display: "grid",
                              placeItems: "center",
                              cursor: sectionIndex === 0 ? "not-allowed" : "pointer",
                              opacity: sectionIndex === 0 ? 0.4 : 1,
                              fontSize: 13,
                            }}
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => onSectionMove(sectionIndex, 1)}
                            disabled={sectionIndex === (templateDraft?.structure.length ?? 0) - 1}
                            title="Move down"
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              border: `1px solid ${C.border}`,
                              background: C.panel,
                              display: "grid",
                              placeItems: "center",
                              cursor:
                                sectionIndex === (templateDraft?.structure.length ?? 0) - 1
                                  ? "not-allowed"
                                  : "pointer",
                              opacity:
                                sectionIndex === (templateDraft?.structure.length ?? 0) - 1 ? 0.4 : 1,
                              fontSize: 13,
                            }}
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => onSectionDuplicate(section, sectionIndex)}
                            title="Duplicate"
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              border: `1px solid ${C.border}`,
                              background: C.panel,
                              display: "grid",
                              placeItems: "center",
                              cursor: "pointer",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            +1
                          </button>
                          <button
                            onClick={() => onSectionRemove(sectionIndex)}
                            title="Remove"
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              border: `1px solid ${C.border}`,
                              background: "#FFF5F5",
                              display: "grid",
                              placeItems: "center",
                              cursor: "pointer",
                            }}
                          >
                            <Trash2 size={13} color={C.red} />
                          </button>
                        </div>
                      </div>

                      {/* Placeholder items preview */}
                      <div style={{ marginTop: 10, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 5 }}>
                        {Array.from({ length: Math.min(section.itemCount, 3) }, (_, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              gap: 8,
                              fontSize: 14,
                              color: C.muted,
                              fontFamily: "var(--font-source-serif), Georgia, serif",
                            }}
                          >
                            <span>{String.fromCharCode(97 + i)})</span>
                            <span style={{ flex: 1, borderBottom: `1px dashed ${C.border}`, paddingBottom: 2 }}>
                              {section.instructions ? section.instructions : "________________________________"}
                            </span>
                          </div>
                        ))}
                        {section.itemCount > 3 && (
                          <div style={{ fontSize: 12, color: C.muted, paddingLeft: 18 }}>
                            +{section.itemCount - 3} more items…
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                );
              })}

              {/* Drop zone at end */}
              <div
                style={{
                  height: dropTargetIndex === (templateDraft.structure.length) ? 56 : 48,
                  borderRadius: 10,
                  border: `2px dashed ${dropTargetIndex === templateDraft.structure.length ? C.blue : C.borderStrong}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  background:
                    dropTargetIndex === templateDraft.structure.length ? C.blue50 : "transparent",
                  transition: "all 150ms ease",
                  fontFamily: "var(--font-inter), system-ui, sans-serif",
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  onDropTargetChange(templateDraft.structure.length);
                }}
                onDrop={(e) => onBuilderDrop(e, templateDraft.structure.length)}
                onDragLeave={() => onDropTargetChange(null)}
              >
                <span style={{ fontSize: 13.5, fontWeight: 600, color: C.muted }}>
                  Drag a question block here to add at the end
                </span>
              </div>

              <div
                style={{
                  marginTop: 12,
                  textAlign: "center",
                  fontFamily: "var(--font-source-serif), Georgia, serif",
                  fontSize: 14,
                  color: C.muted,
                }}
              >
                — End of Paper —
              </div>
            </div>
          </article>
        )}

        {/* ---- REVIEW MODE: Generated Questions ---- */}
        {canvasMode === "review" && activeReviewPaper && (
          <div style={{ width: "100%", maxWidth: 720 }}>
            {/* Quality report */}
            {activeReviewPaper.qualityReport?.issues && activeReviewPaper.qualityReport.issues.length > 0 && (
              <div
                style={{
                  marginBottom: 16,
                  padding: "12px 16px",
                  background: C.orange50,
                  border: `1px solid ${C.orange}`,
                  borderRadius: 10,
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.orange, marginBottom: 6 }}>
                  Quality Issues
                </div>
                {activeReviewPaper.qualityReport.issues.slice(0, 4).map((issue, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 12.5,
                      color: issue.severity === "error" ? C.red : "#92400E",
                      marginBottom: 3,
                    }}
                  >
                    {issue.severity === "error" ? "✕ " : "⚠ "}
                    {issue.message}
                  </div>
                ))}
              </div>
            )}

            {/* Question editing cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {activeReviewPaper.questions.map((question) => {
                const draft = paperDrafts[question.id] ?? {
                  prompt: question.prompt,
                  answerText: question.answerText ?? "",
                };
                return (
                  <div
                    key={question.id}
                    style={{
                      background: C.panel,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: "16px",
                      boxShadow: "0 1px 3px rgba(15,25,50,0.04)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
                        {question.sectionTitle}
                        {question.subLabel ? ` · ${question.subLabel}` : ""}
                      </div>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: C.muted,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: C.bg,
                          border: `1px solid ${C.border}`,
                        }}
                      >
                        {question.marks} mark{question.marks === 1 ? "" : "s"}
                      </span>
                    </div>
                    <label
                      style={{
                        display: "block",
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: C.muted,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                      }}
                    >
                      Question (student-facing)
                      <textarea
                        className="field bangla"
                        value={draft.prompt}
                        onChange={(e) => onPaperDraftChange(question.id, "prompt", e.target.value)}
                        style={{ marginTop: 4, minHeight: 80, resize: "vertical" }}
                      />
                    </label>
                    <label
                      style={{
                        display: "block",
                        marginTop: 10,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: C.muted,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                      }}
                    >
                      Answer / expected response (teacher only)
                      <textarea
                        className="field bangla"
                        value={draft.answerText}
                        onChange={(e) => onPaperDraftChange(question.id, "answerText", e.target.value)}
                        style={{ marginTop: 4, minHeight: 60, resize: "vertical" }}
                      />
                    </label>
                    {question.sourceExcerpt && (
                      <p
                        style={{
                          marginTop: 8,
                          fontSize: 11.5,
                          color: C.muted2,
                          borderTop: `1px solid ${C.border}`,
                          paddingTop: 8,
                        }}
                      >
                        Source: {question.sourceExcerpt}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No template / no book fallback */}
        {canvasMode === "build" && !templateDraft && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              color: C.muted,
              textAlign: "center",
              maxWidth: 400,
            }}
          >
            <ScanText size={48} color={C.borderStrong} strokeWidth={1.2} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.ink2, marginBottom: 6 }}>
                No template found
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.7 }}>
                Select a book and exam type — the matching template will load here automatically.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ====================== QUESTION BANK PANEL ======================
function QuestionBankPanel({
  canvasMode,
  onCanvasModeChange,
  busyMessage,
  builderMarksReady,
  builderRemainingMarks,
  builderUsedMarks,
  templateDraft,
  activeBook,
  allowReuse,
  onAllowReuseChange,
  onGeneratePaper,
  recentPapers,
  selectedReviewPaperId,
  onSelectPaper,
  activeReviewPaper,
  onSavePaperDraft,
  onApprovePaper,
  onPaletteDragStart,
  onAddBlock,
}: {
  canvasMode: CanvasMode;
  onCanvasModeChange: (m: CanvasMode) => void;
  busyMessage: string | null;
  builderMarksReady: boolean;
  builderRemainingMarks: number;
  builderUsedMarks: number;
  templateDraft: TemplateDraft | null;
  activeBook: DashboardData["books"][number] | undefined;
  allowReuse: boolean;
  onAllowReuseChange: (v: boolean) => void;
  onGeneratePaper: () => void;
  recentPapers: DashboardData["papers"];
  selectedReviewPaperId: string;
  onSelectPaper: (id: string) => void;
  activeReviewPaper: GeneratedPaperData | undefined;
  onSavePaperDraft: () => void;
  onApprovePaper: () => void;
  onPaletteDragStart: (e: DragEvent<HTMLButtonElement>, type: QuestionTypeValue) => void;
  onAddBlock: (type: QuestionTypeValue) => void;
}) {
  const [activeTab, setActiveTab] = useState<QuestionTypeValue | "ALL">("ALL");

  const filteredBlocks =
    activeTab === "ALL" ? QUESTION_BLOCKS : QUESTION_BLOCKS.filter((b) => b.type === activeTab);

  return (
    <aside
      style={{
        width: 380,
        flexShrink: 0,
        background: C.panel,
        borderLeft: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "20px 18px 8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 17,
            fontWeight: 700,
            color: C.ink,
            letterSpacing: "-0.01em",
          }}
        >
          <List size={16} color={C.blue} strokeWidth={1.9} />
          <span>Question Blocks</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 12.5, color: C.muted }}>
          Click to add, or drag into the paper preview
        </div>
      </div>

      {/* Marks balance hint */}
      {templateDraft && (
        <div
          style={{
            margin: "8px 18px",
            padding: "10px 12px",
            background: builderMarksReady ? C.green50 : C.blue50,
            border: `1px solid ${builderMarksReady ? C.green : C.blue100}`,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: builderMarksReady ? C.green : C.blue }}>
              {builderMarksReady
                ? "Marks balanced ✓"
                : builderRemainingMarks > 0
                  ? `${builderRemainingMarks} marks remaining`
                  : `${Math.abs(builderRemainingMarks)} marks over budget`}
            </span>
          </div>
          <span
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: builderMarksReady ? C.green : C.blue,
            }}
          >
            {builderUsedMarks} / {templateDraft.totalMarks}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          padding: "0 18px 10px",
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        {[{ key: "ALL" as const, label: "All" }, ...QUESTION_BLOCKS.map((b) => ({ key: b.type, label: b.label }))].map(
          ({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                height: 26,
                padding: "0 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                border: `1px solid ${C.border}`,
                background: activeTab === key ? C.blue : "transparent",
                color: activeTab === key ? "#FFFFFF" : C.ink2,
                cursor: "pointer",
              }}
            >
              {key === "ALL" ? label : QUESTION_BLOCKS.find((b) => b.type === key)?.label ?? label}
            </button>
          ),
        )}
      </div>

      {/* Question block cards */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 18px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {filteredBlocks.map((block) => (
          <button
            key={block.type}
            draggable
            onDragStart={(e) => onPaletteDragStart(e, block.type)}
            onClick={() => onAddBlock(block.type)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "12px 12px 12px 10px",
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${block.color}`,
              borderRadius: 10,
              boxShadow: "0 1px 2px rgba(15,25,50,0.03)",
              cursor: "grab",
              textAlign: "left",
              transition: "box-shadow 120ms, transform 120ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 12px rgba(15,25,50,0.08)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 2px rgba(15,25,50,0.03)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            }}
          >
            <span style={{ display: "inline-grid", placeItems: "center", paddingTop: 2, flexShrink: 0 }}>
              <GripVertical size={15} color={C.borderStrong} strokeWidth={1.6} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: C.ink2, fontWeight: 600 }} className="bangla">
                {block.label}
              </div>
              <div style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, fontStyle: "italic" }}>
                {block.subtitle}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }} className="bangla">
                {block.explanation}
              </div>
            </div>
            <span
              style={{
                flexShrink: 0,
                fontSize: 11.5,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 999,
                background: block.bg,
                color: block.color,
                whiteSpace: "nowrap",
              }}
            >
              + Add
            </span>
          </button>
        ))}
      </div>

      {/* Generate / Review actions */}
      <div
        style={{
          borderTop: `1px solid ${C.border}`,
          padding: "14px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Reuse option */}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            cursor: "pointer",
            fontSize: 12.5,
            color: C.muted,
            lineHeight: 1.5,
          }}
        >
          <input
            type="checkbox"
            checked={allowReuse}
            onChange={(e) => onAllowReuseChange(e.target.checked)}
            style={{ marginTop: 2, accentColor: C.blue, flexShrink: 0 }}
          />
          Allow reuse of questions from previous papers
        </label>

        {/* Generate button */}
        <button
          className="btn-primary"
          style={{ width: "100%", height: 44, fontSize: 14, fontWeight: 700, gap: 10 }}
          onClick={onGeneratePaper}
          disabled={
            Boolean(busyMessage) ||
            !activeBook ||
            activeBook.importStatus === "FAILED" ||
            activeBook.importStatus === "INDEXING" ||
            !builderMarksReady
          }
        >
          <Sparkles size={18} strokeWidth={1.8} />
          Generate Paper
        </button>

        {/* Recent papers */}
        {recentPapers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Recent Papers
            </div>
            {recentPapers.slice(0, 4).map((paper) => {
              const isSelected = paper.id === selectedReviewPaperId;
              return (
                <button
                  key={paper.id}
                  onClick={() => {
                    onSelectPaper(paper.id);
                    onCanvasModeChange("review");
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${isSelected ? C.blue : C.border}`,
                    background: isSelected ? C.blue50 : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: isSelected ? C.blue : C.ink2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatExamLabel(paper.examType)}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                      {formatAppDate(paper.createdAt)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <PaperStatusPill status={paper.reviewStatus} />
                    {paper.reviewStatus === "APPROVED" && (
                      <a
                        href={`/api/papers/${paper.id}/download`}
                        onClick={(e) => e.stopPropagation()}
                        title="Download DOCX"
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: C.green50,
                          color: C.green,
                          textDecoration: "none",
                        }}
                      >
                        <Download size={13} strokeWidth={2} />
                      </a>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Review actions (shown when in review mode) */}
        {canvasMode === "review" && activeReviewPaper && (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              className="btn-secondary"
              style={{ flex: 1, fontSize: 13, gap: 6 }}
              onClick={onSavePaperDraft}
              disabled={Boolean(busyMessage)}
            >
              <Save size={14} strokeWidth={1.8} />
              Save Draft
            </button>
            <button
              className="btn-primary"
              style={{ flex: 1, fontSize: 13, gap: 6 }}
              onClick={onApprovePaper}
              disabled={Boolean(busyMessage)}
            >
              <Download size={14} strokeWidth={2} />
              Approve
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

// ====================== LIBRARY VIEW ======================
function LibraryView({
  books,
  activeBook,
  onBookChange,
  onImportSample,
  onUpload,
  onReindex,
  busyMessage,
  settings,
  chapterDrafts,
  onChapterDraftChange,
  onSaveChapter,
}: {
  books: DashboardData["books"];
  activeBook: DashboardData["books"][number] | undefined;
  onBookChange: (id: string) => void;
  onImportSample: () => void;
  onUpload: (formData: FormData) => void;
  onReindex: () => void;
  busyMessage: string | null;
  settings: DashboardData["settings"];
  chapterDrafts: Record<string, { title: string; text: string }>;
  onChapterDraftChange: (
    chapterId: string,
    field: "title" | "text",
    value: string,
  ) => void;
  onSaveChapter: (chapterId: string) => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: 32,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 1100,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Import a book */}
        <section
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 1px 3px rgba(15,25,50,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Upload size={18} color={C.blue} strokeWidth={1.8} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.ink }}>
              Import a Book
            </h2>
          </div>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, margin: "0 0 16px" }}>
            Upload a Bangla textbook PDF. OCR will extract chapter text for exam generation.
          </p>

          <form
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
            action={async (fd) => { await onUpload(fd); }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                  Book Title
                </div>
                <input
                  className="field"
                  name="title"
                  defaultValue="Bangla Literature"
                  placeholder="e.g. Class 3 Bangla"
                />
              </label>
              <label>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                  Class
                </div>
                <select className="field" name="classLevel" defaultValue="Three">
                  {CLASS_LEVELS.map((cl) => (
                    <option key={cl} value={cl}>{cl}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                Subject
              </div>
              <input className="field" name="subject" defaultValue={settings.defaultSubject} />
            </label>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                Textbook PDF
              </div>
              <input className="field" type="file" name="pdf" accept=".pdf" required />
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn-primary"
                type="submit"
                disabled={Boolean(busyMessage)}
                style={{ gap: 8 }}
              >
                <Upload size={15} strokeWidth={1.8} />
                Upload & Index
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={onImportSample}
                disabled={Boolean(busyMessage)}
                style={{ gap: 8 }}
              >
                <BookOpen size={15} strokeWidth={1.8} />
                Use Sample Book
              </button>
            </div>
          </form>
        </section>

        {/* Book list */}
        <section
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 1px 3px rgba(15,25,50,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <BookOpen size={18} color={C.orange} strokeWidth={1.8} />
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.ink }}>Library</h2>
            </div>
            {activeBook && (
              <button
                className="btn-secondary"
                onClick={onReindex}
                disabled={Boolean(busyMessage)}
                style={{ gap: 6, fontSize: 12 }}
              >
                <RefreshCcw size={13} />
                Re-index
              </button>
            )}
          </div>

          {books.length === 0 ? (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                border: `2px dashed ${C.border}`,
                borderRadius: 10,
                color: C.muted,
                fontSize: 13.5,
              }}
            >
              No books yet. Import the sample book or upload a PDF.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {books.map((book) => {
                const isActive = book.id === activeBook?.id;
                return (
                  <button
                    key={book.id}
                    onClick={() => onBookChange(book.id)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: `1px solid ${isActive ? C.blue : C.border}`,
                      background: isActive ? C.blue50 : "transparent",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 120ms ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: isActive ? C.blue : C.ink }}>
                          {book.title}
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                          Class {book.classLevel} • {book.subject}
                        </div>
                      </div>
                      <StatusPill status={book.importStatus} />
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {[
                        `${book.pageCount} pages`,
                        `${book.chapters.length} chapters`,
                        ...(book.extractionMethod ? [book.extractionMethod] : []),
                      ].map((label) => (
                        <span
                          key={label}
                          style={{
                            fontSize: 11.5,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: C.bg,
                            border: `1px solid ${C.border}`,
                            color: C.muted,
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Chapter editor */}
      {activeBook && activeBook.chapters.length > 0 && (
        <section
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 1px 3px rgba(15,25,50,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Save size={18} color={C.orange} strokeWidth={1.8} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.ink }}>
              Review & Edit Chapters
            </h2>
          </div>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, margin: "0 0 16px" }}>
            OCR and chapter splitting are rarely perfect. Correct titles or text before generating.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {activeBook.chapters.map((chapter) => {
              const draft = chapterDrafts[chapter.id] ?? {
                title: chapter.title,
                text: chapter.text,
              };
              return (
                <details
                  key={chapter.id}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: "12px 16px",
                    background: "#FAFBFD",
                  }}
                >
                  <summary style={{ cursor: "pointer", listStyle: "none" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>
                          {draft.title}
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                          pp. {chapter.startPage ?? "?"} – {chapter.endPage ?? "?"} · Quality{" "}
                          {chapter.quality.score}/100
                        </div>
                        {chapter.quality.issues[0] && (
                          <div style={{ fontSize: 12, color: C.orange, marginTop: 2 }}>
                            ⚠ {chapter.quality.issues[0].message}
                          </div>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: C.blue,
                          padding: "2px 10px",
                          borderRadius: 999,
                          background: C.blue50,
                          flexShrink: 0,
                        }}
                      >
                        Edit
                      </span>
                    </div>
                  </summary>

                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                    <label>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                        Chapter Title
                      </div>
                      <input
                        className="field"
                        value={draft.title}
                        onChange={(e) => onChapterDraftChange(chapter.id, "title", e.target.value)}
                      />
                    </label>
                    <label>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                        Chapter Text
                      </div>
                      <textarea
                        className="field bangla"
                        value={draft.text}
                        onChange={(e) => onChapterDraftChange(chapter.id, "text", e.target.value)}
                        style={{ minHeight: 200, resize: "vertical" }}
                      />
                    </label>
                    <div>
                      <button
                        className="btn-primary"
                        onClick={() => onSaveChapter(chapter.id)}
                        disabled={Boolean(busyMessage)}
                        style={{ gap: 8 }}
                      >
                        <Save size={14} />
                        Save Chapter
                      </button>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ====================== SETTINGS VIEW ======================
function SettingsView({
  templates,
  activeBook,
  selectedExamType,
  templateDraft,
  onTemplateDraftChange,
  onSaveTemplate,
  busyMessage,
  builderMarksReady,
}: {
  templates: DashboardData["templates"];
  activeBook: DashboardData["books"][number] | undefined;
  selectedExamType: ExamTypeValue;
  templateDraft: TemplateDraft | null;
  onTemplateDraftChange: (updater: (d: TemplateDraft) => TemplateDraft) => void;
  onSaveTemplate: () => void;
  busyMessage: string | null;
  builderMarksReady: boolean;
}) {
  const matchingTemplate = templates.find(
    (t) =>
      t.classLevel === (activeBook?.classLevel ?? "Three") &&
      t.examType === selectedExamType,
  );

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: 32,
        maxWidth: 900,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Settings size={18} color={C.blue} strokeWidth={1.8} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.ink }}>
            Exam Templates
          </h1>
        </div>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
          Each class level and exam type has its own question structure. The paper builder uses these templates.
        </p>
      </div>

      {matchingTemplate && templateDraft ? (
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 24,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 16 }}>
            {matchingTemplate.displayName ?? `${matchingTemplate.classLevel} — ${formatExamLabel(selectedExamType)}`}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                Total Marks
              </div>
              <input
                className="field"
                type="number"
                min={1}
                value={templateDraft.totalMarks}
                onChange={(e) =>
                  onTemplateDraftChange((d) => ({
                    ...d,
                    totalMarks: Number(e.target.value) || d.totalMarks,
                  }))
                }
              />
            </label>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                Duration (minutes)
              </div>
              <input
                className="field"
                type="number"
                min={1}
                value={templateDraft.durationMinutes}
                onChange={(e) =>
                  onTemplateDraftChange((d) => ({
                    ...d,
                    durationMinutes: Number(e.target.value) || d.durationMinutes,
                  }))
                }
              />
            </label>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                Paper Instructions
              </div>
              <input
                className="field"
                value={templateDraft.instructions}
                onChange={(e) =>
                  onTemplateDraftChange((d) => ({
                    ...d,
                    instructions: e.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 8 }}>
              Question Structure ({templateDraft.structure.length} sections)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {templateDraft.structure.map((section, i) => {
                const block = getQuestionBlock(section.type);
                return (
                  <div
                    key={section.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: block.bg,
                        color: block.color,
                        fontSize: 11.5,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {block.label}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: C.ink2 }}>{section.title}</span>
                    <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>
                      {getSectionMarkSummary(section)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              className="btn-primary"
              onClick={onSaveTemplate}
              disabled={Boolean(busyMessage) || !builderMarksReady}
              style={{ gap: 8 }}
            >
              <Save size={14} />
              Save Template
            </button>
            {!builderMarksReady && (
              <span style={{ fontSize: 12.5, color: C.orange }}>
                Balance the marks before saving.
              </span>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            border: `2px dashed ${C.border}`,
            borderRadius: 12,
            color: C.muted,
            fontSize: 14,
          }}
        >
          Select a book and exam type in the Paper view to edit the matching template.
        </div>
      )}

      {/* Template overview */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, marginBottom: 12 }}>
          All templates ({templates.length})
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: C.panel,
                border: `1px solid ${tpl.id === matchingTemplate?.id ? C.blue : C.border}`,
                fontSize: 12.5,
              }}
            >
              <div style={{ fontWeight: 600, color: C.ink }}>
                {tpl.classLevel} · {formatExamLabel(tpl.examType)}
              </div>
              <div style={{ color: C.muted, marginTop: 2 }}>
                {tpl.totalMarks} marks · {tpl.durationMinutes} min · {tpl.structure.length} sections
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ====================== MAIN COMPONENT ======================
export function DashboardClient({ initialData }: { initialData: DashboardData }) {
  const router = useRouter();

  // Rail / view state
  const [activeView, setActiveView] = useState<RailView>("paper");
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("build");

  // Book/paper selection
  const [selectedBookId, setSelectedBookId] = useState(getPreferredBookId(initialData.books));
  const [selectedExamType, setSelectedExamType] = useState<ExamTypeValue>("CT1");
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [allowReuse, setAllowReuse] = useState(false);
  const [selectedReviewPaperId, setSelectedReviewPaperId] = useState(
    initialData.papers.find((p) => p.reviewStatus === "DRAFT")?.id ??
      initialData.papers[0]?.id ??
      "",
  );

  // Async state
  const [notice, setNotice] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Draft state
  const [chapterDrafts, setChapterDrafts] = useState<
    Record<string, { title: string; text: string }>
  >({});
  const [paperDrafts, setPaperDrafts] = useState<
    Record<string, { prompt: string; answerText: string }>
  >({});
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, TemplateDraft>>({});
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const deferredBooks = useDeferredValue(initialData.books);

  // Derived: active book
  const resolvedSelectedBookId = deferredBooks.some((b) => b.id === selectedBookId)
    ? selectedBookId
    : getPreferredBookId(deferredBooks);

  const activeBook = useMemo(
    () =>
      deferredBooks.find((b) => b.id === resolvedSelectedBookId) ??
      deferredBooks.find((b) => b.importStatus === "INDEXED") ??
      deferredBooks[0],
    [deferredBooks, resolvedSelectedBookId],
  );

  // Derived: matching template
  const matchingTemplate = useMemo(
    () =>
      initialData.templates.find(
        (t) =>
          t.classLevel === (activeBook?.classLevel ?? "Three") &&
          t.examType === selectedExamType,
      ),
    [activeBook?.classLevel, initialData.templates, selectedExamType],
  );

  // Derived: effective chapter IDs
  const effectiveSelectedChapterIds = useMemo(() => {
    if (!activeBook) return [];
    const validIds = new Set(activeBook.chapters.map((ch) => ch.id));
    const filtered = selectedChapterIds.filter((id) => validIds.has(id));
    return filtered.length > 0 ? filtered : activeBook.chapters.map((ch) => ch.id);
  }, [activeBook, selectedChapterIds]);

  // Derived: recent papers
  const recentPapers = useMemo(
    () =>
      initialData.papers.filter((p) => !activeBook || p.bookId === activeBook.id),
    [activeBook, initialData.papers],
  );

  // Derived: active review paper
  const activeReviewPaper = useMemo(
    () => recentPapers.find((p) => p.id === selectedReviewPaperId) ?? recentPapers[0],
    [recentPapers, selectedReviewPaperId],
  );

  // Derived: template draft
  const templateDraft = matchingTemplate
    ? templateDrafts[matchingTemplate.id] ?? {
        totalMarks: matchingTemplate.totalMarks,
        durationMinutes: matchingTemplate.durationMinutes,
        instructions: matchingTemplate.instructions ?? "",
        structure: matchingTemplate.structure,
      }
    : null;

  const builderUsedMarks = templateDraft ? getStructureTotal(templateDraft.structure) : 0;
  const builderRemainingMarks = templateDraft ? templateDraft.totalMarks - builderUsedMarks : 0;
  const builderMarksReady = Math.abs(builderRemainingMarks) < 0.001;

  // Derived: marks by type (for summary)
  const marksByType = useMemo(() => {
    if (!templateDraft) return {} as Record<string, number>;
    const result: Record<string, number> = {};
    for (const section of templateDraft.structure) {
      const key = section.type;
      result[key] = (result[key] ?? 0) + getSectionTotal(section);
    }
    return result;
  }, [templateDraft]);

  // ---- Helpers ----
  function refreshView() {
    startTransition(() => { router.refresh(); });
  }

  function updateTemplateDraft(updater: (draft: TemplateDraft) => TemplateDraft) {
    if (!matchingTemplate) return;
    setTemplateDrafts((cur) => {
      const base = cur[matchingTemplate.id] ?? {
        totalMarks: matchingTemplate.totalMarks,
        durationMinutes: matchingTemplate.durationMinutes,
        instructions: matchingTemplate.instructions ?? "",
        structure: matchingTemplate.structure,
      };
      return { ...cur, [matchingTemplate.id]: updater(base) };
    });
  }

  function updateTemplateSection(
    idx: number,
    updater: (s: SectionBlueprint) => SectionBlueprint,
  ) {
    updateTemplateDraft((d) => ({
      ...d,
      structure: d.structure.map((s, i) => (i === idx ? updater(s) : s)),
    }));
  }

  function addBuilderBlock(type: QuestionTypeValue, insertIndex?: number) {
    const block = getQuestionBlock(type);
    updateTemplateDraft((d) => {
      const next = [...d.structure];
      const idx = insertIndex ?? next.length;
      next.splice(idx, 0, createSectionFromBlock(block, next.length + 1));
      return { ...d, structure: next };
    });
  }

  function duplicateSection(section: SectionBlueprint, idx: number) {
    updateTemplateDraft((d) => {
      const next = [...d.structure];
      next.splice(idx + 1, 0, {
        ...section,
        id: makeSectionId(section.type, idx + 1),
        title: `${section.title} copy`,
      });
      return { ...d, structure: next };
    });
  }

  function removeSection(idx: number) {
    updateTemplateDraft((d) => ({
      ...d,
      structure: d.structure.filter((_, i) => i !== idx),
    }));
  }

  function moveSection(idx: number, dir: -1 | 1) {
    updateTemplateDraft((d) => {
      const to = idx + dir;
      if (to < 0 || to >= d.structure.length) return d;
      return { ...d, structure: reorderSections(d.structure, idx, to) };
    });
  }

  function handlePaletteDragStart(e: DragEvent<HTMLButtonElement>, type: QuestionTypeValue) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(PALETTE_TRANSFER_TYPE, type);
  }

  function handleSectionDragStart(e: DragEvent<HTMLDivElement>, sectionId: string) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(SECTION_TRANSFER_TYPE, sectionId);
  }

  function handleBuilderDrop(e: DragEvent<HTMLDivElement>, dropIndex: number) {
    e.preventDefault();
    setDropTargetIndex(null);

    const blockType = e.dataTransfer.getData(PALETTE_TRANSFER_TYPE) as QuestionTypeValue | "";
    if (blockType) { addBuilderBlock(blockType, dropIndex); return; }

    const sectionId = e.dataTransfer.getData(SECTION_TRANSFER_TYPE);
    if (!sectionId || !templateDraft) return;

    const fromIndex = templateDraft.structure.findIndex((s) => s.id === sectionId);
    if (fromIndex < 0 || fromIndex === dropIndex) return;

    updateTemplateDraft((d) => ({
      ...d,
      structure: reorderSections(
        d.structure,
        fromIndex,
        fromIndex < dropIndex ? dropIndex - 1 : dropIndex,
      ),
    }));
  }

  async function persistTemplateDraft() {
    if (!matchingTemplate || !templateDraft) throw new Error("No template selected.");
    const res = await fetch(`/api/templates/${matchingTemplate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(templateDraft),
    });
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(payload.error ?? "Could not save the template.");
  }

  async function saveTemplateDraft() {
    if (!matchingTemplate || !templateDraft) return;
    setBusyMessage("Saving the exam template.");
    setNotice(null);
    try {
      await persistTemplateDraft();
      setNotice("Template saved.");
      refreshView();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save template.");
    } finally {
      setBusyMessage(null);
    }
  }

  function getPaperQuestionDraft(q: GeneratedPaperData["questions"][number]) {
    return paperDrafts[q.id] ?? { prompt: q.prompt, answerText: q.answerText ?? "" };
  }

  async function savePaperReview(reviewStatus: "DRAFT" | "APPROVED") {
    if (!activeReviewPaper) return;
    setBusyMessage(
      reviewStatus === "APPROVED"
        ? "Running quality checks and approving paper."
        : "Saving paper edits.",
    );
    setNotice(null);
    try {
      const res = await fetch(`/api/papers/${activeReviewPaper.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewStatus,
          questions: activeReviewPaper.questions.map((q) => {
            const draft = getPaperQuestionDraft(q);
            return { id: q.id, prompt: draft.prompt, answerText: draft.answerText.trim() || null };
          }),
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        downloadUrl?: string | null;
        qualityReport?: PaperQualityReport;
      };
      if (!res.ok) throw new Error(payload.error ?? "Could not save the paper.");
      setNotice(
        reviewStatus === "APPROVED"
          ? "Paper approved. DOCX download starting."
          : "Draft saved.",
      );
      if (payload.downloadUrl) window.location.href = payload.downloadUrl;
      refreshView();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save paper.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function importSampleBook() {
    setBusyMessage("Importing sample book with Bangla OCR…");
    setNotice(null);
    try {
      const res = await fetch("/api/books/sample", { method: "POST" });
      const payload = (await res.json()) as { error?: string; book?: { id: string } };
      if (!res.ok) throw new Error(payload.error ?? "Sample import failed.");
      if (payload.book?.id) setSelectedBookId(payload.book.id);
      setNotice("Sample book imported.");
      refreshView();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sample import failed.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function handleUpload(formData: FormData) {
    setBusyMessage("Uploading and indexing with Bangla OCR…");
    setNotice(null);
    try {
      const res = await fetch("/api/books", { method: "POST", body: formData });
      const payload = (await res.json()) as { error?: string; book?: { id: string } };
      if (!res.ok) throw new Error(payload.error ?? "Upload failed.");
      if (payload.book?.id) setSelectedBookId(payload.book.id);
      setNotice("Book uploaded and indexed.");
      refreshView();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function saveChapter(chapterId: string) {
    const baseChapter = activeBook?.chapters.find((ch) => ch.id === chapterId);
    const draft = chapterDrafts[chapterId] ?? {
      title: baseChapter?.title ?? "",
      text: baseChapter?.text ?? "",
    };
    if (!draft.title || !draft.text) return;
    setBusyMessage("Saving chapter edits.");
    setNotice(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Could not save chapter.");
      setNotice("Chapter saved.");
      refreshView();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save chapter.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function reindexCurrentBook() {
    if (!activeBook) return;
    setBusyMessage("Re-indexing with Bangla OCR…");
    setNotice(null);
    try {
      const res = await fetch(`/api/books/${activeBook.id}/reindex`, { method: "POST" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Re-index failed.");
      setNotice("Book re-indexed.");
      refreshView();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Re-index failed.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function generatePaper() {
    if (!activeBook || effectiveSelectedChapterIds.length === 0) {
      setNotice("Select at least one indexed chapter.");
      return;
    }
    if (activeBook.importStatus === "FAILED" || activeBook.importStatus === "INDEXING") {
      setNotice("Finish or fix book indexing first.");
      return;
    }
    if (templateDraft && !builderMarksReady) {
      setNotice(
        builderRemainingMarks > 0
          ? `${builderRemainingMarks} marks still needed.`
          : `${Math.abs(builderRemainingMarks)} marks over budget.`,
      );
      return;
    }
    setBusyMessage("Generating question paper…");
    setNotice(null);
    try {
      if (matchingTemplate && templateDraft) await persistTemplateDraft();
      const res = await fetch("/api/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: activeBook.id,
          chapterIds: effectiveSelectedChapterIds,
          examType: selectedExamType,
          allowReuse,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        paperId?: string;
        qualityReport?: PaperQualityReport;
      };
      if (!res.ok) throw new Error(payload.error ?? "Paper generation failed.");
      if (payload.paperId) {
        setSelectedReviewPaperId(payload.paperId);
        setCanvasMode("review");
      }
      setNotice("Draft generated. Review and approve before downloading.");
      refreshView();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Paper generation failed.");
    } finally {
      setBusyMessage(null);
    }
  }

  // ---- Render ----
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        fontFamily: "var(--font-inter), -apple-system, system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      <TopNav
        activeBook={activeBook}
        activeReviewPaper={activeReviewPaper}
        canvasMode={canvasMode}
        busyMessage={busyMessage}
        notice={notice}
        isPending={isPending}
        onSaveDraft={
          canvasMode === "review" && activeReviewPaper
            ? () => savePaperReview("DRAFT")
            : saveTemplateDraft
        }
        onExportDocx={
          canvasMode === "review" && activeReviewPaper
            ? () => savePaperReview("APPROVED")
            : generatePaper
        }
      />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <LeftRail active={activeView} onChange={setActiveView} />

        {activeView === "paper" && (
          <>
            <ExamSetupPanel
              books={deferredBooks}
              activeBook={activeBook}
              onBookChange={setSelectedBookId}
              examType={selectedExamType}
              onExamTypeChange={setSelectedExamType}
              selectedChapterIds={effectiveSelectedChapterIds}
              onChapterToggle={(id, checked) =>
                setSelectedChapterIds((cur) =>
                  checked ? [...cur, id] : cur.filter((x) => x !== id),
                )
              }
              templateDraft={templateDraft}
              onTemplateDraftChange={updateTemplateDraft}
              marksByType={marksByType}
              totalUsed={builderUsedMarks}
            />

            <PaperCanvas
              canvasMode={canvasMode}
              onCanvasModeChange={setCanvasMode}
              activeBook={activeBook}
              selectedExamType={selectedExamType}
              templateDraft={templateDraft}
              activeReviewPaper={activeReviewPaper}
              paperDrafts={paperDrafts}
              onPaperDraftChange={(qId, field, val) =>
                setPaperDrafts((cur) => {
                  const existing = cur[qId] ??
                    (activeReviewPaper?.questions.find((q) => q.id === qId)
                      ? { prompt: activeReviewPaper!.questions.find((q) => q.id === qId)!.prompt, answerText: activeReviewPaper!.questions.find((q) => q.id === qId)!.answerText ?? "" }
                      : { prompt: "", answerText: "" });
                  return { ...cur, [qId]: { ...existing, [field]: val } };
                })
              }
              dropTargetIndex={dropTargetIndex}
              onDropTargetChange={setDropTargetIndex}
              onBuilderDrop={handleBuilderDrop}
              onSectionDragStart={handleSectionDragStart}
              onSectionUpdate={updateTemplateSection}
              onSectionMove={moveSection}
              onSectionDuplicate={duplicateSection}
              onSectionRemove={removeSection}
              settings={initialData.settings}
            />

            <QuestionBankPanel
              canvasMode={canvasMode}
              onCanvasModeChange={setCanvasMode}
              busyMessage={busyMessage}
              builderMarksReady={builderMarksReady}
              builderRemainingMarks={builderRemainingMarks}
              builderUsedMarks={builderUsedMarks}
              templateDraft={templateDraft}
              activeBook={activeBook}
              allowReuse={allowReuse}
              onAllowReuseChange={setAllowReuse}
              onGeneratePaper={generatePaper}
              recentPapers={recentPapers}
              selectedReviewPaperId={selectedReviewPaperId}
              onSelectPaper={setSelectedReviewPaperId}
              activeReviewPaper={activeReviewPaper}
              onSavePaperDraft={() => savePaperReview("DRAFT")}
              onApprovePaper={() => savePaperReview("APPROVED")}
              onPaletteDragStart={handlePaletteDragStart}
              onAddBlock={addBuilderBlock}
            />
          </>
        )}

        {activeView === "library" && (
          <LibraryView
            books={deferredBooks}
            activeBook={activeBook}
            onBookChange={setSelectedBookId}
            onImportSample={importSampleBook}
            onUpload={handleUpload}
            onReindex={reindexCurrentBook}
            busyMessage={busyMessage}
            settings={initialData.settings}
            chapterDrafts={chapterDrafts}
            onChapterDraftChange={(chapterId, field, value) =>
              setChapterDrafts((cur) => {
                const base = cur[chapterId] ?? {
                  title: activeBook?.chapters.find((ch) => ch.id === chapterId)?.title ?? "",
                  text: activeBook?.chapters.find((ch) => ch.id === chapterId)?.text ?? "",
                };
                return { ...cur, [chapterId]: { ...base, [field]: value } };
              })
            }
            onSaveChapter={saveChapter}
          />
        )}

        {activeView === "settings" && (
          <SettingsView
            templates={initialData.templates}
            activeBook={activeBook}
            selectedExamType={selectedExamType}
            templateDraft={templateDraft}
            onTemplateDraftChange={updateTemplateDraft}
            onSaveTemplate={saveTemplateDraft}
            busyMessage={busyMessage}
            builderMarksReady={builderMarksReady}
          />
        )}
      </div>
    </div>
  );
}
