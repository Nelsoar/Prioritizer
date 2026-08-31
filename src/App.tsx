// src/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  DropResult,
} from "@hello-pangea/dnd";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import {
  Plus,
  Trash2,
  Search as SearchIcon,
  Upload,
  Download,
  Settings,
  X,
  AlertTriangle,
  CheckSquare,
  Square,
  Calendar,
  Briefcase,
  Home,
  Archive,
  LogOut,
  LogIn,
  Printer,
  HelpCircle,
  GripVertical,
  RotateCcw,
} from "lucide-react";
import { useAuth, useProfilePicker } from "./auth/AuthProvider";
import { Celebration } from "./components/Celebration";

/* =======================
   Types
======================= */
type Status = "now" | "next" | "later";
type Theme = "light" | "dark" | "ocean" | "forest" | "rainbow";
type BoardKind = "work" | "life";
type Section = "today" | "work" | "life";

type Subtask = {
  id: string;
  title: string;
  completed: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
};
type Deliverable = {
  id: string;
  label: string;
  url: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
};
type Task = {
  id: string;
  title: string;
  details?: string;
  status: Status;
  impact: number;
  confidence: number;
  ease: number;
  urgency: number;
  completed: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
  children?: Subtask[];
  collapsed?: boolean;
  owner?: string;
  tags?: string[];
  due?: number | null;
  estimateH?: number | null;
  deps?: string[];
  deliverables?: Deliverable[];
  board?: BoardKind;
  archived?: boolean;
  archivedAt?: number;
};
type Weights = { impact: number; confidence: number; ease: number; urgency: number };

type TodayPickMode = "tasks" | "subtasks";
type TodaySlotRef =
  | { kind: "task"; taskId: string }
  | { kind: "subtask"; taskId: string; subtaskId: string };
type TodaySlot = { ref: TodaySlotRef | null; done: boolean };
type TodaySimpleTodo = { id: string; title: string; done: boolean };

type TodayPlan = {
  date: string;
  mainRef: TodaySlotRef | null;
  mainDone: boolean;
  mainHoursLogged: number;
  /** Allow >3 work/life slots + a second deep-work block */
  extraMode: boolean;
  extraMainRef: TodaySlotRef | null;
  extraMainDone: boolean;
  extraMainHoursLogged: number;
  workMode: TodayPickMode;
  lifeMode: TodayPickMode;
  workSlots: TodaySlot[];
  lifeSlots: TodaySlot[];
  simpleTodos: TodaySimpleTodo[];
  inspirationalQuote: string;
  /** @deprecated migrated to workSlots */
  workSlotIds?: (string | null)[];
  /** @deprecated migrated to lifeSlots */
  lifeSlotIds?: (string | null)[];
};

type SortBy = "manual" | "ice" | "urgency" | "iu";
type View = "board" | "matrix" | "scatter" | "graph";
type Mode = "overview" | "edit";

type AppState = {
  tasks: Task[];
  weights: Weights;
  sortBy: SortBy;
  view: View;
  mode: Mode;
  focus: boolean;
  showCompleted: boolean;
  wip: Record<Status, number>;
  thresholds: { imp: number; urg: number };
  theme: Theme;
  search: string;
  section: Section;
  showArchived: boolean;
  today: TodayPlan;
  celebrationsEnabled: boolean;
  celebrationPromptShown: boolean;
  syncTodayCompletion: boolean;
};

/* =======================
   Constants & Helpers
======================= */
const STORAGE_KEY_PREFIX = "task-prioritizer-cloud-state-v1";
const STORAGE_KEY_LEGACY = "task-prioritizer-state-v10";

function storageKeyForUser(userId: string | null | undefined) {
  return `${STORAGE_KEY_PREFIX}-${userId ?? "local"}`;
}

function loadPersistedState(key: string): Partial<AppState> | null {
  let raw = localStorage.getItem(key);
  if (!raw && key.endsWith("-local")) {
    raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}-local`);
    if (!raw) {
      raw = localStorage.getItem(STORAGE_KEY_LEGACY);
      if (raw) {
        try {
          localStorage.setItem(key, raw);
        } catch {}
      }
    }
  }
  return safeParse<Partial<AppState>>(raw);
}

function uid(): string {
  try {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowDateTimeLabel() {
  return new Date().toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Filename-safe stamp: YYYY-MM-DD-HHmmss (unique within a day) */
function exportFileStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

async function downloadElementPdf(node: HTMLElement | null, filename: string) {
  if (!node) {
    alert("Nothing to export yet — try again in a moment.");
    return;
  }
  try {
    const canvas = await html2canvas(node, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
      onclone: (doc, cloned) => {
        const sheet = cloned as HTMLElement;
        if (
          sheet.classList.contains("board-print-sheet") ||
          sheet.classList.contains("today-print-sheet")
        ) {
          sheet.style.position = "relative";
          sheet.style.left = "0";
          sheet.style.top = "0";
          sheet.style.opacity = "1";
          sheet.style.zIndex = "1";
        }
        doc.querySelectorAll(".today-print-only").forEach((el) => {
          (el as HTMLElement).style.display = "block";
        });
        doc.querySelectorAll(".screen-only").forEach((el) => {
          (el as HTMLElement).style.display = "none";
        });
      },
    });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "letter" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let y = 0;
    let remaining = imgHeight;
    while (remaining > 0) {
      pdf.addImage(imgData, "PNG", 0, y, imgWidth, imgHeight);
      remaining -= pageHeight;
      if (remaining > 0) {
        pdf.addPage();
        y -= pageHeight;
      }
    }
    pdf.save(filename);
  } catch (err) {
    console.error("PDF export failed", err);
    alert("Could not create PDF. Try refreshing the page and exporting again.");
  }
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildAppState(persisted: Partial<AppState> | null): AppState {
  const theme = (persisted?.theme as Theme) || "ocean";
  const rawTasks = Array.isArray(persisted?.tasks)
    ? (persisted!.tasks as Task[]).map(normalizeTask)
    : allSeedData().map(normalizeTask);
  return {
    tasks: rawTasks,
    weights: {
      impact: numOr(persisted?.weights?.impact, 1),
      confidence: numOr(persisted?.weights?.confidence, 1),
      ease: numOr(persisted?.weights?.ease, 1),
      urgency: numOr(persisted?.weights?.urgency, 1),
    },
    sortBy: (persisted?.sortBy as SortBy) || "iu",
    view: (persisted?.view as View) || "board",
    mode: (persisted?.mode as Mode) || "edit",
    focus: !!persisted?.focus,
    showCompleted: persisted?.showCompleted ?? true,
    showArchived: persisted?.showArchived ?? false,
    section: (persisted?.section as Section) || "work",
    today: normalizeTodayPlan(persisted?.today),
    wip: (persisted?.wip as any) || { now: 0, next: 0, later: 0 },
    thresholds: persisted?.thresholds || { imp: 0, urg: 0 },
    theme,
    search: "",
    celebrationsEnabled: persisted?.celebrationsEnabled ?? true,
    celebrationPromptShown: persisted?.celebrationPromptShown ?? false,
    syncTodayCompletion: persisted?.syncTodayCompletion ?? true,
  };
}

const DEFAULT_TASK_SCORE = 3;
const DEFAULT_INSPIRATIONAL_QUOTE =
  '"Joy is what happens to us when we allow ourselves to recognize how good things really are." — Marianne Williamson';

const hasDefaultScores = (t: Task) =>
  t.impact === DEFAULT_TASK_SCORE &&
  t.confidence === DEFAULT_TASK_SCORE &&
  t.ease === DEFAULT_TASK_SCORE &&
  t.urgency === DEFAULT_TASK_SCORE;
const todayDateKey = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const emptyTodaySlots = (): TodaySlot[] => [
  { ref: null, done: false },
  { ref: null, done: false },
  { ref: null, done: false },
];
const emptyTodayPlan = (): TodayPlan => ({
  date: todayDateKey(),
  mainRef: null,
  mainDone: false,
  mainHoursLogged: 0,
  extraMode: false,
  extraMainRef: null,
  extraMainDone: false,
  extraMainHoursLogged: 0,
  workMode: "tasks",
  lifeMode: "tasks",
  workSlots: emptyTodaySlots(),
  lifeSlots: emptyTodaySlots(),
  simpleTodos: [],
  inspirationalQuote: DEFAULT_INSPIRATIONAL_QUOTE,
});
const normalizeSlots = (
  slots: TodaySlot[] | undefined,
  legacyIds: (string | null)[] | undefined
): TodaySlot[] => {
  if (Array.isArray(slots) && slots.length) {
    const base = slots.map((s) => ({
      ref: s?.ref ?? null,
      done: !!s?.done,
    }));
    while (base.length < 3) base.push({ ref: null, done: false });
    return base;
  }
  const ids = Array.isArray(legacyIds) ? legacyIds.slice(0, 3) : [];
  while (ids.length < 3) ids.push(null);
  return ids.map((id) => ({ ref: id ? { kind: "task" as const, taskId: id } : null, done: false }));
};
const normalizeTodayPlan = (plan: Partial<TodayPlan> | undefined): TodayPlan => {
  if (!plan) return emptyTodayPlan();
  return {
    date: plan.date || todayDateKey(),
    mainRef:
      plan.mainRef ??
      ((plan as { mainTaskId?: string | null }).mainTaskId
        ? { kind: "task", taskId: (plan as { mainTaskId: string }).mainTaskId }
        : null),
    mainDone: !!plan.mainDone,
    mainHoursLogged: numOr(plan.mainHoursLogged, 0),
    extraMode: !!plan.extraMode,
    extraMainRef: plan.extraMainRef ?? null,
    extraMainDone: !!plan.extraMainDone,
    extraMainHoursLogged: numOr(plan.extraMainHoursLogged, 0),
    workMode: plan.workMode === "subtasks" ? "subtasks" : "tasks",
    lifeMode: plan.lifeMode === "subtasks" ? "subtasks" : "tasks",
    workSlots: normalizeSlots(plan.workSlots, plan.workSlotIds),
    lifeSlots: normalizeSlots(plan.lifeSlots, plan.lifeSlotIds),
    simpleTodos: Array.isArray(plan.simpleTodos)
      ? plan.simpleTodos.map((t) => ({
          id: t?.id || uid(),
          title: String(t?.title || "").trim() || "To-do",
          done: !!t?.done,
        }))
      : [],
    inspirationalQuote: plan.inspirationalQuote?.trim() || DEFAULT_INSPIRATIONAL_QUOTE,
  };
};
const normalizeTask = (t: Task): Task => ({
  ...t,
  board: t.board === "life" ? "life" : "work",
  archived: !!t.archived,
});
const slotRefKey = (ref: TodaySlotRef | null): string | null => {
  if (!ref) return null;
  if (ref.kind === "task") return `task:${ref.taskId}`;
  return `subtask:${ref.taskId}:${ref.subtaskId}`;
};
const parseSlotOption = (val: string): TodaySlotRef | null => {
  if (!val) return null;
  if (val.startsWith("task:")) return { kind: "task", taskId: val.slice(5) };
  const parts = val.startsWith("subtask:") ? val.slice(8).split(":") : [];
  if (parts.length === 2) return { kind: "subtask", taskId: parts[0], subtaskId: parts[1] };
  return null;
};
const refCompleted = (ref: TodaySlotRef | null, tasks: Task[]): boolean => {
  if (!ref) return false;
  const parent = tasks.find((t) => t.id === ref.taskId);
  if (!parent) return false;
  if (ref.kind === "task") return !!parent.completed;
  return !!(parent.children || []).find((c) => c.id === ref.subtaskId)?.completed;
};
const markTodayDoneForTask = (plan: TodayPlan, taskId: string): TodayPlan => {
  const mark = (slot: TodaySlot): TodaySlot => {
    if (!slot.ref) return slot;
    if (slot.ref.kind === "task" && slot.ref.taskId === taskId) return { ...slot, done: true };
    if (slot.ref.kind === "subtask" && slot.ref.taskId === taskId) return { ...slot, done: true };
    return slot;
  };
  const mainMatches =
    plan.mainRef?.kind === "task" && plan.mainRef.taskId === taskId;
  const extraMatches =
    plan.extraMainRef?.kind === "task" && plan.extraMainRef.taskId === taskId;
  return {
    ...plan,
    mainDone: mainMatches ? true : plan.mainDone,
    extraMainDone: extraMatches ? true : plan.extraMainDone,
    workSlots: plan.workSlots.map(mark),
    lifeSlots: plan.lifeSlots.map(mark),
  };
};
const unmarkTodayDoneForTask = (plan: TodayPlan, taskId: string): TodayPlan => {
  const unmark = (slot: TodaySlot): TodaySlot => {
    if (!slot.ref) return slot;
    if (slot.ref.kind === "task" && slot.ref.taskId === taskId) return { ...slot, done: false };
    return slot;
  };
  const mainMatches =
    plan.mainRef?.kind === "task" && plan.mainRef.taskId === taskId;
  const extraMatches =
    plan.extraMainRef?.kind === "task" && plan.extraMainRef.taskId === taskId;
  return {
    ...plan,
    mainDone: mainMatches ? false : plan.mainDone,
    extraMainDone: extraMatches ? false : plan.extraMainDone,
    workSlots: plan.workSlots.map(unmark),
    lifeSlots: plan.lifeSlots.map(unmark),
  };
};
const setTodayDoneForSubtask = (
  plan: TodayPlan,
  taskId: string,
  subtaskId: string,
  done: boolean
): TodayPlan => {
  const mark = (slot: TodaySlot): TodaySlot => {
    if (
      slot.ref?.kind === "subtask" &&
      slot.ref.taskId === taskId &&
      slot.ref.subtaskId === subtaskId
    ) {
      return { ...slot, done };
    }
    return slot;
  };
  const mainMatches =
    plan.mainRef?.kind === "subtask" &&
    plan.mainRef.taskId === taskId &&
    plan.mainRef.subtaskId === subtaskId;
  const extraMatches =
    plan.extraMainRef?.kind === "subtask" &&
    plan.extraMainRef.taskId === taskId &&
    plan.extraMainRef.subtaskId === subtaskId;
  return {
    ...plan,
    mainDone: mainMatches ? done : plan.mainDone,
    extraMainDone: extraMatches ? done : plan.extraMainDone,
    workSlots: plan.workSlots.map(mark),
    lifeSlots: plan.lifeSlots.map(mark),
  };
};
const clearTodayRefsForTask = (plan: TodayPlan, taskId: string): TodayPlan => {
  const clear = (slot: TodaySlot): TodaySlot => {
    if (!slot.ref) return slot;
    if (slot.ref.kind === "task" && slot.ref.taskId === taskId) return { ref: null, done: false };
    if (slot.ref.taskId === taskId) return { ref: null, done: false };
    return slot;
  };
  const clearMain = plan.mainRef?.taskId === taskId ? null : plan.mainRef;
  const clearExtra = plan.extraMainRef?.taskId === taskId ? null : plan.extraMainRef;
  return {
    ...plan,
    mainRef: clearMain,
    mainDone: clearMain ? plan.mainDone : false,
    mainHoursLogged: clearMain ? plan.mainHoursLogged : 0,
    extraMainRef: clearExtra,
    extraMainDone: clearExtra ? plan.extraMainDone : false,
    extraMainHoursLogged: clearExtra ? plan.extraMainHoursLogged : 0,
    workSlots: plan.workSlots.map(clear),
    lifeSlots: plan.lifeSlots.map(clear),
  };
};
type DueBadge = { label: string; tone: "danger" | "warn" | "accent" };
function dueBadge(due: number | null | undefined): DueBadge | null {
  if (due == null) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const start = startOfToday.getTime();
  const endOfToday = start + 24 * 60 * 60 * 1000;
  const endOfWeek = start + 7 * 24 * 60 * 60 * 1000;
  if (due < start) return { label: "Overdue", tone: "danger" };
  if (due < endOfToday) return { label: "Due today", tone: "warn" };
  if (due < endOfWeek) return { label: "This week", tone: "accent" };
  return null;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const statuses: Status[] = ["now", "next", "later"];

function numOr(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/* =======================
   Commit-on-blur inputs
======================= */
type CommitInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  value: string;
  onCommit: (next: string) => void;
};
function CommitInput({ value, onCommit, onKeyDown, onFocus, onBlur, ...rest }: CommitInputProps) {
  const [v, setV] = React.useState(value ?? "");
  const focused = React.useRef(false);
  // Only sync from parent when not editing — prevents caret jumping / reverse typing
  React.useEffect(() => {
    if (!focused.current) setV(value ?? "");
  }, [value]);
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        if (v !== value) onCommit(v);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value ?? "");
          (e.currentTarget as HTMLInputElement).blur();
        }
        onKeyDown?.(e);
      }}
    />
  );
}

type CommitTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  onCommit: (next: string) => void;
};
function CommitTextarea({ value, onCommit, onKeyDown, onFocus, onBlur, ...rest }: CommitTextareaProps) {
  const [v, setV] = React.useState(value ?? "");
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (!focused.current) setV(value ?? "");
  }, [value]);
  return (
    <textarea
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        if (v !== value) onCommit(v);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setV(value ?? "");
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
        onKeyDown?.(e);
      }}
    />
  );
}

/* =======================
   Seed Data
======================= */
const seedData = (): Task[] => {
  const t0 = Date.now();
  const mkSub = (title: string, order: number): Subtask => ({
    id: uid(),
    title,
    completed: false,
    order,
    createdAt: t0,
    updatedAt: t0,
  });
  const mkDel = (label: string, url: string): Deliverable => ({
    id: uid(),
    label,
    url,
    done: false,
    createdAt: t0,
    updatedAt: t0,
  });

  const orbiter: Task = {
    id: "T-orbiter-v2",
    title: "Orbiter prototype v2 (panel mixer)",
    details: "Integrate CLLD insert + firmware; validate 32×2µL mixing.",
    status: "now",
    impact: 9,
    confidence: 8,
    ease: 6,
    urgency: 7,
    completed: false,
    order: 1,
    createdAt: t0,
    updatedAt: t0,
    owner: "Nels",
    tags: ["R&D", "hardware", "example"],
    due: t0 + 1000 * 60 * 60 * 24 * 5,
    estimateH: 10,
    deps: [],
    children: [mkSub("Wire harness v2", 0), mkSub("Firmware build", 1)],
    deliverables: [mkDel("Validation report", "#"), mkDel("BOM", "#")],
  };

  const visium: Task = {
    id: "T-visium-install",
    title: "Visium install (NIH)",
    details: "2-day onsite: install + training + test slides.",
    status: "next",
    impact: 10,
    confidence: 7,
    ease: 7,
    urgency: 8,
    completed: false,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    owner: "Nels",
    tags: ["customer", "training", "example"],
    due: t0 + 1000 * 60 * 60 * 24 * 14,
    estimateH: 16,
    deps: ["T-orbiter-v2"],
    children: [mkSub("Ship consumables", 0), mkSub("Prep deck", 1)],
    deliverables: [mkDel("Install checklist", "#")],
  };

  const prod: Task = {
    id: "T-prod-sop",
    title: "Production SOPs v1",
    details: "Priming, decontam, service guide.",
    status: "now",
    impact: 8,
    confidence: 9,
    ease: 8,
    urgency: 6,
    completed: false,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    owner: "Kevin",
    tags: ["production", "docs", "example"],
    due: null,
    estimateH: 12,
    deps: [],
    children: [mkSub("Priming SOP draft", 0)],
    deliverables: [mkDel("SOP v1 PDF", "#")],
  };

  const training: Task = {
    id: "T-onboarding-webinar",
    title: "Customer onboarding webinar 02",
    details: "30-min overview + live demo.",
    status: "later",
    impact: 6,
    confidence: 8,
    ease: 9,
    urgency: 5,
    completed: false,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    owner: "Michael",
    tags: ["marketing", "training", "example"],
    due: null,
    estimateH: 6,
    deps: ["T-prod-sop"],
    children: [],
    deliverables: [mkDel("Slide deck", "#")],
  };

  const pss: Task = {
    id: "T-pss-buffer-test",
    title: "PSS buffer A/B (G-Buffer vs ER1/ER2)",
    details: "Keep protocol constant; compare genomic vs protein.",
    status: "next",
    impact: 7,
    confidence: 6,
    ease: 7,
    urgency: 7,
    completed: false,
    order: 2,
    createdAt: t0,
    updatedAt: t0,
    owner: "Nikolay",
    tags: ["chemistry", "assay", "example"],
    due: null,
    estimateH: 8,
    deps: [],
    children: [mkSub("Skylab kit prep", 0), mkSub("Run replicates", 1)],
    deliverables: [],
  };

  return [prod, orbiter, visium, training, pss];
};

const lifeSeedData = (): Task[] => {
  const t0 = Date.now();
  const mk = (title: string, status: Status, order: number, details?: string): Task => ({
    id: uid(),
    title,
    details,
    status,
    impact: 5,
    confidence: 5,
    ease: 6,
    urgency: 5,
    completed: false,
    order,
    createdAt: t0,
    updatedAt: t0,
    board: "life",
    owner: "",
    tags: ["life", "example"],
    due: null,
    estimateH: null,
    deps: [],
    children: [],
    deliverables: [],
  });
  return [
    mk("Clean house", "now", 0, "Kitchen, bathroom, living room."),
    mk("Submit housing inquiry", "next", 0, "Follow up on application status."),
    mk("Schedule dentist", "later", 0),
    mk("Grocery run", "later", 1),
  ];
};

const allSeedData = () => [...seedData(), ...lifeSeedData()];

/* =======================
   Scoring
======================= */
function importanceICE(t: Task, w: Weights) {
  const I = clamp(t.impact, 1, 10) * clamp(w.impact, 0.5, 2);
  const C = clamp(t.confidence, 1, 10) * clamp(w.confidence, 0.5, 2);
  const E = clamp(t.ease, 1, 10) * clamp(w.ease, 0.5, 2);
  return I * C * E;
}
function urgencyW(t: Task, w: Weights) {
  return clamp(t.urgency, 1, 10) * clamp(w.urgency, 0.5, 2);
}
function iuScore(t: Task, w: Weights) {
  return importanceICE(t, w) * urgencyW(t, w);
}

/* =======================
   CSV helpers
======================= */
type CSVRow = string[];
function parseCSV(text: string): CSVRow[] {
  const lines = text
    .split(/[\r\n\u2028\u2029]+/)
    .filter((l) => l.trim() !== "");
  const rows: CSVRow[] = [];
  for (const line of lines) {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}
function toCSV(rows: CSVRow[]): string {
  const esc = (s: string) => {
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

/* =======================
   Error Boundary
======================= */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  componentDidCatch(error: any, info: any) {
    console.error("App error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 12 }}>
          <h2>Something blew up 💥</h2>
          <p className="muted tiny">If this came from old saved data, clear it below.</p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              padding: 8,
              borderRadius: 8,
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {String(this.state.error)}
          </pre>
          <button
            className="tiny"
            onClick={() => {
              Object.keys(localStorage)
                .filter((k) => k.startsWith("task-prioritizer-cloud"))
                .forEach((k) => localStorage.removeItem(k));
              location.reload();
            }}
          >
            Clear saved state & reload
          </button>
        </div>
      );
    }
    return this.props.children as any;
  }
}

/* =======================
   App
======================= */
export default function App() {
  const { user, avatarUrl, signOut, openAuth, supabaseConfigured: authOn } = useAuth();
  const { openPicker } = useProfilePicker();
  const storageKey = storageKeyForUser(user?.id);
  const profileInitial = user?.email?.[0]?.toUpperCase() || (authOn ? "?" : "P");

  const [state, setState] = useState<AppState>(() => buildAppState(loadPersistedState(storageKey)));
  const [hasLoaded, setHasLoaded] = useState(false);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [celebrationTick, setCelebrationTick] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [draggingType, setDraggingType] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const columnRefs = useRef<Record<Status, HTMLDivElement | null>>({
    now: null,
    next: null,
    later: null,
  });

  useEffect(() => {
    setState(buildAppState(loadPersistedState(storageKey)));
    setHasLoaded(true);
  }, [storageKey]);

  // Debounced autosave
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!hasLoaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...state, search: "" }));
      } catch {}
    }, 350);
  }, [state, hasLoaded, storageKey]);

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const inField =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;

      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (inField) return;

      if ((e.key === "n" || e.key === "N") && state.section !== "today") {
        e.preventDefault();
        addTask("now");
        return;
      }
      if (state.section === "today") return;

      const col = e.key === "1" ? "now" : e.key === "2" ? "next" : e.key === "3" ? "later" : null;
      if (col) {
        e.preventDefault();
        columnRefs.current[col]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.section, state.tasks.length]);

  const isEdit = state.mode === "edit";
  const activeBoard: BoardKind = state.section === "life" ? "life" : "work";

  const taskInScope = (t: Task) => {
    const board = t.board || "work";
    if (board !== activeBoard) return false;
    if (t.archived && !state.showArchived) return false;
    return true;
  };

  const updateToday = (patch: Partial<TodayPlan>) =>
    setStatePreserveScroll((s) => ({
      ...s,
      today: { ...s.today, ...patch, date: todayDateKey() },
    }));

  /** Create a board task from Today and assign it to a slot / deep-work picker */
  const createTodayTask = (
    board: BoardKind,
    title: string,
    assign:
      | { kind: "main" }
      | { kind: "extraMain" }
      | { kind: "slot"; slotKey: "workSlots" | "lifeSlots"; idx: number }
  ) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setStatePreserveScroll((s) => {
      const now = Date.now();
      const status: Status = "now";
      const maxOrder =
        s.tasks
          .filter((t) => t.status === status && (t.board || "work") === board)
          .reduce((m, t) => Math.max(m, t.order), -1) + 1;
      const task: Task = {
        id: uid(),
        title: trimmed,
        status,
        board,
        impact: DEFAULT_TASK_SCORE,
        confidence: DEFAULT_TASK_SCORE,
        ease: DEFAULT_TASK_SCORE,
        urgency: DEFAULT_TASK_SCORE,
        completed: false,
        order: maxOrder,
        createdAt: now,
        updatedAt: now,
        children: [],
        deliverables: [],
        tags: board === "life" ? ["life"] : [],
        deps: [],
        owner: "",
        details: "",
        estimateH: null,
        due: null,
      };
      const ref: TodaySlotRef = { kind: "task", taskId: task.id };
      let today: TodayPlan = { ...s.today, date: todayDateKey() };
      if (assign.kind === "main") {
        today = { ...today, mainRef: ref, mainHoursLogged: 0, mainDone: false };
      } else if (assign.kind === "extraMain") {
        today = { ...today, extraMainRef: ref, extraMainHoursLogged: 0, extraMainDone: false };
      } else {
        const next = [...today[assign.slotKey]];
        while (next.length <= assign.idx) next.push({ ref: null, done: false });
        next[assign.idx] = { ref, done: false };
        today = { ...today, [assign.slotKey]: next };
      }
      return { ...s, tasks: [...s.tasks, task], today };
    });
  };

  // Derived indexes
  const taskById = useMemo(() => {
    const m = new Map<string, Task>();
    state.tasks.forEach((t) => m.set(t.id, t));
    return m;
  }, [state.tasks]);

  const blocked = (t: Task) =>
    (t.deps || []).some((id) => {
      const dep = taskById.get(id);
      return dep && !dep.completed;
    });

  function setStatePreserveScroll(updater: (s: AppState) => AppState) {
    const y = window.scrollY;
    setState((s) => updater(s));
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  // Search
  function matchesSearch(t: Task, q: string): boolean {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    const fields: string[] = [
      t.title,
      t.details || "",
      t.owner || "",
      (t.tags || []).join(" "),
      ...(t.children || []).map((c) => c.title),
      ...(t.deliverables || []).map((d) => d.label + " " + d.url),
    ];
    return fields.some((f) => f.toLowerCase().includes(s));
  }

  // If a task is marked complete, it should be treated as "done" for filtering,
  // regardless of unfinished subtasks.
  const effectivelyCompleted = (t: Task) => !!t.completed;

  // Sort
  function sortTasks(list: Task[]): Task[] {
    const w = state.weights;
    if (state.sortBy === "manual") return [...list].sort((a, b) => a.order - b.order);
    if (state.sortBy === "ice") return [...list].sort((a, b) => importanceICE(b, w) - importanceICE(a, w));
    if (state.sortBy === "urgency") return [...list].sort((a, b) => urgencyW(b, w) - urgencyW(a, w));
    return [...list].sort((a, b) => iuScore(b, w) - iuScore(a, w));
  }

  function filteredByStatus(s: Status): Task[] {
    const arr = state.tasks.filter(
      (t) =>
        taskInScope(t) &&
        t.status === s &&
        matchesSearch(t, state.search) &&
        (state.showCompleted || !effectivelyCompleted(t))
    );
    let out = sortTasks(arr);
    if (state.focus) {
      out = [...out]
        .sort((a, b) => iuScore(b, state.weights) - iuScore(a, state.weights))
        .slice(0, 2);
    }
    return out;
  }

  // Visible set + medians
  const allVisible = useMemo(
    () =>
      state.tasks.filter(
        (t) =>
          taskInScope(t) &&
          matchesSearch(t, state.search) &&
          (state.showCompleted || !effectivelyCompleted(t))
      ),
    [state.tasks, state.search, state.showCompleted, state.section, state.showArchived]
  );
  const autoImp = useMemo(() => {
    const vals = allVisible.map((t) => importanceICE(t, state.weights)).sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  }, [allVisible, state.weights]);
  const autoUrg = useMemo(() => {
    const vals = allVisible.map((t) => urgencyW(t, state.weights)).sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  }, [allVisible, state.weights]);
  const thrImp = state.thresholds.imp || autoImp;
  const thrUrg = state.thresholds.urg || autoUrg;

  // Metric maxima
  const metricMax = useMemo(() => {
    const ICEs = allVisible.map((t) => importanceICE(t, state.weights));
    const URGs = allVisible.map((t) => urgencyW(t, state.weights));
    const IUs = allVisible.map((t) => iuScore(t, state.weights));
    return {
      ice: Math.max(1, ...ICEs, 1),
      urg: Math.max(1, ...URGs, 1),
      iu: Math.max(1, ...IUs, 1),
    };
  }, [allVisible, state.weights]);

  // Heat fills
  const heatFill = (v: number, max: number, colorVar: string, weakVar: string) => {
    const pct = Math.max(0, Math.min(100, Math.round((v / (max || 1)) * 100)));
    return {
      backgroundImage: `linear-gradient(90deg, var(${weakVar}) 0%, var(${weakVar}) ${pct}%, transparent ${pct}%)`,
      borderColor: `var(${colorVar})`,
      color: `var(${colorVar})`,
    } as React.CSSProperties;
  };
  const heatICE = (v: number) => heatFill(v, metricMax.ice, "--heat-imp", "--heat-imp-weak");
  const heatURG = (v: number) => heatFill(v, metricMax.urg, "--heat-urg", "--heat-urg-weak");
  const heatIU = (v: number) => heatFill(v, metricMax.iu, "--heat-iu", "--heat-iu-weak");

  // WIP check
  function canDropInto(status: Status, incomingCount: number): boolean {
    const limit = state.wip[status];
    if (limit === 0) return true;
    return incomingCount <= limit;
  }

  const fireCelebration = () => {
    if (!state.celebrationsEnabled) return;
    setCelebrationTick((t) => t + 1);
    setCelebrationOpen(true);
  };

  // Mutators
  const updateTask = (id: string, patch: Partial<Task>) =>
    setStatePreserveScroll((s) => {
      let today = s.today;
      if (patch.completed === true) {
        today = markTodayDoneForTask(today, id);
      } else if (patch.completed === false) {
        today = unmarkTodayDoneForTask(today, id);
      }
      return {
        ...s,
        today,
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)),
      };
    });

  const toggleTaskComplete = (id: string) => {
    const task = taskById.get(id);
    if (!task) return;
    const next = !task.completed;
    if (next) fireCelebration();
    updateTask(id, { completed: next });
  };

  const toggleSubtaskComplete = (taskId: string, subtaskId: string) => {
    const task = taskById.get(taskId);
    if (!task) return;
    const sub = (task.children || []).find((c) => c.id === subtaskId);
    if (!sub) return;
    const next = !sub.completed;
    if (next) fireCelebration();
    const arr = (task.children || []).map((x) =>
      x.id === subtaskId ? { ...x, completed: next, updatedAt: Date.now() } : x
    );
    setStatePreserveScroll((s) => ({
      ...s,
      today: setTodayDoneForSubtask(s.today, taskId, subtaskId, next),
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, children: arr, updatedAt: Date.now() } : t
      ),
    }));
  };

  const addTask = (status: Status, title = "New task", board?: BoardKind): Task => {
    const now = Date.now();
    const boardKind = board ?? activeBoard;
    const maxOrder =
      state.tasks
        .filter((t) => t.status === status && (t.board || "work") === boardKind)
        .reduce((m, t) => Math.max(m, t.order), -1) + 1;
    const t: Task = {
      id: uid(),
      title,
      status,
      board: boardKind,
      impact: DEFAULT_TASK_SCORE,
      confidence: DEFAULT_TASK_SCORE,
      ease: DEFAULT_TASK_SCORE,
      urgency: DEFAULT_TASK_SCORE,
      completed: false,
      order: maxOrder,
      createdAt: now,
      updatedAt: now,
      children: [],
      deliverables: [],
      tags: boardKind === "life" ? ["life"] : [],
      deps: [],
      owner: "",
      details: "",
      estimateH: null,
      due: null,
    };
    setStatePreserveScroll((s) => ({ ...s, tasks: [...s.tasks, t] }));
    return t;
  };

  const archiveTask = (id: string) =>
    setStatePreserveScroll((s) => ({
      ...s,
      today: clearTodayRefsForTask(s.today, id),
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, archived: true, archivedAt: Date.now(), updatedAt: Date.now() } : t
      ),
    }));

  const unarchiveTask = (id: string) =>
    setStatePreserveScroll((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, archived: false, archivedAt: undefined, updatedAt: Date.now() } : t
      ),
    }));

  const deleteTask = (id: string) =>
    setStatePreserveScroll((s) => ({
      ...s,
      today: clearTodayRefsForTask(s.today, id),
      tasks: s.tasks
        .filter((t) => t.id !== id)
        .map((t) =>
          t.deps?.includes(id) ? { ...t, deps: (t.deps || []).filter((d) => d !== id) } : t
        ),
    }));

  const addSubtask = (taskId: string) =>
    setStatePreserveScroll((s) => {
      const now = Date.now();
      return {
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                children: [
                  ...(t.children || []),
                  {
                    id: uid(),
                    title: "New subtask",
                    completed: false,
                    order: (t.children || []).length,
                    createdAt: now,
                    updatedAt: now,
                  },
                ],
                updatedAt: now,
              }
            : t
        ),
      };
    });

  const addDeliverable = (taskId: string) =>
    setStatePreserveScroll((s) => {
      const now = Date.now();
      return {
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                deliverables: [
                  ...(t.deliverables || []),
                  {
                    id: uid(),
                    label: "New deliverable",
                    url: "",
                    done: false,
                    createdAt: now,
                    updatedAt: now,
                  },
                ],
                updatedAt: now,
              }
            : t
        ),
      };
    });

  /* =======================
     Drag & Drop — robust cross-column move
  ======================= */
  const moveTaskToStatus = (taskId: string, dstStatus: Status, insertIndex?: number) => {
    setStatePreserveScroll((s) => {
      const now = Date.now();
      const moving = s.tasks.find((t) => t.id === taskId);
      if (!moving) return s;
      const srcStatus = moving.status;
      if (srcStatus === dstStatus) return s;
      const board = moving.board || "work";
      const dstCount =
        s.tasks.filter(
          (t) => t.status === dstStatus && t.id !== taskId && (t.board || "work") === board
        ).length + 1;
      if (!canDropInto(dstStatus, dstCount)) {
        const limit = s.wip[dstStatus];
        window.setTimeout(() => {
          alert(`WIP limit for ${dstStatus.toUpperCase()} is ${limit}. Raise WIP (0 = unlimited) to move this task.`);
        }, 0);
        return s;
      }
      const srcCol = s.tasks
        .filter((t) => t.status === srcStatus && t.id !== taskId && (t.board || "work") === board)
        .sort((a, b) => a.order - b.order);
      const dstCol = s.tasks
        .filter((t) => t.status === dstStatus && (t.board || "work") === board)
        .sort((a, b) => a.order - b.order);
      const insertIdx =
        insertIndex == null ? dstCol.length : Math.min(Math.max(0, insertIndex), dstCol.length);
      dstCol.splice(insertIdx, 0, { ...moving, status: dstStatus, updatedAt: now });
      const reindexed = new Map<string, { status: Status; order: number }>();
      srcCol.forEach((t, i) => reindexed.set(t.id, { status: srcStatus, order: i }));
      dstCol.forEach((t, i) => reindexed.set(t.id, { status: dstStatus, order: i }));
      return {
        ...s,
        tasks: s.tasks.map((t) =>
          reindexed.has(t.id)
            ? {
                ...t,
                status: reindexed.get(t.id)!.status,
                order: reindexed.get(t.id)!.order,
                updatedAt: now,
              }
            : t
        ),
      };
    });
  };

  function onDragEnd(result: DropResult) {
    setDraggingType(null);
    const { source, destination, draggableId, type } = result;
    if (!destination) return;

    if (type === "TASK") {
      const srcStatus = source.droppableId as Status;
      const dstStatus = destination.droppableId as Status;
      if (!statuses.includes(dstStatus)) return;
      const movingTaskId = draggableId.replace("task-", "");
      const sameColumn = srcStatus === dstStatus;
      const manualReorderAllowed = state.sortBy === "manual" && !state.focus;

      if (!sameColumn) {
        moveTaskToStatus(
          movingTaskId,
          dstStatus,
          state.sortBy === "manual" ? destination.index : undefined
        );
        return;
      }

      setStatePreserveScroll((s) => {
        const now = Date.now();

        // sanity: ensure moving exists
        const moving = s.tasks.find((t) => t.id === movingTaskId);
        if (!moving) return s;

        // Same-column reorder only when Manual+no Focus
        if (sameColumn && manualReorderAllowed) {
          const moving = s.tasks.find((t) => t.id === movingTaskId);
          if (!moving) return s;
          const board = moving.board || "work";
          const col = s.tasks
            .filter((t) => t.status === srcStatus && (t.board || "work") === board)
            .sort((a, b) => a.order - b.order);
          const fromIdx = col.findIndex((t) => t.id === movingTaskId);
          if (fromIdx < 0) return s;
          const [m] = col.splice(fromIdx, 1);
          col.splice(destination.index, 0, m);
          const reindexed = new Map(col.map((t, i) => [t.id, i]));
          return {
            ...s,
            tasks: s.tasks.map((t) =>
              t.status === srcStatus && reindexed.has(t.id)
                ? { ...t, order: reindexed.get(t.id)!, updatedAt: now }
                : t
            ),
          };
        }

        return s;
      });
      return;
    }

    if (type === "SUBTASK") {
      const srcTid = source.droppableId.replace("subtasks-", "");
      const dstTid = destination.droppableId.replace("subtasks-", "");
      const sid = draggableId.replace("subtask-", "");
      if (state.sortBy !== "manual") return;
      setStatePreserveScroll((s) => {
        const now = Date.now();
        let moving: Subtask | null = null;
        const removed = s.tasks.map((t) => {
          if (t.id !== srcTid) return t;
          const arr = [...(t.children || [])];
          const idx = arr.findIndex((c) => c.id === sid);
          if (idx >= 0) [moving] = arr.splice(idx, 1);
          return { ...t, children: arr, updatedAt: now };
        });
        if (!moving) return s;
        const withDest = removed.map((t) => {
          if (t.id !== dstTid) return t;
          const arr = [...(t.children || [])];
          arr.splice(destination.index, 0, { ...moving!, order: destination.index, updatedAt: now });
          const fixed = arr.map((c, i) => ({ ...c, order: i }));
          return { ...t, children: fixed, updatedAt: now };
        });
        return { ...s, tasks: withDest };
      });
    }
  }

  /* =======================
     Import / Download
  ======================= */
  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function exportFilename(ext: string) {
    return `prioritizer-${exportFileStamp()}.${ext}`;
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ ...state, search: "" }, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, exportFilename("json"));
  }
  function exportCSV() {
    const header = [
      "record",
      "id",
      "parentId",
      "title",
      "details",
      "status",
      "impact",
      "confidence",
      "ease",
      "urgency",
      "owner",
      "tags",
      "completed",
      "order",
      "createdAt",
      "updatedAt",
      "due",
      "estimateH",
      "deps",
      "label",
      "url",
      "done",
      "board",
      "archived",
    ];
    const rows: CSVRow[] = [header];
    for (const t of state.tasks) {
      rows.push([
        "task",
        t.id,
        "",
        t.title,
        t.details || "",
        t.status,
        String(t.impact),
        String(t.confidence),
        String(t.ease),
        String(t.urgency),
        t.owner || "",
        (t.tags || []).join(";"),
        t.completed ? "true" : "false",
        String(t.order),
        String(t.createdAt || 0),
        String(t.updatedAt || 0),
        t.due == null ? "" : String(t.due),
        t.estimateH == null ? "" : String(t.estimateH),
        (t.deps || []).join(";"),
        "",
        "",
        "",
        t.board || "work",
        t.archived ? "true" : "false",
      ]);
      for (const c of t.children || []) {
        rows.push([
          "subtask",
          c.id,
          t.id,
          c.title,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          c.completed ? "true" : "false",
          String(c.order),
          String(c.createdAt || 0),
          String(c.updatedAt || 0),
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
      }
      for (const d of t.deliverables || []) {
        rows.push([
          "deliverable",
          d.id,
          t.id,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          d.done ? "true" : "false",
          "0",
          String(d.createdAt || 0),
          String(d.updatedAt || 0),
          "",
          "",
          "",
          d.label,
          d.url,
          d.done ? "true" : "false",
          "",
          "",
        ]);
      }
    }
    downloadBlob(new Blob([toCSV(rows)], { type: "text/csv" }), exportFilename("csv"));
  }
  function importJSON(file: File) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const obj = JSON.parse(String(fr.result || "{}"));
        if (!Array.isArray(obj.tasks)) throw new Error("Invalid JSON format");
        setStatePreserveScroll((s) => ({
          ...s,
          ...obj,
          tasks: obj.tasks.map(normalizeTask),
          today: normalizeTodayPlan(obj.today),
          search: "",
        }));
      } catch {
        alert("Invalid JSON");
      }
    };
    fr.readAsText(file);
  }
  function importCSV(file: File) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const text = String(fr.result || "");
        const rows = parseCSV(text);
        if (!rows.length) return;
        const header = rows[0].map((h) => h.trim());
        const H = (name: string) => header.indexOf(name);
        const tasks: Record<string, Task> = {};
        const subtasksByParent: Record<string, Subtask[]> = {};
        const delsByParent: Record<string, Deliverable[]> = {};
        for (const r of rows.slice(1)) {
          const rec = (r[H("record")] || "").trim();
          if (!rec) continue;
          if (rec === "task") {
            const id = r[H("id")] || uid();
            tasks[id] = {
              id,
              title: r[H("title")] || "Untitled",
              details: r[H("details")] || "",
              status: (r[H("status")] as Status) || "next",
              impact: Number(r[H("impact")] || 5),
              confidence: Number(r[H("confidence")] || 5),
              ease: Number(r[H("ease")] || 5),
              urgency: Number(r[H("urgency")] || 5),
              owner: r[H("owner")] || "",
              tags: (r[H("tags")] || "")
                .split(";")
                .map((x) => x.trim())
                .filter(Boolean),
              completed: (r[H("completed")] || "").toLowerCase() === "true",
              order: Number(r[H("order")] || 0),
              createdAt: Number(r[H("createdAt")] || Date.now()),
              updatedAt: Number(r[H("updatedAt")] || Date.now()),
              due: r[H("due")] ? Number(r[H("due")]) : null,
              estimateH: r[H("estimateH")] ? Number(r[H("estimateH")]) : null,
              deps: (r[H("deps")] || "")
                .split(";")
                .map((x) => x.trim())
                .filter(Boolean),
              board: r[H("board")] === "life" ? "life" : "work",
              archived: (r[H("archived")] || "").toLowerCase() === "true",
              children: [],
              deliverables: [],
              collapsed: false,
            };
          } else if (rec === "subtask") {
            const parentId = r[H("parentId")];
            if (!parentId) continue;
            (subtasksByParent[parentId] ||= []).push({
              id: r[H("id")] || uid(),
              title: r[H("title")] || "Untitled",
              completed: (r[H("completed")] || "").toLowerCase() === "true",
              order: Number(r[H("order")] || 0),
              createdAt: Number(r[H("createdAt")] || Date.now()),
              updatedAt: Number(r[H("updatedAt")] || Date.now()),
            });
          } else if (rec === "deliverable") {
            const parentId = r[H("parentId")];
            if (!parentId) continue;
            const del: Deliverable = {
              id: r[H("id")] || uid(),
              label: r[H("label")] || "Deliverable",
              url: r[H("url")] || "",
              done: (r[H("done")] || "").toLowerCase() === "true",
              createdAt: Number(r[H("createdAt")] || Date.now()),
              updatedAt: Number(r[H("updatedAt")] || Date.now()),
            };
            (delsByParent[parentId] ||= []).push(del);
          }
        }
        const result: Task[] = Object.values(tasks).map((t) => normalizeTask({
          ...t,
          children: (subtasksByParent[t.id] || []).sort((a, b) => a.order - b.order),
          deliverables: delsByParent[t.id] || [],
        }));
        setStatePreserveScroll((s) => ({ ...s, tasks: result }));
      } catch {
        alert("Invalid CSV");
      }
    };
    fr.readAsText(file);
  }

  /* =======================
     Views
  ======================= */

  const pickerTasks = (board: BoardKind) =>
    state.tasks.filter(
      (t) => (t.board || "work") === board && !t.archived && !effectivelyCompleted(t)
    );

  const pickerSubtasks = (board: BoardKind) => {
    const rows: { key: string; ref: TodaySlotRef; label: string }[] = [];
    for (const t of state.tasks) {
      if ((t.board || "work") !== board || t.archived) continue;
      for (const c of t.children || []) {
        if (c.completed) continue;
        rows.push({
          key: `subtask:${t.id}:${c.id}`,
          ref: { kind: "subtask", taskId: t.id, subtaskId: c.id },
          label: `${t.title} › ${c.title}`,
        });
      }
    }
    return rows;
  };

  const slotLabel = (ref: TodaySlotRef | null): string => {
    if (!ref) return "";
    if (ref.kind === "task") return taskById.get(ref.taskId)?.title || "Task";
    const parent = taskById.get(ref.taskId);
    const sub = parent?.children?.find((c) => c.id === ref.subtaskId);
    return sub ? `${parent?.title || "Task"} › ${sub.title}` : "Subtask";
  };

  const todayPrintRef = useRef<HTMLDivElement>(null);
  const boardPrintRef = useRef<HTMLDivElement>(null);

  const downloadBoardPdf = () => {
    const label = state.section === "life" ? "life" : "work";
    void downloadElementPdf(boardPrintRef.current, `${label}-board-${exportFileStamp()}.pdf`);
  };

  const downloadBoardTxt = () => {
    const label = state.section === "life" ? "life" : "work";
    const title = state.section === "life" ? "Life" : "Work";
    const lines: string[] = [];
    lines.push(`${title} — Prioritizer`);
    lines.push(`Date: ${nowDateTimeLabel()}`);
    lines.push(
      `Focus: ${state.focus ? "on" : "off"} | Hide done: ${state.showCompleted ? "off" : "on"} | Search: ${
        state.search || "—"
      }`
    );
    lines.push("");
    for (const s of statuses) {
      const list = filteredByStatus(s);
      lines.push(`${s.toUpperCase()}:`);
      if (list.length === 0) {
        lines.push("- (none)");
      } else {
        for (const t of list) {
          const ICE = round2(importanceICE(t, state.weights));
          const URG = round2(urgencyW(t, state.weights));
          const IU = round2(iuScore(t, state.weights));
          lines.push(`- ${t.completed ? "[x]" : "[ ]"} ${t.title} (ICE ${ICE}, URG ${URG}, IU ${IU})`);
          const subs = (t.children || []).slice().sort((a, b) => a.order - b.order);
          for (const c of subs) {
            lines.push(`  - ${c.completed ? "[x]" : "[ ]"} ${c.title}`);
          }
        }
      }
      lines.push("");
    }
    downloadTextFile(`${label}-board-${exportFileStamp()}.txt`, lines.join("\n").trimEnd() + "\n");
  };

  function IceHelpPanel() {
    return (
      <div className="ice-help">
        <div className="row gap">
          <HelpCircle size={16} />
          <strong>ICE scoring (quick guide)</strong>
        </div>
        <p className="muted tiny ice-help-lead">
          Rate each task 1–10. Higher scores rise on the board when sorted by ICE or ICE × Urgency.
        </p>
        <dl className="ice-defs">
          <div>
            <dt>I — Impact</dt>
            <dd>How much value if this succeeds? (revenue, learning, unblock others)</dd>
          </div>
          <div>
            <dt>C — Confidence</dt>
            <dd>How sure are you it will work / pay off?</dd>
          </div>
          <div>
            <dt>E — Ease</dt>
            <dd>How fast / cheap to finish? (inverse of effort)</dd>
          </div>
          <div>
            <dt>U — Urgency</dt>
            <dd>How time-sensitive? (deadlines, dependencies, risk of delay)</dd>
          </div>
        </dl>
        <p className="muted tiny">
          ICE score ≈ I × C × E (weighted). IU = ICE × U.{" "}
          <a
            href="https://itamargilad.com/the-tool-that-will-help-you-choose-better-product-ideas/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Full ICE article →
          </a>
        </p>
      </div>
    );
  }

  const slotPickerOptions = (
    pool: Task[],
    subPool: { key: string; ref: TodaySlotRef; label: string }[],
    usedRefKeys: Set<string>,
    currentValue: string
  ) => (
    <>
      {pool.length > 0 && (
        <optgroup label="Tasks">
          {pool.map((t) => {
            const key = `task:${t.id}`;
            return (
              <option key={t.id} value={key} disabled={usedRefKeys.has(key) && key !== currentValue}>
                {t.title}
              </option>
            );
          })}
        </optgroup>
      )}
      {subPool.length > 0 && (
        <optgroup label="Subtasks">
          {subPool.map((row) => (
            <option
              key={row.key}
              value={row.key}
              disabled={usedRefKeys.has(row.key) && row.key !== currentValue}
            >
              {row.label}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  function BoardPrintSheet() {
    const boardLabel = state.section === "life" ? "Life" : "Work";
    const printDate = nowDateTimeLabel();
    const w = state.weights;

    return (
      <div ref={boardPrintRef} className="board-print-sheet" aria-hidden="true">
        <h1>
          {boardLabel} — Prioritizer
        </h1>
        <p className="board-print-meta">{printDate}</p>
        {state.focus && <p className="board-print-meta">Focus: top 2 per column</p>}
        <p className="board-print-meta">
          Sort: {state.sortBy} · View: {state.view}
        </p>
        <div className="board-print-grid">
          {statuses.map((s) => {
            const list = filteredByStatus(s);
            return (
              <section key={s} className="board-print-col">
                <h2>{s.toUpperCase()}</h2>
                {list.length === 0 ? (
                  <p className="board-print-empty">—</p>
                ) : (
                  <ul>
                    {list.map((t) => {
                      const ICE = round2(importanceICE(t, w));
                      const URG = round2(urgencyW(t, w));
                      const IU = round2(iuScore(t, w));
                      const subs = (t.children || []).slice().sort((a, b) => a.order - b.order);
                      return (
                        <li key={t.id} className={t.completed ? "print-struck" : ""}>
                          <strong>{t.title}</strong>
                          <span className="board-print-scores">
                            ICE {ICE} · URG {URG} · IU {IU}
                          </span>
                          {subs.length > 0 && (
                            <ul className="board-print-subs">
                              {subs.map((c) => (
                                <li key={c.id} className={c.completed ? "print-struck" : ""}>
                                  {c.title}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  function TodayView() {
    const plan = state.today;
    const [todoDraft, setTodoDraft] = useState("");
    const [quickDrafts, setQuickDrafts] = useState<Record<string, string>>({});
    const workPool = pickerTasks("work");
    const lifePool = pickerTasks("life");
    const workSubPool = pickerSubtasks("work");
    const lifeSubPool = pickerSubtasks("life");
    const mainLabel = slotLabel(plan.mainRef);
    const extraMainLabel = slotLabel(plan.extraMainRef);
    const mainDone = refCompleted(plan.mainRef, state.tasks);
    const extraMainDone = refCompleted(plan.extraMainRef, state.tasks);
    const mainRefKey = slotRefKey(plan.mainRef) || "";
    const extraMainRefKey = slotRefKey(plan.extraMainRef) || "";
    const extraOn = !!plan.extraMode;
    const workSlots = plan.workSlots;
    const lifeSlots = plan.lifeSlots;
    const visibleWork = extraOn ? workSlots : workSlots.slice(0, 3);
    const visibleLife = extraOn ? lifeSlots : lifeSlots.slice(0, 3);

    const usedRefKeys = new Set(
      [
        ...workSlots.map((s) => slotRefKey(s.ref)),
        ...lifeSlots.map((s) => slotRefKey(s.ref)),
        slotRefKey(plan.mainRef),
      ].filter(Boolean) as string[]
    );
    // Extra deep work may reuse the same main task
    const usedForExtraMain = new Set(
      [...workSlots.map((s) => slotRefKey(s.ref)), ...lifeSlots.map((s) => slotRefKey(s.ref))].filter(
        Boolean
      ) as string[]
    );

    const downloadTodayPdf = () => {
      void downloadElementPdf(todayPrintRef.current, `today-${todayDateKey()}.pdf`);
    };

    const downloadTodayTxt = () => {
      const lines: string[] = [];
      lines.push(extraOn ? "Today — 3·3·3 + EXTRA" : "Today — 3·3·3");
      lines.push(`Date: ${nowDateTimeLabel()}`);
      lines.push("");
      lines.push(extraOn ? "Deep work (3h+):" : "Deep work (3h):");
      lines.push(
        `- ${plan.mainRef ? (mainDone ? "[x]" : "[ ]") : "[ ]"} ${
          plan.mainRef ? mainLabel : "(not set)"
        } (${plan.mainHoursLogged.toFixed(1)} h)`
      );
      lines.push("");
      lines.push(`${visibleWork.length} work:`);
      visibleWork.forEach((s) => {
        lines.push(`- ${s.ref ? (s.done ? "[x]" : "[ ]") : "[ ]"} ${s.ref ? slotLabel(s.ref) : "(empty slot)"}`);
      });
      lines.push("");
      lines.push(`${visibleLife.length} life:`);
      visibleLife.forEach((s) => {
        lines.push(`- ${s.ref ? (s.done ? "[x]" : "[ ]") : "[ ]"} ${s.ref ? slotLabel(s.ref) : "(empty slot)"}`);
      });
      if (extraOn) {
        lines.push("");
        lines.push("Extra deep work:");
        lines.push(
          `- ${plan.extraMainRef ? (extraMainDone ? "[x]" : "[ ]") : "[ ]"} ${
            plan.extraMainRef ? extraMainLabel : "(not set)"
          } (${plan.extraMainHoursLogged.toFixed(1)} h)`
        );
      }
      lines.push("");
      lines.push("Quick to-dos:");
      if (plan.simpleTodos.length === 0) lines.push("- (none)");
      else {
        for (const item of plan.simpleTodos) {
          lines.push(`- ${item.done ? "[x]" : "[ ]"} ${item.title}`);
        }
      }
      lines.push("");
      lines.push("Quote:");
      lines.push(plan.inspirationalQuote?.trim() ? plan.inspirationalQuote.trim() : DEFAULT_INSPIRATIONAL_QUOTE);
      lines.push("");
      downloadTextFile(`today-${todayDateKey()}.txt`, lines.join("\n").trimEnd() + "\n");
    };

    const addSimpleTodo = () => {
      const title = todoDraft.trim();
      if (!title) return;
      updateToday({
        simpleTodos: [...plan.simpleTodos, { id: uid(), title, done: false }],
      });
      setTodoDraft("");
    };

    const toggleSimpleTodo = (id: string) => {
      const item = plan.simpleTodos.find((t) => t.id === id);
      if (item && !item.done) fireCelebration();
      updateToday({
        simpleTodos: plan.simpleTodos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
      });
    };

    const updateSimpleTodoTitle = (id: string, title: string) => {
      updateToday({
        simpleTodos: plan.simpleTodos.map((t) => (t.id === id ? { ...t, title: title.trim() || t.title } : t)),
      });
    };

    const deleteSimpleTodo = (id: string) => {
      updateToday({ simpleTodos: plan.simpleTodos.filter((t) => t.id !== id) });
    };

    const resetAllToday = () => {
      const ok = window.confirm(
        "Reset Today plan?\n\nThis will clear all chosen tasks, logged hours, and quick to-dos."
      );
      if (!ok) return;
      updateToday({
        mainRef: null,
        mainDone: false,
        mainHoursLogged: 0,
        extraMainRef: null,
        extraMainDone: false,
        extraMainHoursLogged: 0,
        workSlots: emptyTodaySlots(),
        lifeSlots: emptyTodaySlots(),
        simpleTodos: [],
      });
    };

    const resetCompletedToday = () => {
      const isSlotCompleted = (slot: TodaySlot) =>
        Boolean(slot.done || refCompleted(slot.ref, state.tasks));
      const isMainCompleted = Boolean(refCompleted(plan.mainRef, state.tasks));
      const isExtraMainCompleted = Boolean(refCompleted(plan.extraMainRef, state.tasks));

      const newWorkSlots = plan.workSlots.map((s) =>
        isSlotCompleted(s) ? { ref: null, done: false } : s
      );
      const newLifeSlots = plan.lifeSlots.map((s) =>
        isSlotCompleted(s) ? { ref: null, done: false } : s
      );

      const newMainRef = isMainCompleted ? null : plan.mainRef;
      const newMainDone = isMainCompleted ? false : plan.mainDone;
      const newMainHours = isMainCompleted ? 0 : plan.mainHoursLogged;

      const newExtraMainRef = isExtraMainCompleted ? null : plan.extraMainRef;
      const newExtraMainDone = isExtraMainCompleted ? false : plan.extraMainDone;
      const newExtraMainHours = isExtraMainCompleted ? 0 : plan.extraMainHoursLogged;

      const newSimpleTodos = plan.simpleTodos.filter((t) => !t.done);

      updateToday({
        mainRef: newMainRef,
        mainDone: newMainDone,
        mainHoursLogged: newMainHours,
        extraMainRef: newExtraMainRef,
        extraMainDone: newExtraMainDone,
        extraMainHoursLogged: newExtraMainHours,
        workSlots: newWorkSlots,
        lifeSlots: newLifeSlots,
        simpleTodos: newSimpleTodos,
      });
    };

    const setQuickDraft = (key: string, value: string) =>
      setQuickDrafts((d) => ({ ...d, [key]: value }));

    const setSlotDone = (
      slotKey: "workSlots" | "lifeSlots",
      idx: number,
      done: boolean
    ) => {
      if (done) fireCelebration();
      setStatePreserveScroll((s) => {
        const slot = s.today[slotKey][idx];
        if (!slot) return s;
        const nextSlots = [...s.today[slotKey]];
        nextSlots[idx] = { ...slot, done };

        let nextTasks = s.tasks;
        if (s.syncTodayCompletion && slot.ref) {
          if (slot.ref.kind === "task") {
            const taskId = slot.ref.taskId;
            nextTasks = nextTasks.map((t) =>
              t.id === taskId ? { ...t, completed: done, updatedAt: Date.now() } : t
            );
          } else if (slot.ref.kind === "subtask") {
            const { taskId, subtaskId } = slot.ref;
            nextTasks = nextTasks.map((t) => {
              if (t.id !== taskId) return t;
              const children = (t.children || []).map((c) =>
                c.id === subtaskId ? { ...c, completed: done, updatedAt: Date.now() } : c
              );
              return { ...t, children, updatedAt: Date.now() };
            });
          }
        }

        return {
          ...s,
          tasks: nextTasks,
          today: { ...s.today, [slotKey]: nextSlots },
        };
      });
    };

    const toggleSlotRefComplete = (ref: TodaySlotRef | null) => {
      if (!ref) return;
      if (ref.kind === "task") {
        toggleTaskComplete(ref.taskId);
      } else if (ref.kind === "subtask") {
        toggleSubtaskComplete(ref.taskId, ref.subtaskId);
      }
    };

    const submitQuickAdd = (
      key: string,
      board: BoardKind,
      assign:
        | { kind: "main" }
        | { kind: "extraMain" }
        | { kind: "slot"; slotKey: "workSlots" | "lifeSlots"; idx: number }
    ) => {
      const title = (quickDrafts[key] || "").trim();
      if (!title) return;
      createTodayTask(board, title, assign);
      setQuickDraft(key, "");
    };

    const quickAddField = (
      key: string,
      board: BoardKind,
      assign:
        | { kind: "main" }
        | { kind: "extraMain" }
        | { kind: "slot"; slotKey: "workSlots" | "lifeSlots"; idx: number },
      placeholder = "Or type a new task… (Enter)"
    ) => (
      <div className="today-quick-add screen-only">
        <input
          value={quickDrafts[key] || ""}
          onChange={(e) => setQuickDraft(key, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitQuickAdd(key, board, assign);
            }
          }}
          placeholder={placeholder}
        />
        <button
          className="tiny"
          type="button"
          onClick={() => submitQuickAdd(key, board, assign)}
          title="Create task and assign here"
        >
          <Plus size={14} />
        </button>
      </div>
    );

    const addSlot = (slotKey: "workSlots" | "lifeSlots") => {
      updateToday({ [slotKey]: [...plan[slotKey], { ref: null, done: false }] });
    };

    const removeSlot = (slotKey: "workSlots" | "lifeSlots", idx: number) => {
      if (plan[slotKey].length <= 3) return;
      const next = plan[slotKey].filter((_, i) => i !== idx);
      while (next.length < 3) next.push({ ref: null, done: false });
      updateToday({ [slotKey]: next });
    };

    const toggleExtraMode = () => {
      if (extraOn) {
        updateToday({ extraMode: false });
      } else {
        const work = [...plan.workSlots];
        const life = [...plan.lifeSlots];
        while (work.length < 3) work.push({ ref: null, done: false });
        while (life.length < 3) life.push({ ref: null, done: false });
        updateToday({
          extraMode: true,
          workSlots: work,
          lifeSlots: life,
          extraMainRef: plan.extraMainRef,
          extraMainDone: plan.extraMainDone,
          extraMainHoursLogged: plan.extraMainHoursLogged,
        });
      }
    };

    const slotRow = (
      slotKey: "workSlots" | "lifeSlots",
      pool: Task[],
      subPool: { key: string; ref: TodaySlotRef; label: string }[],
      idx: number,
      board: BoardKind
    ) => {
      const slot = plan[slotKey][idx];
      if (!slot) return null;
      const label = slotLabel(slot.ref);
      const optionValue = slotRefKey(slot.ref) || "";
      const canRemove = extraOn && plan[slotKey].length > 3;
      const isDone = Boolean(slot.done || refCompleted(slot.ref, state.tasks));

      if (isDone && slot.ref) {
        return (
          <div key={`${slotKey}-${idx}`} className="today-slot done">
            <span className="slot-num">{idx + 1}</span>
            <span className="today-slot-done-label">{label}</span>
            <button
              className="check"
              onClick={() => setSlotDone(slotKey, idx, false)}
              title={
                state.syncTodayCompletion
                  ? "Mark not done (updates Today & boards)"
                  : "Mark not done for today"
              }
            >
              <CheckSquare size={16} />
            </button>
            {canRemove && (
              <button className="icon screen-only" onClick={() => removeSlot(slotKey, idx)} title="Remove slot">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      }

      return (
        <div key={`${slotKey}-${idx}`} className="today-slot-block">
          <div className="today-slot">
            <span className="slot-num">{idx + 1}</span>
            <select
              value={optionValue}
              onChange={(e) => {
                const next = [...plan[slotKey]];
                next[idx] = { ref: parseSlotOption(e.target.value), done: false };
                updateToday({ [slotKey]: next });
              }}
            >
              <option value="">Pick a task or subtask…</option>
              {slotPickerOptions(pool, subPool, usedRefKeys, optionValue)}
            </select>
            {slot.ref && (
              <button
                className="check"
                onClick={() => setSlotDone(slotKey, idx, true)}
                title={
                  state.syncTodayCompletion
                    ? "Done (updates Today & boards)"
                    : "Done for today"
                }
              >
                <Square size={16} />
              </button>
            )}
            {canRemove && (
              <button className="icon screen-only" onClick={() => removeSlot(slotKey, idx)} title="Remove slot">
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {!slot.ref && quickAddField(`slot-${slotKey}-${idx}`, board, { kind: "slot", slotKey, idx })}
        </div>
      );
    };

    const hoursBarRows = (hours: number) => {
      const chunk = 3;
      const count = hours <= 0 ? 1 : Math.ceil(hours / chunk);
      return Array.from({ length: count }, (_, i) => {
        const start = i * chunk;
        const fill = Math.max(0, Math.min(chunk, hours - start));
        return {
          start,
          end: start + chunk,
          fill,
          pct: Math.round((fill / chunk) * 100),
        };
      });
    };

    const deepWorkBlock = (opts: {
      title: string;
      hint: string;
      refKey: string;
      label: string;
      done: boolean;
      hours: number;
      pool: Task[];
      subPool: { key: string; ref: TodaySlotRef; label: string }[];
      used: Set<string>;
      board: BoardKind;
      quickKey: string;
      isExtra?: boolean;
      className?: string;
    }) => {
      const {
        title,
        hint,
        refKey,
        label,
        hours,
        pool,
        subPool,
        used,
        board,
        quickKey,
        isExtra,
        className,
      } = opts;
      // In EXTRA mode both deep-work blocks can log past 3h; each 3h chunk gets its own bar row
      const allowOvertime = !!isExtra || extraOn;
      const ref = isExtra ? plan.extraMainRef : plan.mainRef;
      const taskIsComplete = refCompleted(ref, state.tasks);
      const rows = hoursBarRows(hours);
      const bumpHours = (delta: number) => {
        if (isExtra) {
          updateToday({ extraMainHoursLogged: Math.max(0, plan.extraMainHoursLogged + delta) });
          return;
        }
        if (allowOvertime) {
          updateToday({ mainHoursLogged: Math.max(0, plan.mainHoursLogged + delta) });
          return;
        }
        updateToday({ mainHoursLogged: Math.min(3, Math.max(0, plan.mainHoursLogged + delta)) });
      };
      const resetHours = () => {
        if (isExtra) updateToday({ extraMainHoursLogged: 0 });
        else updateToday({ mainHoursLogged: 0 });
      };

      return (
        <section className={`today-section today-main-block ${className || ""}`}>
          <h3>{title}</h3>
          <p className="muted tiny screen-only">{hint}</p>
          <select
            className="today-select screen-only"
            value={refKey}
            onChange={(e) => {
              const r = parseSlotOption(e.target.value);
              if (isExtra) {
                updateToday({ extraMainRef: r, extraMainHoursLogged: 0, extraMainDone: false });
              } else {
                updateToday({ mainRef: r, mainHoursLogged: 0, mainDone: false });
              }
            }}
          >
            <option value="">{isExtra ? "Choose extra deep-work task…" : "Choose main task or subtask…"}</option>
            {slotPickerOptions(pool, subPool, used, refKey)}
          </select>
          {!refKey && quickAddField(quickKey, board, isExtra ? { kind: "extraMain" } : { kind: "main" })}
          {ref && (
            <div className="hours-tracker screen-only">
              {rows.map((row, i) => (
                <div key={i} className="hours-row">
                  <div className="hours-bar" title={`Block ${i + 1}: ${row.start}–${row.end} h`}>
                    <div className="hours-fill" style={{ width: `${row.pct}%` }} />
                  </div>
                  <span className="muted tiny hours-row-label">
                    {row.fill.toFixed(1)} / 3 h
                    {rows.length > 1 ? ` · block ${i + 1}` : ""}
                  </span>
                </div>
              ))}
              <div className="row gap wrap">
                <span className="muted tiny">
                  Total {hours.toFixed(1)} h
                  {allowOvertime ? " (3h+ OK)" : " / 3 h"} — {label}
                </span>
                <div className="row gap wrap">
                  <button className="tiny" onClick={() => bumpHours(0.5)}>
                    +30m
                  </button>
                  <button className="tiny" onClick={() => bumpHours(1)}>
                    +1h
                  </button>
                  <button className="tiny" onClick={resetHours}>
                    Reset
                  </button>
                  <button
                    className={`tiny ${taskIsComplete ? "active" : ""}`}
                    onClick={() => toggleSlotRefComplete(ref)}
                    title={
                      taskIsComplete
                        ? "Task is marked complete on board. Click to unmark."
                        : "Mark task complete on board"
                    }
                  >
                    <CheckSquare size={13} /> {taskIsComplete ? "Task completed" : "Mark task complete"}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="today-print-only print-line">
            <strong>{isExtra ? "Extra deep work:" : "Deep work:"}</strong>{" "}
            {(isExtra ? plan.extraMainRef : plan.mainRef) ? (
              <span className={taskIsComplete ? "print-struck" : ""}>{label}</span>
            ) : (
              "_______________________________"
            )}{" "}
            ({hours.toFixed(1)} h
            {allowOvertime && hours > 3 ? `, ${rows.length} blocks` : ""})
          </div>
        </section>
      );
    };

    const printDate = nowDateTimeLabel();

    return (
      <div className="today-page">
        <div className="today-header row between wrap">
          <div>
            <h2 className={state.theme === "rainbow" ? "spectrum-text" : ""}>
              {extraOn ? "Today — 3·3·3 + EXTRA" : "Today — 3·3·3"}
            </h2>
            <p className="muted tiny">
              {extraOn
                ? "Extra mode: more than 3 work/life items + a second deep-work block"
                : "3 hours on your main task · 3 work · 3 life"}
            </p>
          </div>
          <div className="row gap wrap">
            <button
              className={`tiny ${extraOn ? "active" : ""}`}
              onClick={toggleExtraMode}
              title={
                extraOn
                  ? "Turn off EXTRA (keeps extra slots saved for today, but hides them)"
                  : "Allow more than 3 work/life items + extra deep work"
              }
            >
              EXTRA
            </button>
            <button
              className={`tiny ${state.syncTodayCompletion ? "active" : ""}`}
              onClick={() =>
                setStatePreserveScroll((s) => ({
                  ...s,
                  syncTodayCompletion: !s.syncTodayCompletion,
                }))
              }
              title={
                state.syncTodayCompletion
                  ? "Sync to boards: ON (checking items here also marks them complete on Work & Life boards)"
                  : "Sync to boards: OFF (checking items here only marks them done in Today)"
              }
            >
              <CheckSquare size={14} /> Sync to boards: {state.syncTodayCompletion ? "ON" : "OFF"}
            </button>
            <button
              className="tiny"
              onClick={resetCompletedToday}
              title="Clear completed tasks, completed deep work, and finished quick to-dos"
            >
              <RotateCcw size={14} /> Reset completed only
            </button>
            <button
              className="tiny"
              onClick={resetAllToday}
              title="Reset entire Today plan (clears all tasks, hours, and quick to-dos)"
            >
              <RotateCcw size={14} /> Reset
            </button>
            <button className="tiny" onClick={() => void downloadTodayPdf()} title="Download a PDF">
              <Printer size={14} /> PDF
            </button>
            <button className="tiny" onClick={downloadTodayTxt} title="Download a plain-text list (email-friendly)">
              <Download size={14} /> TXT
            </button>
          </div>
        </div>

        <div ref={todayPrintRef} className="today-print-sheet">
          <div className="today-print-only">
            <h1>{extraOn ? "Today — 3·3·3 + EXTRA" : "Today — 3·3·3"}</h1>
            <p>{printDate}</p>
          </div>

          {deepWorkBlock({
            title: extraOn ? "Deep work — 3+ hours" : "Deep work — 3 hours",
            hint: extraOn
              ? "Main focus block — in EXTRA mode you can log past 3 hours (new bar row each 3h)."
              : "One main task to protect your focus block.",
            refKey: mainRefKey,
            label: mainLabel,
            hours: plan.mainHoursLogged,
            pool: workPool,
            subPool: workSubPool,
            used: usedRefKeys,
            board: "work",
            quickKey: "main",
          })}

          <div className="today-grid">
            <section className="today-section">
              <div className="today-section-head row between">
                <h3>
                  <Briefcase size={16} /> {extraOn ? `${visibleWork.length} work` : "3 work"}
                </h3>
                {extraOn && (
                  <button className="tiny screen-only" onClick={() => addSlot("workSlots")} title="Add another work slot">
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>
              {visibleWork.map((_, i) => slotRow("workSlots", workPool, workSubPool, i, "work"))}
              <ol className="today-print-only">
                {visibleWork.map((s, i) => (
                  <li key={i} className={s.done ? "print-struck" : ""}>
                    {s.ref ? slotLabel(s.ref) : "_______________________________"}
                  </li>
                ))}
              </ol>
            </section>
            <section className="today-section">
              <div className="today-section-head row between">
                <h3>
                  <Home size={16} /> {extraOn ? `${visibleLife.length} life` : "3 life"}
                </h3>
                {extraOn && (
                  <button className="tiny screen-only" onClick={() => addSlot("lifeSlots")} title="Add another life slot">
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>
              {visibleLife.map((_, i) => slotRow("lifeSlots", lifePool, lifeSubPool, i, "life"))}
              <ol className="today-print-only">
                {visibleLife.map((s, i) => (
                  <li key={i} className={s.done ? "print-struck" : ""}>
                    {s.ref ? slotLabel(s.ref) : "_______________________________"}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {extraOn &&
            deepWorkBlock({
              title: "Extra deep work — 3+ hours",
              hint: "Optional second focus block — same main task or a new one. Past 3h adds another bar row.",
              refKey: extraMainRefKey,
              label: extraMainLabel,
              hours: plan.extraMainHoursLogged,
              pool: workPool,
              subPool: workSubPool,
              used: usedForExtraMain,
              board: "work",
              quickKey: "extraMain",
              isExtra: true,
              className: "today-extra-block",
            })}

          <section className="today-section today-simple-section">
            <h3>Quick to-dos</h3>
            <p className="muted tiny screen-only">
              Today scratch list — add, check off, no scoring. Copy anything important onto
              Work/Life boards to keep it.
            </p>
            <div className="today-simple-add screen-only">
              <input
                value={todoDraft}
                onChange={(e) => setTodoDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addSimpleTodo();
                }}
                placeholder="Add a quick to-do… (Enter)"
              />
              <button className="tiny" onClick={addSimpleTodo} title="Add to-do">
                <Plus size={14} /> Add
              </button>
            </div>
            {plan.simpleTodos.length > 0 ? (
              <ul className="today-simple-list">
                {plan.simpleTodos.map((item) => (
                  <li key={item.id} className={`today-simple-item ${item.done ? "done" : ""}`}>
                    <button
                      className="check screen-only"
                      onClick={() => toggleSimpleTodo(item.id)}
                      title={item.done ? "Mark not done" : "Mark done"}
                    >
                      {item.done ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span className={`today-simple-title ${item.done ? "print-struck" : "screen-only"}`}>
                      {item.done ? item.title : null}
                    </span>
                    {!item.done && (
                      <CommitInput
                        className="today-simple-title"
                        value={item.title}
                        onCommit={(txt) => updateSimpleTodoTitle(item.id, txt)}
                      />
                    )}
                    <button
                      className="icon screen-only"
                      onClick={() => deleteSimpleTodo(item.id)}
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted tiny screen-only">No quick to-dos yet.</p>
            )}
            {plan.simpleTodos.length > 0 && (
              <ul className="today-print-only">
                {plan.simpleTodos.map((item) => (
                  <li key={item.id} className={item.done ? "print-struck" : ""}>
                    {item.done ? "☑" : "☐"} {item.title}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="today-section today-quote-section screen-only">
          <h3>Inspirational quote</h3>
          <CommitTextarea
            className={`today-quote ${
              plan.inspirationalQuote?.trim() === DEFAULT_INSPIRATIONAL_QUOTE ? "is-default" : ""
            }`}
            value={plan.inspirationalQuote}
            onCommit={(txt) => updateToday({ inspirationalQuote: txt || DEFAULT_INSPIRATIONAL_QUOTE })}
            rows={3}
            placeholder='Paste a quote for today… e.g. "Do the next right thing."'
          />
        </section>
        <blockquote className="today-print-only today-quote-print">
          {plan.inspirationalQuote}
        </blockquote>
      </div>
    );
  }

  // --- Board ---
  function Board() {
    const [drafts, setDrafts] = useState<Record<Status, string>>({
      now: "",
      next: "",
      later: "",
    });
    const addDraft = (s: Status) => {
      const title = drafts[s].trim();
      if (!title) return;
      addTask(s, title);
      setDrafts((d) => ({ ...d, [s]: "" }));
    };
    const reorderAllowed = state.sortBy === "manual" && !state.focus;

    return (
      <div className="board">
        <DragDropContext
          onDragStart={(start) => setDraggingType(start.type)}
          onDragEnd={onDragEnd}
        >
          <div className="columns">
            {statuses.map((s) => {
              const list = filteredByStatus(s);
              const wip = state.wip[s];
              return (
                <div key={s} className="column" ref={(el) => { columnRefs.current[s] = el; }}>
                  <div className="col-header">
                    <div className="col-title">
                      <strong className="pill">{s.toUpperCase()}</strong>
                      <span className="muted">
                        {list.length} item{list.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="col-meta">
                      <span className="muted">
                        WIP {wip === 0 ? "∞" : wip} • move across columns •{" "}
                        {reorderAllowed ? "reorder on" : "reorder = Manual only"}
                      </span>
                      <button className="tiny" onClick={() => addTask(s)} title="Add task">
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Quick add */}
                  <div className="quickadd">
                    <input
                      value={drafts[s]}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addDraft(s);
                      }}
                      placeholder="Quick add… (Enter)"
                    />
                    <button className="tiny" onClick={() => addDraft(s)} title="Add">
                      Add
                    </button>
                  </div>

                  <Droppable droppableId={s} type="TASK" isDropDisabled={false}>
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className="tasklist">
                        {list.map((t, idx) => (
                          <Draggable key={t.id} draggableId={`task-${t.id}`} index={idx} isDragDisabled={false}>
                            {(prov, snap) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                className={`card ${blocked(t) ? "blocked" : ""} ${t.completed ? "done" : ""} ${
                                  snap.isDragging ? "dragging" : ""
                                } ${!isEdit ? "compact" : ""}`}
                              >
                                <span
                                  className="drag-handle"
                                  title="Drag to move"
                                  aria-label="Drag to move"
                                  {...prov.dragHandleProps}
                                >
                                  <GripVertical size={14} />
                                </span>
                                <div className="card-body">
                                  <TaskCard task={t} />
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      </div>
    );
  }

  function TaskCard({ task }: { task: Task }) {
    const w = state.weights;
    const ICE = importanceICE(task, w);
    const URG = urgencyW(task, w);
    const IU = ICE * URG;
    const short = { impact: "I", confidence: "C", ease: "E", urgency: "U" } as const;
    const due = dueBadge(task.due);
    const subs = (task.children || []).slice().sort((a, b) => a.order - b.order);
    const focusBoardSubs = state.focus && state.view === "board" && subs.length > 0;
    const subsDone = subs.filter((c) => c.completed).length;

    const subtasksSection = focusBoardSubs ? (
      <details className="subtasks-focus-dropdown">
        <summary>
          Subtasks ({subsDone}/{subs.length})
        </summary>
        <div className="subtasks-focus-list">
          {subs.map((c) => (
            <label key={c.id} className={`subtasks-focus-item ${c.completed ? "done" : ""}`}>
              <input
                type="checkbox"
                checked={c.completed}
                onChange={() => toggleSubtaskComplete(task.id, c.id)}
              />
              <span>{c.title}</span>
            </label>
          ))}
        </div>
      </details>
    ) : isEdit ? (
      <div className="list-section">
        <div className="row between">
          <strong>Subtasks</strong>
          <button className="tiny" onClick={() => addSubtask(task.id)}>
            <Plus size={14} /> Add
          </button>
        </div>
        <Droppable
          droppableId={`subtasks-${task.id}`}
          type="SUBTASK"
          isDropDisabled={state.sortBy !== "manual" || draggingType === "TASK"}
        >
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="subtasks">
              {subs.map((c, i) => (
                <Draggable
                  key={c.id}
                  draggableId={`subtask-${c.id}`}
                  index={i}
                  isDragDisabled={state.sortBy !== "manual"}
                >
                  {(prov) => (
                    <div
                      ref={prov.innerRef}
                      {...prov.draggableProps}
                      className="subtask"
                    >
                      <span
                        className="drag-handle"
                        title="Drag to reorder"
                        aria-label="Drag to reorder"
                        {...prov.dragHandleProps}
                      >
                        <GripVertical size={12} />
                      </span>
                      <button
                        className="check"
                        onClick={() => toggleSubtaskComplete(task.id, c.id)}
                        title={c.completed ? "Mark incomplete" : "Mark complete"}
                      >
                        {c.completed ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                      <CommitInput
                        className="subtask-title"
                        value={c.title}
                        onCommit={(txt) => {
                          const arr = (task.children || []).map((x) =>
                            x.id === c.id ? { ...x, title: txt, updatedAt: Date.now() } : x
                          );
                          updateTask(task.id, { children: arr });
                        }}
                      />
                      <button
                        className="icon"
                        onClick={() =>
                          updateTask(task.id, {
                            children: (task.children || []).filter((x) => x.id !== c.id),
                          })
                        }
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    ) : subs.length > 0 ? (
      <div className="overview-subtasks">
        {subs.slice(0, 6).map((c) => (
          <label key={c.id} className={`os-item ${c.completed ? "done" : ""}`}>
            <input
              type="checkbox"
              checked={c.completed}
              onChange={() => toggleSubtaskComplete(task.id, c.id)}
            />
            <span>{c.title}</span>
          </label>
        ))}
        {subs.length > 6 && <span className="muted tiny">+{subs.length - 6} more…</span>}
      </div>
    ) : null;

    return (
      <div>
        <div className="row between wrap">
          <div className="row gap flex1 min0">
            <button
              className="check"
              onClick={() => toggleTaskComplete(task.id)}
              title={task.completed ? "Mark incomplete" : "Mark complete"}
            >
              {task.completed ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
            <CommitInput
              className="title"
              value={task.title}
              onCommit={(txt) => updateTask(task.id, { title: txt })}
              placeholder="Task title"
            />
          </div>
          <div className="row gap">
            <select
              className="status-jump"
              value={task.status}
              onChange={(e) => moveTaskToStatus(task.id, e.target.value as Status)}
              title="Move to column"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {task.archived ? (
              <button className="tiny" onClick={() => unarchiveTask(task.id)} title="Restore from archive">
                Restore
              </button>
            ) : (
              <button className="icon" onClick={() => archiveTask(task.id)} title="Archive task">
                <Archive size={16} />
              </button>
            )}
            <button className="icon danger" onClick={() => deleteTask(task.id)} title="Delete task">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="row gap metrics-row" title="Fill = value ÷ max among currently visible tasks">
          {task.archived && <span className="badge">Archived</span>}
          {blocked(task) && (
            <span className="badge danger">
              <AlertTriangle size={14} /> Blocked
            </span>
          )}
          {due && <span className={`badge due-${due.tone}`}>{due.label}</span>}
          <span className="pill metric" style={heatICE(ICE)}>
            ICE {round2(ICE)}
          </span>
          <span className="pill metric" style={heatURG(URG)}>
            URG {round2(URG)}
          </span>
          <span className="pill metric" style={heatIU(IU)}>
            IU {round2(IU)}
          </span>
        </div>

        {isEdit ? (
          <>
            <CommitTextarea
              className="details"
              value={task.details || ""}
              onCommit={(txt) => updateTask(task.id, { details: txt })}
              placeholder="Details"
              rows={2}
            />

            <div className="sliders compact">
              {(["impact", "confidence", "ease", "urgency"] as const).map((k) => (
                <label key={k} className="slider">
                  <span title={k[0].toUpperCase() + k.slice(1)}>{short[k]}</span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={(task as any)[k]}
                    onChange={(e) => updateTask(task.id, { [k]: Number(e.target.value) } as any)}
                  />
                  <span className="val">{(task as any)[k]}</span>
                </label>
              ))}
            </div>

            <div className="grid fields">
              <label>
                Owner
                <CommitInput
                  value={task.owner || ""}
                  onCommit={(txt) => updateTask(task.id, { owner: txt })}
                />
              </label>
              <label>
                Tags (comma)
                <CommitInput
                  value={(task.tags || []).join(", ")}
                  onCommit={(txt) =>
                    updateTask(task.id, {
                      tags: txt
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                Due
                <CommitInput
                  type="date"
                  value={task.due ? new Date(task.due).toISOString().slice(0, 10) : ""}
                  onCommit={(val) =>
                    updateTask(task.id, { due: val ? new Date(val).getTime() : null })
                  }
                />
              </label>
              <label>
                Estimate (h)
                <CommitInput
                  type="number"
                  min={0}
                  step={0.25}
                  value={task.estimateH == null ? "" : String(task.estimateH)}
                  onCommit={(val) =>
                    updateTask(task.id, { estimateH: val === "" ? null : Number(val) })
                  }
                />
              </label>
            </div>

            <div className="deps">
              <div className="row between">
                <strong>Dependencies</strong>
                <select
                  onChange={(e) => {
                    const depId = e.target.value;
                    if (!depId || depId === task.id) return;
                    if ((task.deps || []).includes(depId)) return;
                    updateTask(task.id, { deps: [...(task.deps || []), depId] });
                    e.currentTarget.value = "";
                  }}
                  defaultValue=""
                >
                  <option value="">Add dep…</option>
                  {state.tasks
                    .filter(
                      (t) =>
                        t.id !== task.id && (t.board || "work") === (task.board || "work")
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </div>
              <div className="chips">
                {(task.deps || []).map((id) => (
                  <span key={id} className="chip">
                    {taskById.get(id)?.title || id}
                    <button
                      className="x"
                      onClick={() =>
                        updateTask(task.id, { deps: (task.deps || []).filter((d) => d !== id) })
                      }
                      title="Remove"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {subtasksSection}
      </div>
    );
  }

  // --- Matrix ---
  function Matrix() {
    const buckets = { HH: [] as Task[], HL: [] as Task[], LH: [] as Task[], LL: [] as Task[] };
    for (const t of allVisible) {
      const imp = importanceICE(t, state.weights);
      const urg = urgencyW(t, state.weights);
      if (imp >= thrImp && urg >= thrUrg) buckets.HH.push(t);
      else if (imp >= thrImp) buckets.HL.push(t);
      else if (urg >= thrUrg) buckets.LH.push(t);
      else buckets.LL.push(t);
    }
    const limiter = (arr: Task[]) =>
      state.focus ? [...arr].sort((a, b) => iuScore(b, state.weights) - iuScore(a, state.weights)).slice(0, 5) : arr;

    const Card = ({ t }: { t: Task }) => (
      <div className={`card mini ${blocked(t) ? "blocked" : ""}`}>
        <div className="row between">
          <span>{t.title}</span>
          <span className="pill metric" style={heatIU(iuScore(t, state.weights))}>
            IU {round2(iuScore(t, state.weights))}
          </span>
        </div>
        <div className="muted tiny">{t.owner || ""}</div>
      </div>
    );
    return (
      <div className="matrix">
        <div className="matrix-controls">
          <label title="Importance threshold">
            Imp≥{" "}
            <input
              type="number"
              step={0.1}
              value={round2(thrImp)}
              onChange={(e) =>
                setStatePreserveScroll((s) => ({
                  ...s,
                  thresholds: { ...s.thresholds, imp: Number(e.target.value) || 0 },
                }))
              }
            />
          </label>
          <label title="Urgency threshold">
            Urg≥{" "}
            <input
              type="number"
              step={0.1}
              value={round2(thrUrg)}
              onChange={(e) =>
                setStatePreserveScroll((s) => ({
                  ...s,
                  thresholds: { ...s.thresholds, urg: Number(e.target.value) || 0 },
                }))
              }
            />
          </label>
          <span className="muted tiny">
            {state.focus ? "Focus: top 5 per quadrant" : "Defaults use medians (set 0)."}
          </span>
        </div>
        <div className="grid-2">
          <div>
            <h4>High Imp / High Urg</h4>
            {limiter(buckets.HH).map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
          <div>
            <h4>High Imp / Low Urg</h4>
            {limiter(buckets.HL).map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
          <div>
            <h4>Low Imp / High Urg</h4>
            {limiter(buckets.LH).map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
          <div>
            <h4>Low Imp / Low Urg</h4>
            {limiter(buckets.LL).map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- Scatter ---
  const [selectedDot, setSelectedDot] = useState<string | null>(null);
  function Scatter() {
    const padding = 32,
      W = 900,
      H = 420;

    let data = allVisible.map((t) => ({
      id: t.id,
      title: t.title,
      titleStub: t.title.length > 16 ? t.title.slice(0, 14) + "…" : t.title,
      imp: importanceICE(t, state.weights),
      urg: urgencyW(t, state.weights),
      owner: t.owner || "",
      blocked: blocked(t),
      iu: iuScore(t, state.weights),
      defaultScores: hasDefaultScores(t),
    }));
    if (state.focus) {
      data = [...data].sort((a, b) => b.iu - a.iu).slice(0, 25);
    }

    const maxImp = Math.max(10, ...data.map((d) => d.imp));
    const maxUrg = Math.max(10, ...data.map((d) => d.urg));

    const x = (v: number) => padding + (v / (maxUrg || 1)) * (W - padding * 2);
    const y = (v: number) => H - padding - (v / (maxImp || 1)) * (H - padding * 2);

    return (
      <div className="scatter">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scatter plot">
          <line x1={padding} y1={H - padding} x2={W - padding} y2={H - padding} className="axis" />
          <line x1={padding} y1={H - padding} x2={padding} y2={padding} className="axis" />
          <line x1={x(thrUrg)} y1={padding} x2={x(thrUrg)} y2={H - padding} className="cross" />
          <line x1={padding} y1={y(thrImp)} x2={W - padding} y2={y(thrImp)} className="cross" />
          {data.map((d) => {
            const IU = d.imp * d.urg;
            const r = 4 + Math.log(IU + 1);
            const sel = selectedDot === d.id;
            const cx = x(d.urg),
              cy = y(d.imp);
            return (
              <g
                key={d.id}
                onClick={() => setSelectedDot(d.id)}
                className={`dot ${sel ? "selected" : ""} ${d.defaultScores ? "dot-default" : ""}`}
              >
                <circle cx={cx} cy={cy} r={r} />
                <text x={cx + r + 3} y={cy + 3} className="dot-label">
                  {d.titleStub}
                </text>
                <title>
                  {d.title} • Imp {round2(d.imp)} • Urg {round2(d.urg)} • IU {round2(IU)}
                </title>
                {d.blocked && (
                  <g transform={`translate(${cx + r + 4},${cy - r - 2})`}>
                    <title>Blocked</title>
                    <polygon points="0,10 10,10 5,0" className="tri" />
                    <line x1="5" y1="3" x2="5" y2="7" className="tri-mark" />
                    <circle cx="5" cy="9" r="0.8" className="tri-mark" />
                  </g>
                )}
              </g>
            );
          })}
          <text x={W - padding} y={H - padding + 20} className="tiny muted" textAnchor="end">
            Urgency →
          </text>
          <text x={padding - 18} y={padding} className="tiny muted" textAnchor="end">
            ↑ Importance (ICE)
          </text>
        </svg>
        {selectedDot && (
          <div className="info">
            <strong>{taskById.get(selectedDot)?.title}</strong>
            <div className="muted tiny">Owner: {taskById.get(selectedDot)?.owner || "—"}</div>
            <button className="tiny" onClick={() => setSelectedDot(null)}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    );
  }

  // --- Graph (Dependencies) ---
  function Graph() {
    const laneX: Record<Status, number> = { now: 80, next: 380, later: 680 };
    const laneW = 220,
      nodeH = 52;

    // Focus: show top 3 by IU per lane
    const byLane = (s: Status) =>
      allVisible
        .filter((t) => t.status === s)
        .sort((a, b) => iuScore(b, state.weights) - iuScore(a, state.weights))
        .slice(0, state.focus ? 3 : 9999);

    const nodes = ([] as Task[]).concat(...statuses.map(byLane));

    const yMap = new Map<string, number>();
    const laneCounts: Record<Status, number> = { now: 0, next: 0, later: 0 };
    for (const s of statuses) {
      nodes
        .filter((n) => n.status === s)
        .forEach((n, i) => {
          const y = 40 + i * (nodeH + 14);
          yMap.set(n.id, y);
          laneCounts[s]++;
        });
    }

    const W = 960;
    const H = 60 + Math.max(laneCounts.now, laneCounts.next, laneCounts.later) * (nodeH + 14);

    const nodeRect = (t: Task) => {
      const x = laneX[t.status];
      const y = yMap.get(t.id)!;
      const w = laneW;
      return { x, y, w };
    };

    // collect visible edges (only if both ends visible in focused set)
    const visibleIds = new Set(nodes.map((n) => n.id));
    const edges: Array<{ a: Task; b: Task; d: string }> = [];
    state.tasks.forEach((t) => {
      (t.deps || []).forEach((depId) => {
        const dep = taskById.get(depId);
        if (!dep) return;
        if (!visibleIds.has(dep.id) || !visibleIds.has(t.id)) return;
        const a = nodeRect(dep);
        const b = nodeRect(t);
        const x1 = a.x + a.w;
        const y1 = yMap.get(dep.id)! + nodeH / 2;
        const x2 = b.x;
        const y2 = yMap.get(t.id)! + nodeH / 2;
        const mid = x1 + (x2 - x1) / 2;
        const d = `M${x1},${y1} C ${mid},${y1} ${mid},${y2} ${x2},${y2}`;
        edges.push({ a: dep, b: t, d });
      });
    });

    return (
      <div className="graph">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dependency graph">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="edge" />
            </marker>
          </defs>
          {statuses.map((s) => (
            <g key={s}>
              <text x={laneX[s]} y={20} className="muted">
                {s.toUpperCase()}
              </text>
              <line
                x1={laneX[s] - 20}
                y1={24}
                x2={laneX[s] + laneW + 20}
                y2={24}
                className="lane"
              />
            </g>
          ))}

          {edges.map((e) => (
            <path
              key={`${e.a.id}->${e.b.id}`}
              d={e.d}
              className="edge"
              markerEnd="url(#arrow)"
            >
              <title>
                {taskById.get(e.a.id)?.title} → {taskById.get(e.b.id)?.title}
              </title>
            </path>
          ))}

          {nodes.map((t) => {
            const r = nodeRect(t);
            const isBlocked = blocked(t);
            return (
              <g key={t.id} transform={`translate(${r.x},${r.y})`}>
                <rect
                  rx="8"
                  ry="8"
                  width={r.w}
                  height={52}
                  className={`node ${isBlocked ? "blocked" : ""}`}
                />
                <text x={10} y={20} className="node-title">
                  {t.title}
                </text>
                <text x={10} y={36} className="tiny muted">
                  IU {round2(iuScore(t, state.weights))}
                </text>
              </g>
            );
          })}
        </svg>

        {edges.length === 0 && (
          <div className="empty-hint">
            No visible dependencies. Add deps or clear filters.
          </div>
        )}
      </div>
    );
  }

  /* =======================
     Header & Controls
  ======================= */
  const fileInputJSON = useRef<HTMLInputElement>(null);
  const fileInputCSV = useRef<HTMLInputElement>(null);

  const weightsRow = isEdit ? (
    <div className="weights">
      <div className="row gap">
        <Settings size={16} />
        <strong>Weights</strong>
      </div>
      {(["impact", "confidence", "ease", "urgency"] as const).map((k) => (
        <label key={k} className="slider tiny">
          <span>{k.toUpperCase()[0]}w</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={(state.weights as any)[k]}
            onChange={(e) =>
              setStatePreserveScroll((s) => ({
                ...s,
                weights: { ...s.weights, [k]: Number(e.target.value) },
              }))
            }
          />
          <span className="val">{(state.weights as any)[k]}</span>
        </label>
      ))}
      <div className="legend tiny muted" title="Metric abbreviations">
        I=Impact • C=Confidence • E=Ease • U=Urgency
      </div>
    </div>
  ) : null;

  return (
    <ErrorBoundary>
      <div className={`app mode-${state.mode}`}>
        <style>{css}</style>

        <header className="header">
          <div className="left row gap">
            <button
              type="button"
              className="profile-avatar"
              onClick={openPicker}
              title="Set profile picture"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" />
              ) : (
                <span className="profile-initial">{profileInitial}</span>
              )}
            </button>
            <img src="/parhelia-logo.png" alt="Parhelia Bio" className="brand-logo" />
            <div>
              <h1 className={state.section === "today" ? "today-brand" : ""}>
                {state.section === "today"
                  ? "Today"
                  : state.section === "life"
                    ? "Life"
                    : "Prioritizer"}
              </h1>
              <div className="muted tiny">
                {state.section === "today"
                  ? "3·3·3 productive day planner"
                  : state.section === "life"
                    ? "Personal & home tasks"
                    : "Now / Next / Later · ICE × Urgency"}
              </div>
            </div>
          </div>

          <div className="center">
            <nav className="section-nav row gap">
              {(
                [
                  ["today", "Today", Calendar],
                  ["work", "Work", Briefcase],
                  ["life", "Life", Home],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={`tiny ${state.section === id ? "active" : ""}`}
                  onClick={() => setStatePreserveScroll((s) => ({ ...s, section: id }))}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </nav>
            <div className="search">
              <SearchIcon size={16} />
              <input
                ref={searchRef}
                placeholder="Search (title, details, owner, tags, subtasks, deliverables)…"
                value={state.search}
                onChange={(e) => setStatePreserveScroll((s) => ({ ...s, search: e.target.value }))}
              />
            </div>
          </div>

          <div className="right row gap topbar">
            {state.section !== "today" && (
              <>
            <select
              className="top-select"
              value={state.mode}
              onChange={(e) => setStatePreserveScroll((s) => ({ ...s, mode: e.target.value as Mode }))}
              title="Mode"
            >
              <option value="overview">Overview</option>
              <option value="edit">Edit</option>
            </select>
            <select
              className="top-select"
              value={state.sortBy}
              onChange={(e) => setStatePreserveScroll((s) => ({ ...s, sortBy: e.target.value as SortBy }))}
              title="Sort"
            >
              <option value="manual">Manual</option>
              <option value="ice">ICE (importance)</option>
              <option value="urgency">Urgency</option>
              <option value="iu">ICE × Urgency</option>
            </select>
            <select
              className="top-select"
              value={state.view}
              onChange={(e) => setStatePreserveScroll((s) => ({ ...s, view: e.target.value as View }))}
              title="View"
            >
              <option value="board">Board</option>
              <option value="matrix">Matrix</option>
              <option value="scatter">Scatter</option>
              <option value="graph">Graph</option>
            </select>
              </>
            )}

            {/* Theme selector */}
            <select
              className="top-select top-select-small"
              value={state.theme}
              onChange={(e) =>
                setStatePreserveScroll((s) => ({ ...s, theme: e.target.value as Theme }))
              }
              title="Theme"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="ocean">Ocean</option>
              <option value="forest">Forest</option>
              <option value="rainbow">Rainbow</option>
            </select>

            <button className="top-icon" onClick={() => setHelpOpen(true)} title="How to use">
              <HelpCircle size={16} />
            </button>

            {authOn && !user && (
              <button className="top-toggle" onClick={openAuth} title="Sign in (optional)">
                <LogIn size={14} /> <span className="top-label">Sign in</span>
              </button>
            )}
            {user && (
              <button className="top-toggle" onClick={() => void signOut()} title="Sign out">
                <LogOut size={14} /> <span className="top-label">Sign out</span>
              </button>
            )}
            <button
              className={`top-icon ${state.celebrationsEnabled ? "active" : ""}`}
              onClick={() =>
                setStatePreserveScroll((s) => ({
                  ...s,
                  celebrationsEnabled: !s.celebrationsEnabled,
                  celebrationPromptShown: true,
                }))
              }
              title={
                state.celebrationsEnabled
                  ? "Celebrations on — click to disable"
                  : "Celebrations off — click to enable"
              }
            >
              🎉
            </button>
            <button
              className="top-toggle"
              onClick={() => setStatePreserveScroll((s) => ({ ...s, showArchived: !s.showArchived }))}
              title={state.showArchived ? "Hide archived tasks" : "Show archived tasks"}
            >
              <span className="top-label">{state.showArchived ? "Hide" : "Show"} archived</span>
            </button>
            {state.section !== "today" && (
            <button
              className={`top-toggle top-focus ${state.focus ? "active" : ""}`}
              onClick={() => setStatePreserveScroll((s) => ({ ...s, focus: !s.focus }))}
              title="Focus mode narrows results (Board: top-2/col • Matrix: top-5/quad • Scatter: top-25 • Graph: top-3/lane)"
            >
              <span className="top-label">Focus</span>
            </button>
            )}
            {state.section !== "today" && (
            <button
              className="top-toggle"
              onClick={() => setStatePreserveScroll((s) => ({ ...s, showCompleted: !s.showCompleted }))}
              title={state.showCompleted ? "Hide completed" : "Show completed"}
            >
              <span className="top-label">{state.showCompleted ? "Hide" : "Show"} done</span>
            </button>
            )}
          </div>
        </header>

        {/* ICE guide on Work / Life boards */}
        {(state.section === "work" || state.section === "life") && <IceHelpPanel />}
        {(state.section === "work" || state.section === "life") && <BoardPrintSheet />}

        {/* Toolbar */}
        {state.section !== "today" && (
        <div className="toolbar">
          <div className="row gap">
            {weightsRow}
            <div className="wips">
              <strong>WIP</strong>
              {statuses.map((s) => (
                <label key={s} className="wip">
                  <span>{s.toUpperCase()}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={state.wip[s]}
                    onChange={(e) =>
                      setStatePreserveScroll((st) => ({
                        ...st,
                        wip: {
                          ...st.wip,
                          [s]: Math.max(0, Number(e.target.value) || 0),
                        },
                      }))
                    }
                  />
                </label>
              ))}
              <span className="muted tiny">0 = unlimited</span>
            </div>
          </div>

          <div className="row gap">
            <div className="row gap">
              <button className="tiny" onClick={exportJSON} title="Download JSON">
                <Download size={14} /> JSON
              </button>
              <button className="tiny" onClick={exportCSV} title="Download CSV">
                <Download size={14} /> CSV
              </button>
              {(state.section === "work" || state.section === "life") && (
                <>
                  <button className="tiny" onClick={downloadBoardPdf} title="Download board as PDF">
                    <Printer size={14} /> PDF
                  </button>
                  <button className="tiny" onClick={downloadBoardTxt} title="Download a plain-text list (email-friendly)">
                    <Download size={14} /> TXT
                  </button>
                </>
              )}
              <button className="tiny" onClick={() => fileInputJSON.current?.click()} title="Upload JSON">
                <Upload size={14} /> JSON
              </button>
              <input
                ref={fileInputJSON}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJSON(f);
                  e.currentTarget.value = "";
                }}
              />
              <button className="tiny" onClick={() => fileInputCSV.current?.click()} title="Upload CSV">
                <Upload size={14} /> CSV
              </button>
              <input
                ref={fileInputCSV}
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importCSV(f);
                  e.currentTarget.value = "";
                }}
              />
            </div>
            <div className="row gap">
              <button
                className="tiny"
                onClick={() => setStatePreserveScroll((s) => ({ ...s, tasks: allSeedData().map(normalizeTask) }))}
                title="Reset example dataset"
              >
                Reset example
              </button>
              <button
                className="tiny"
                title="Start a new empty board (clears all tasks)"
                onClick={() => {
                  const ok = confirm(
                    "Start a NEW BOARD?\n\nThis will clear all tasks. (Use “Reset example” to reload the demo.)"
                  );
                  if (!ok) return;
                  setStatePreserveScroll((s) => ({ ...s, tasks: [] }));
                }}
              >
                New board (clear all)
              </button>
            </div>
          </div>
        </div>
        )}

        {/* View */}
        <main className={`main view-${state.view} section-${state.section}`}>
          {state.section === "today" && <TodayView />}
          {state.section !== "today" && state.view === "board" && <Board />}
          {state.section !== "today" && state.view === "matrix" && <Matrix />}
          {state.section !== "today" && state.view === "scatter" && <Scatter />}
          {state.section !== "today" && state.view === "graph" && <Graph />}
        </main>

        <footer className="learn-footer">
          <small className="muted tiny">Learn more about ICE scoring:</small>
          <a
            href="https://itamargilad.com/the-tool-that-will-help-you-choose-better-product-ideas/"
            target="_blank"
            rel="noopener noreferrer"
            className="learn-link"
            title="Itamar Gilad: The tool that will help you choose better product ideas"
          >
            How to think about ICE values →
          </a>
        </footer>

        {celebrationOpen && (
          <Celebration
            key={celebrationTick}
            variant={(celebrationTick - 1) % 3}
            onFinish={() => setCelebrationOpen(false)}
            onDisable={() => {
              setStatePreserveScroll((s) => ({
                ...s,
                celebrationsEnabled: false,
                celebrationPromptShown: true,
              }));
              setCelebrationOpen(false);
            }}
            showDisablePrompt={!state.celebrationPromptShown}
            onDismissPrompt={() => {
              setStatePreserveScroll((s) => ({ ...s, celebrationPromptShown: true }));
              setCelebrationOpen(false);
            }}
          />
        )}

        {helpOpen && (
          <div className="help-overlay" role="dialog" aria-modal="true">
            <button className="help-backdrop" onClick={() => setHelpOpen(false)} aria-label="Close help" />
            <div className="help-modal">
              <div className="row between">
                <div className="row gap">
                  <HelpCircle size={16} />
                  <strong>How to use</strong>
                </div>
                <button className="icon" onClick={() => setHelpOpen(false)} title="Close">
                  <X size={16} />
                </button>
              </div>

              <div className="help-body">
                <p className="muted tiny help-intro">
                  Prioritizer helps you plan today, score work with ICE, and keep Now / Next / Later
                  boards for team and personal tasks.
                </p>

                <h4>Navigation</h4>
                <ul className="help-list">
                  <li>
                    <strong>Today</strong> — 3·3·3 day planner (deep work + 3 work + 3 life).
                  </li>
                  <li>
                    <strong>Work</strong> — team / project board with ICE scoring.
                  </li>
                  <li>
                    <strong>Life</strong> — personal board, same tools, separate from work.
                  </li>
                  <li>
                    Use <strong>search</strong> to filter by title, details, owner, tags, or subtasks.
                  </li>
                </ul>

                <h4>Adding tasks</h4>
                <ul className="help-list">
                  <li>
                    On Work or Life boards: click <strong>+</strong> in a column header, or type in{" "}
                    <strong>Quick add</strong> and press Enter.
                  </li>
                  <li>
                    Shortcut <strong>N</strong> adds a task to Now (when not typing in a field).
                  </li>
                  <li>
                    <strong>/</strong> focuses search. <strong>1</strong> <strong>2</strong>{" "}
                    <strong>3</strong> jump to Now / Next / Later columns.
                  </li>
                  <li>
                    Switch to <strong>Edit</strong> mode to change titles, details, subtasks, due
                    dates, and scores.
                  </li>
                </ul>

                <h4>Scoring &amp; prioritizing (ICE)</h4>
                <ul className="help-list">
                  <li>
                    Each task has <strong>I</strong>mpact, <strong>C</strong>onfidence,{" "}
                    <strong>E</strong>ase, and <strong>U</strong>rgency (1–10). New tasks default to
                    3.
                  </li>
                  <li>
                    <strong>ICE</strong> ≈ I × C × E (weighted). <strong>IU</strong> = ICE × Urgency —
                    shown on each card.
                  </li>
                  <li>
                    Use <strong>Sort</strong>: Manual (drag order), ICE, Urgency, or ICE × Urgency to
                    reorder columns.
                  </li>
                  <li>
                    Adjust <strong>Weights</strong> in the toolbar if one dimension should matter more.
                  </li>
                  <li>
                    <strong>Matrix</strong> and <strong>Scatter</strong> views plot importance vs
                    urgency; <strong>Graph</strong> shows dependencies.
                  </li>
                  <li>
                    <strong>Focus</strong> narrows each view to top-ranked items so you see less noise.
                  </li>
                </ul>

                <h4>Board workflow</h4>
                <ul className="help-list">
                  <li>
                    Drag tasks between <strong>Now</strong>, <strong>Next</strong>, and{" "}
                    <strong>Later</strong>. Reordering within a column works in Manual sort only.
                  </li>
                  <li>
                    Set <strong>WIP</strong> limits per column (0 = unlimited) to avoid overload.
                  </li>
                  <li>
                    <strong>Hide done</strong> removes completed tasks from the board;{" "}
                    <strong>Show archived</strong> toggles archived items.
                  </li>
                  <li>Archive or delete from the card actions. Restore from archive when shown.</li>
                </ul>

                <h4>Today page</h4>
                <ul className="help-list">
                  <li>
                    Pick a <strong>main</strong> task or subtask for 3 hours of deep work; log time with
                    +30m / +1h. Or type a new task under the dropdown and press Enter.
                  </li>
                  <li>
                    Choose <strong>3 work</strong> and <strong>3 life</strong> items from your boards
                    (tasks or subtasks in one list).
                  </li>
                  <li>
                    Turn on <strong>EXTRA</strong> for more than 3 work/life slots plus a second deep-work
                    block (same main task or a new one, 3+ hours).
                  </li>
                  <li>
                    <strong>Sync to boards</strong> toggle controls whether completing tasks in Today
                    also marks them complete on your Work and Life boards.
                  </li>
                  <li>
                    <strong>Quick to-dos</strong> at the bottom are scratch items for today — no
                    scores. Clear them anytime with <strong>Reset</strong> or <strong>Reset completed only</strong>.
                  </li>
                  <li>
                    <strong>PDF / TXT</strong> export your day plan. Work/Life <strong>JSON / CSV / PDF / TXT</strong>
                    filenames include a time stamp so multiple exports the same day don’t overwrite.
                  </li>
                </ul>

                <h4>Other</h4>
                <ul className="help-list">
                  <li>
                    <strong>Sign in</strong> is optional — saves your board per account when configured.
                  </li>
                  <li>Import / export CSV from the toolbar for backup or spreadsheets.</li>
                  <li>Theme picker includes Rainbow and other color schemes.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

/* =======================
   CSS
======================= */
const css = `
:root {
  --bg: #0f1115; --bg-elev: #151821; --text: #e7e9ee; --muted: #a2a8b5;
  --card: #121521; --border: #2b3142; --accent: #7c3aed; --accent-weak: #7c3aed22;
  --danger: #ef4444; --ok: #14b8a6; --warn: #f59e0b;

  /* Metric colors — CONSISTENT across themes */
  --heat-imp: #16a34a;
  --heat-imp-weak: #16a34a22;
  --heat-urg: #ef4444;
  --heat-urg-weak: #ef444422;
  --heat-iu: #7c3aed;
  --heat-iu-weak: #7c3aed22;

  --edge: #707a91; --lane: #2a3040;
}
:root[data-theme="light"] {
  --bg: #f7f8fb; --bg-elev: #ffffff; --text: #14171f; --muted: #5b6272;
  --card: #ffffff; --border: #dde1ee; --accent: #7c3aed; --accent-weak: #7c3aed22; --danger: #dc2626;

  --heat-imp: #16a34a; --heat-imp-weak: #16a34a22;
  --heat-urg: #ef4444; --heat-urg-weak: #ef444422;
  --heat-iu: #7c3aed; --heat-iu-weak: #7c3aed22;

  --edge: #8890a6; --lane: #e7eaf4;
}
/* Ocean: deeper blues; pills keep G/R/P */
:root[data-theme="ocean"] {
  --bg: #0b1423; --bg-elev: #0f1a2b; --text: #e5f2ff; --muted: #9fb6d1;
  --card: #0f1a2b; --border: #203049; --accent: #27b0ff; --accent-weak: #27b0ff22; --danger: #ff6868;

  --heat-imp: #16a34a; --heat-imp-weak: #16a34a22;
  --heat-urg: #ef4444; --heat-urg-weak: #ef444422;
  --heat-iu: #7c3aed; --heat-iu-weak: #7c3aed22;

  --edge: #5a759a; --lane: #1a2a43;
}
/* Forest: mossy UI; pills keep G/R/P */
:root[data-theme="forest"] {
  --bg: #0c120c; --bg-elev: #111a11; --text: #e8ffe9; --muted: #9bc2a3;
  --card: #0f1710; --border: #223224; --accent: #62e46f; --accent-weak: #62e46f22; --danger: #f97373;

  --heat-imp: #16a34a; --heat-imp-weak: #16a34a22;
  --heat-urg: #ef4444; --heat-urg-weak: #ef444422;
  --heat-iu: #7c3aed; --heat-iu-weak: #7c3aed22;

  --edge: #58735e; --lane: #1a2a1b;
}
/* Rainbow: full spectrum — primaries, secondaries, tertiaries + pink */
:root[data-theme="rainbow"] {
  /* Primary */
  --rb-red: #ff2d55;
  --rb-yellow: #ffe600;
  --rb-blue: #2d9cff;
  /* Secondary */
  --rb-orange: #ff9500;
  --rb-green: #34e07e;
  --rb-violet: #9b5cff;
  /* Tertiary */
  --rb-red-orange: #ff6b2d;
  --rb-yellow-orange: #ffb800;
  --rb-yellow-green: #b8e62e;
  --rb-blue-green: #2ee8d0;
  --rb-blue-violet: #6b7aff;
  --rb-red-violet: #d94dff;
  /* Extra pink */
  --rb-pink: #ff5ebf;
  --rb-hot-pink: #ff3dad;
  --rb-blush: #ff9ed8;

  --bg: #100828;
  --bg-elev: #1a1042;
  --text: #fffafd;
  --muted: #f5dfff;
  --card: #22124f;
  --border: #ff5ebf;
  --accent: #ff3dad;
  --accent-weak: #ff3dad30;
  --danger: #ff4466;
  --warn: #ffc400;
  --ok: #34e07e;

  --heat-imp: #34e07e;
  --heat-imp-weak: #34e07e40;
  --heat-urg: #ff4466;
  --heat-urg-weak: #ff446640;
  --heat-iu: #b87aff;
  --heat-iu-weak: #b87aff40;

  --edge: #9b5cff;
  --lane: #3d2080;
}

/* Rainbow theme: keep Graph view less pink */
:root[data-theme="rainbow"] .graph {
  --edge: #6b7aff;
  --lane: #2a2f55;
}

html[data-theme="rainbow"] body {
  background:
    radial-gradient(ellipse 80% 50% at 10% 0%, rgba(255, 45, 85, 0.22), transparent 55%),
    radial-gradient(ellipse 70% 45% at 90% 8%, rgba(45, 156, 255, 0.2), transparent 50%),
    radial-gradient(ellipse 60% 40% at 50% 100%, rgba(255, 62, 173, 0.18), transparent 55%),
    radial-gradient(ellipse 50% 35% at 20% 60%, rgba(255, 230, 0, 0.1), transparent 45%),
    radial-gradient(ellipse 45% 30% at 80% 70%, rgba(52, 224, 126, 0.12), transparent 45%),
    linear-gradient(165deg, #0c0620 0%, #140a32 35%, #1a1048 65%, #280e38 100%);
  background-attachment: fixed;
}

:root[data-theme="rainbow"] .app {
  position: relative;
}

:root[data-theme="rainbow"] h1:not(.spectrum-text) {
  background: linear-gradient(
    95deg,
    var(--rb-hot-pink) 0%,
    var(--rb-red) 12%,
    var(--rb-orange) 28%,
    var(--rb-yellow) 42%,
    var(--rb-green) 58%,
    var(--rb-blue) 72%,
    var(--rb-violet) 88%,
    var(--rb-pink) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.spectrum-text {
  background: linear-gradient(
    90deg,
    #ff0000 0%,
    #ff7f00 16%,
    #ffff00 32%,
    #00ff00 48%,
    #0000ff 64%,
    #4b0082 80%,
    #8f00ff 96%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
:root[data-theme="rainbow"] .spectrum-text {
  background-size: 200% 100%;
  animation: spectrum-shift 6s linear infinite;
}
@keyframes spectrum-shift {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}


:root[data-theme="rainbow"] .profile-avatar {
  border: 2px solid transparent;
  background:
    linear-gradient(var(--bg-elev), var(--bg-elev)) padding-box,
    linear-gradient(
      135deg,
      var(--rb-red),
      var(--rb-orange),
      var(--rb-yellow),
      var(--rb-green),
      var(--rb-blue-green),
      var(--rb-blue),
      var(--rb-violet),
      var(--rb-pink)
    ) border-box;
}

:root[data-theme="rainbow"] .search {
  border: 2px solid transparent;
  background:
    linear-gradient(var(--bg-elev), var(--bg-elev)) padding-box,
    linear-gradient(90deg, var(--rb-pink), var(--rb-yellow), var(--rb-blue-green), var(--rb-violet)) border-box;
}

:root[data-theme="rainbow"] .section-nav .tiny:nth-child(1).active {
  border-color: var(--rb-hot-pink);
  background: rgba(255, 61, 173, 0.28);
  color: #fff;
  box-shadow: 0 0 12px rgba(255, 94, 191, 0.45);
}
:root[data-theme="rainbow"] .section-nav .tiny:nth-child(2).active {
  border-color: var(--rb-blue);
  background: rgba(45, 156, 255, 0.25);
  color: #fff;
  box-shadow: 0 0 12px rgba(45, 156, 255, 0.4);
}
:root[data-theme="rainbow"] .section-nav .tiny:nth-child(3).active {
  border-color: var(--rb-green);
  background: rgba(52, 224, 126, 0.22);
  color: #fff;
  box-shadow: 0 0 12px rgba(52, 224, 126, 0.35);
}

:root[data-theme="rainbow"] .board .columns .column:nth-child(1) {
  border-color: var(--rb-red);
  box-shadow: 0 0 0 1px rgba(255, 45, 85, 0.35) inset, 0 4px 20px rgba(255, 45, 85, 0.12);
}
:root[data-theme="rainbow"] .board .columns .column:nth-child(2) {
  border-color: var(--rb-yellow-orange);
  box-shadow: 0 0 0 1px rgba(255, 184, 0, 0.35) inset, 0 4px 20px rgba(255, 149, 0, 0.12);
}
:root[data-theme="rainbow"] .board .columns .column:nth-child(3) {
  border-color: var(--rb-blue-violet);
  box-shadow: 0 0 0 1px rgba(107, 122, 255, 0.35) inset, 0 4px 20px rgba(45, 156, 255, 0.12);
}

:root[data-theme="rainbow"] .board .columns .column:nth-child(1) .col-header .pill {
  color: var(--rb-red);
  border-color: var(--rb-red);
  background: rgba(255, 45, 85, 0.15);
}
:root[data-theme="rainbow"] .board .columns .column:nth-child(2) .col-header .pill {
  color: var(--rb-orange);
  border-color: var(--rb-orange);
  background: rgba(255, 149, 0, 0.15);
}
:root[data-theme="rainbow"] .board .columns .column:nth-child(3) .col-header .pill {
  color: var(--rb-blue);
  border-color: var(--rb-blue);
  background: rgba(45, 156, 255, 0.15);
}

:root[data-theme="rainbow"] .card {
  border-color: rgba(255, 94, 191, 0.35);
  background: linear-gradient(145deg, rgba(34, 18, 79, 0.95), rgba(40, 22, 90, 0.88));
}
:root[data-theme="rainbow"] .card:hover {
  border-color: var(--rb-pink);
}

:root[data-theme="rainbow"] .tiny.active {
  border-color: var(--rb-hot-pink);
  background: rgba(255, 61, 173, 0.22);
  box-shadow: 0 0 10px rgba(255, 94, 191, 0.35);
}

:root[data-theme="rainbow"] .tiny:hover {
  border-color: var(--rb-blush);
}

:root[data-theme="rainbow"] a,
:root[data-theme="rainbow"] .learn-link {
  color: var(--rb-blue-green);
}
:root[data-theme="rainbow"] a:hover {
  color: var(--rb-pink);
}

:root[data-theme="rainbow"] .today-main-block {
  border: 2px solid var(--rb-hot-pink);
  box-shadow:
    0 0 0 2px rgba(255, 61, 173, 0.2),
    0 0 28px rgba(255, 149, 0, 0.15),
    0 0 40px rgba(45, 156, 255, 0.1);
  background: linear-gradient(135deg, rgba(255, 61, 173, 0.08), rgba(45, 156, 255, 0.06));
}

:root[data-theme="rainbow"] .today-section {
  border-color: rgba(155, 92, 255, 0.45);
  background: linear-gradient(160deg, rgba(34, 18, 79, 0.9), rgba(26, 16, 66, 0.85));
}

:root[data-theme="rainbow"] .today-grid .today-section:first-child {
  border-color: var(--rb-blue);
  box-shadow: 0 0 16px rgba(45, 156, 255, 0.12);
}
:root[data-theme="rainbow"] .today-grid .today-section:last-child {
  border-color: var(--rb-green);
  box-shadow: 0 0 16px rgba(52, 224, 126, 0.12);
}

:root[data-theme="rainbow"] .today-quote-section {
  border: 2px dashed var(--rb-violet);
  background: linear-gradient(120deg, rgba(217, 77, 255, 0.08), rgba(255, 94, 191, 0.1));
}

:root[data-theme="rainbow"] .ice-help {
  border: 2px solid transparent;
  background:
    linear-gradient(var(--bg-elev), var(--bg-elev)) padding-box,
    linear-gradient(
      120deg,
      var(--rb-green),
      var(--rb-yellow-green),
      var(--rb-blue-green),
      var(--rb-blue),
      var(--rb-violet),
      var(--rb-pink)
    ) border-box;
}

:root[data-theme="rainbow"] .weights,
:root[data-theme="rainbow"] .wips {
  border-color: var(--rb-blue-violet);
  background: rgba(26, 16, 66, 0.85);
}

:root[data-theme="rainbow"] .hours-fill {
  background: linear-gradient(90deg, var(--rb-pink), var(--rb-orange), var(--rb-yellow), var(--rb-green));
}

:root[data-theme="rainbow"] input[type="range"] {
  accent-color: var(--rb-hot-pink);
}

:root[data-theme="rainbow"] .scatter svg {
  border: 2px solid transparent;
  background:
    linear-gradient(var(--bg-elev), var(--bg-elev)) padding-box,
    linear-gradient(135deg, var(--rb-red-orange), var(--rb-yellow), var(--rb-blue-green), var(--rb-violet), var(--rb-pink)) border-box;
}

:root[data-theme="rainbow"] .dot circle {
  fill: var(--rb-hot-pink);
}
:root[data-theme="rainbow"] .dot.dot-default circle {
  fill: color-mix(in srgb, var(--rb-violet) 40%, #9ca3af);
}

:root[data-theme="rainbow"] .matrix .grid-2 > div:nth-child(1) { border-color: var(--rb-green); }
:root[data-theme="rainbow"] .matrix .grid-2 > div:nth-child(2) { border-color: var(--rb-yellow-green); }
:root[data-theme="rainbow"] .matrix .grid-2 > div:nth-child(3) { border-color: var(--rb-orange); }
:root[data-theme="rainbow"] .matrix .grid-2 > div:nth-child(4) { border-color: var(--rb-red-violet); }

* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 12.5px/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial; }
h1,h2,h3,h4 { margin: 0; }
button, input, select, textarea { font: inherit; color: inherit; background: transparent; }
a { color: var(--accent); text-decoration: none; }

.app { width: 100%; max-width: 100%; margin: 0 auto; padding: 12px 16px; }

.header { display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 12px; align-items: center; margin-bottom: 8px; }
.left { display: flex; align-items: center; gap: 8px; }
.center { display: flex; justify-content: center; }
.right { display: flex; justify-content: flex-end; }
.topbar { align-items: center; flex-wrap: wrap; gap: 8px; }
.top-select {
  font-size: 12px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-elev) 72%, transparent);
  min-height: 30px;
}
.top-select:hover { border-color: var(--accent); }
.top-select:focus { outline: 2px solid var(--accent-weak); outline-offset: 1px; }
.top-select-small { padding: 6px 8px; opacity: 0.9; }

.top-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  color: var(--muted);
  min-height: 30px;
}
.top-toggle:hover {
  border-color: var(--border);
  color: var(--text);
  background: color-mix(in srgb, var(--bg-elev) 45%, transparent);
}
.top-toggle.active { border-color: var(--accent); color: var(--text); background: var(--accent-weak); }

.top-icon {
  width: 34px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: transparent;
  cursor: pointer;
}
.top-icon:hover { border-color: var(--border); background: color-mix(in srgb, var(--bg-elev) 45%, transparent); }
.top-icon.active { border-color: var(--accent); background: var(--accent-weak); }

.top-focus { font-weight: 700; color: var(--text); border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); }
.top-focus:not(.active) { background: color-mix(in srgb, var(--bg-elev) 55%, transparent); }

.top-label { white-space: nowrap; }

.today-brand { color: #2d9cff; }
:root[data-theme="dark"] .today-brand { color: #27b0ff; }

.logo { width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: var(--border); display:flex; align-items:center; justify-content:center; }
.logo img { width: 100%; height: 100%; object-fit: cover; }
.profile-avatar {
  width: 40px; height: 40px; border-radius: 50%; overflow: hidden;
  border: 2px solid var(--border); background: var(--bg-elev);
  padding: 0; cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.profile-initial { font-size: 15px; font-weight: 700; color: var(--muted); }
.brand-logo { height: 36px; width: auto; object-fit: contain; flex-shrink: 0; }
.avatar-fallback { font-size: 10px; color: var(--muted); }

.search { display: flex; align-items: center; gap: 6px; background: var(--bg-elev); border: 1px solid var(--border); padding: 6px 8px; border-radius: 10px; width: 100%; max-width: 680px; }
.search input { border: none; outline: none; width: 100%; }

.row { display: flex; align-items: center; }
.row.gap { gap: 8px; }
.row.between { justify-content: space-between; width: 100%; }
.wrap { flex-wrap: wrap; }
.flex1 { flex: 1; }
.min0 { min-width: 0; }

.tiny { font-size: 11px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); cursor: pointer; }
.tiny.active { background: var(--accent-weak); border-color: var(--accent); }
.icon { border: none; background: transparent; padding: 2px; cursor: pointer; color: var(--muted); }
.icon.danger { color: var(--danger); }

.pill { display: inline-flex; gap: 6px; align-items: center; padding: 2px 8px; border-radius: 999px; background: var(--bg-elev); border: 1px solid var(--border); }
.pill.metric { background: transparent; }
.badge { display: inline-flex; gap: 4px; align-items: center; padding: 2px 8px; border-radius: 999px; background: var(--bg-elev); border: 1px solid var(--border); }
.badge.danger { color: var(--danger); border-color: var(--danger); background: transparent; }

.muted { color: var(--muted); }
.tiny { font-size: 11px; }

.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0 12px; }
.weights { display:flex; align-items:center; gap: 8px; background: var(--bg-elev); border:1px solid var(--border); padding: 6px 10px; border-radius: 10px; }
.legend { margin-left: 8px; }

.slider { display: grid; grid-template-columns: 20px 140px 28px; gap: 6px; align-items: center; }
.slider.tiny { grid-template-columns: 24px 100px 28px; }
.slider input[type="range"] { width: 100%; }
.val { text-align: right; color: var(--muted); }

.wips { display: flex; align-items: center; gap: 8px; background: var(--bg-elev); border:1px solid var(--border); padding: 6px 10px; border-radius: 10px; }
.wip { display:flex; align-items:center; gap: 6px; }
.wip input { width: 60px; padding: 4px; border:1px solid var(--border); border-radius: 8px; background: var(--bg-elev); }

.main { display: block; }
.board .columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%; }
@media (max-width: 980px) { .board .columns { grid-template-columns: repeat(2, minmax(0, 1fr)); } .header{grid-template-columns: 1fr;} .center{order:3} .right{order:2; justify-content:flex-start;} }
@media (max-width: 640px) { .board .columns { grid-template-columns: 1fr; } }

.column { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 12px; display:flex; flex-direction: column; min-height: 120px; }
.col-header { display:flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px dashed var(--border); }
.col-title { display:flex; align-items:center; gap:8px; }
.col-meta { display:flex; align-items:center; gap:6px; }
.tasklist { padding: 8px; display:flex; flex-direction: column; gap: 8px; min-height: 80px; }

/* Quick add */
.quickadd { display:flex; gap: 6px; padding: 8px; border-bottom: 1px dashed var(--border); }
.quickadd input { flex: 1; padding: 6px 8px; border:1px solid var(--border); border-radius: 8px; background: transparent; }

/* Cards */
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 8px; display:flex; flex-direction: row; align-items: flex-start; gap: 4px; }
.card-body { flex: 1; min-width: 0; display:flex; flex-direction: column; gap: 6px; }
.drag-handle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  width: 22px;
  min-height: 36px;
  margin-top: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: grab;
}
.status-jump {
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-transform: uppercase;
}
.drag-handle:hover { color: var(--text); background: color-mix(in srgb, var(--bg-elev) 70%, transparent); }
.drag-handle:active { cursor: grabbing; }
.board .card { font-size: 12px; }
.board .card .title { font-size: 13px; }
.pill.metric { font-size: 11px; }
.card.compact { padding: 6px; gap: 4px; }
.card.dragging { outline: 2px solid var(--accent); }
.card.blocked { box-shadow: 0 0 0 2px var(--danger) inset; }
.card.done { opacity: 0.6; }
.card.mini { padding: 8px; }

.metrics-row { flex-wrap: wrap; }
.title { border: none; background: transparent; font-weight: 600; width: 100%; min-width: 0; }
.details { width: 100%; padding: 6px; border: 1px solid var(--border); border-radius: 8px; background: transparent; resize: vertical; }
.check { border: none; background: transparent; cursor: pointer; color: var(--muted); }

.sliders.compact .slider { grid-template-columns: 16px 1fr 28px; }

.fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.fields label { font-size: 11px; display:flex; flex-direction: column; gap: 4px; }
.fields input { padding: 6px; border:1px solid var(--border); border-radius: 8px; background: transparent; }

.deps .chips { display:flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--border); background: var(--bg-elev); padding: 2px 8px; border-radius: 999px; }
.chip .x { border:none; background:transparent; cursor:pointer; color: var(--muted); padding:2px; }

.list-section { margin-top: 8px; }
.subtasks { display:flex; flex-direction: column; gap: 6px; }
.subtask { display:flex; align-items:center; gap: 6px; border:1px dashed var(--border); border-radius: 8px; padding: 4px 6px; }
.subtask-title { flex: 1; border:none; background: transparent; }
.subtask-title.done { text-decoration: line-through; color: var(--muted); }

/* Overview subtasks (dense) */
.overview-subtasks { display:flex; flex-wrap: wrap; gap: 6px; }
.os-item { display:inline-flex; align-items:center; gap:6px; padding:2px 6px; border:1px solid var(--border); border-radius: 999px; background: var(--bg-elev); font-size: 11px; }
.os-item.done { opacity: 0.7; }
.os-item input { accent-color: var(--accent); }

.subtasks-focus-dropdown {
  margin-top: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 8px;
  background: color-mix(in srgb, var(--bg-elev) 60%, transparent);
}
.subtasks-focus-dropdown summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--muted);
  list-style: none;
}
.subtasks-focus-dropdown summary::-webkit-details-marker { display: none; }
.subtasks-focus-list { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.subtasks-focus-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 2px 0;
}
.subtasks-focus-item.done { opacity: 0.65; text-decoration: line-through; }

.board-print-sheet {
  position: fixed;
  left: 0;
  top: 0;
  z-index: -1;
  opacity: 0;
  pointer-events: none;
  width: 900px;
  background: #fff;
  color: #111;
  padding: 28px 32px;
  font-size: 13px;
  line-height: 1.45;
}
.board-print-sheet .print-struck { text-decoration: line-through; opacity: 0.65; }
.board-print-sheet h1 { font-size: 22px; margin: 0 0 6px; color: #111; }
.board-print-sheet h2 { font-size: 14px; margin: 0 0 8px; text-transform: uppercase; color: #333; }
.board-print-meta { margin: 0 0 4px; color: #555; font-size: 12px; }
.board-print-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
.board-print-col { border: 1px solid #ccc; border-radius: 8px; padding: 10px 12px; }
.board-print-col ul { margin: 0; padding-left: 18px; }
.board-print-col li { margin: 8px 0; }
.board-print-scores { display: block; font-size: 11px; color: #555; margin-top: 2px; }
.board-print-subs { margin-top: 4px; padding-left: 16px; font-size: 11px; color: #444; }
.board-print-empty { margin: 0; color: #888; }

.learn-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 16px;
}
.learn-link { font-size: 12px; color: var(--accent); text-decoration: none; }
.learn-link:hover { text-decoration: underline; }

.deliverables { display:flex; flex-direction: column; gap: 6px; }
.deliverable { display:grid; grid-template-columns: 20px 1fr 1fr auto; gap: 6px; align-items:center; }
.del-label { width: 100%; border:1px solid var(--border); border-radius:8px; padding: 4px 6px; background: transparent; }
.del-url { width: 100%; border:1px solid var(--border); border-radius:8px; padding: 4px 6px; background: transparent; }
.del-label.done { text-decoration: line-through; color: var(--muted); }

/* Matrix / Scatter */
.matrix .matrix-controls { display:flex; align-items:center; gap: 8px; margin-bottom: 8px; }
.grid-2 { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.grid-2 > div { background: var(--bg-elev); border:1px solid var(--border); border-radius: 12px; padding: 8px; min-height: 80px; }

.scatter svg { background: var(--bg-elev); border:1px solid var(--border); border-radius: 12px; }
svg text { fill: var(--text); }
svg .muted { fill: var(--muted); }
.axis { stroke: var(--border); stroke-width: 1; }
.cross { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; }
.dot circle { fill: var(--accent); opacity: 0.9; }
.dot.dot-default circle { fill: color-mix(in srgb, var(--accent) 50%, #9ca3af); opacity: 0.75; }
.dot.selected circle { stroke: var(--text); stroke-width: 1; }
.dot-label { font-size: 9px; fill: var(--muted); pointer-events: none; }
.tri { fill: var(--danger); }
.tri-mark { stroke: #fff; stroke-width: 1; }
.info { margin-top: 6px; padding: 6px 8px; border:1px solid var(--border); border-radius: 10px; background: var(--bg-elev); }

/* Graph */
.graph svg { background: var(--bg-elev); border:1px solid var(--border); border-radius: 12px; }
.lane { stroke: var(--lane); stroke-width: 1; }
.edge { fill: none; stroke: var(--edge); stroke-width: 1.4; }
.node { fill: var(--card); stroke: var(--border); stroke-width: 1.4; }
.node.blocked { stroke: var(--danger); stroke-width: 2; }
.node-title { font-weight: 600; }
.empty-hint { margin-top: 8px; padding: 8px 10px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); background: var(--bg-elev); }

/* Section nav & Today */
.center { flex-direction: column; gap: 8px; align-items: stretch; }
.section-nav { justify-content: center; flex-wrap: wrap; }
.section-nav .tiny { display: inline-flex; align-items: center; gap: 4px; }
.badge.due-danger { color: var(--danger); border-color: var(--danger); background: transparent; }
.badge.due-warn { color: var(--warn); border-color: var(--warn); background: transparent; }
.badge.due-accent { color: var(--accent); border-color: var(--accent); background: transparent; }

.today-page { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.today-header h2 { font-size: 20px; margin-bottom: 4px; }
.today-section { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
.today-section h3 { font-size: 14px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.today-main-block { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-weak) inset; }
.today-select, .today-slot select { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); margin-top: 6px; }
.today-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px) { .today-grid { grid-template-columns: 1fr; } }
.today-slot-block { margin-top: 8px; }
.today-slot { display: grid; grid-template-columns: 24px 1fr auto auto; gap: 8px; align-items: center; }
.today-slot.done { margin-top: 8px; }
.today-quick-add {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  margin-left: 32px;
}
.today-quick-add input {
  flex: 1;
  padding: 6px 8px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: transparent;
  font-size: 12px;
}
.today-extra-block {
  margin-top: 12px;
  border-style: dashed;
}
.slot-num { font-weight: 700; color: var(--muted); text-align: center; }
.hours-tracker { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.hours-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
.hours-row-label { white-space: nowrap; }
.hours-bar { height: 8px; background: var(--border); border-radius: 999px; overflow: hidden; }
.hours-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width 0.2s ease; }
.today-hint kbd { font: inherit; font-size: 10px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-elev); }
.today-slot.done .today-slot-done-label { text-decoration: line-through; opacity: 0.75; color: var(--muted); }
.today-main-done { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.today-slot-done-label { flex: 1; min-width: 0; padding: 8px 0; }
.today-section-head { margin-bottom: 4px; align-items: center; gap: 12px; }
.today-mode-row { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.today-mode-label { font-size: 11px; white-space: nowrap; }
.today-mode-select { padding: 4px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); font-size: 11px; min-width: 108px; }
.today-header { align-items: flex-start; margin-bottom: 4px; }
.today-quote { width: 100%; margin-top: 6px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: transparent; resize: vertical; font-style: italic; line-height: 1.5; }
.today-quote-section { border-style: dashed; }
.today-quote-print { margin-top: 16px; font-style: italic; font-size: 14px; line-height: 1.5; padding: 12px; border-top: 1px solid #ccc; }

.today-simple-section { margin-top: 4px; }
.today-simple-add { display: flex; gap: 8px; margin-top: 8px; }
.today-simple-add input { flex: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); }
.today-simple-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.today-simple-item { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; }
.today-simple-item.done .today-simple-title { color: var(--muted); }
.today-simple-title { width: 100%; border: none; background: transparent; padding: 4px 0; }
.today-simple-title:focus { outline: none; border-bottom: 1px solid var(--border); }
.today-simple-section .today-print-only { color: #111; background: transparent; }
.today-simple-section .today-print-only li { margin: 6px 0; font-size: 14px; }

.ice-help {
  margin: 0 0 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);
}
.ice-help-lead { margin: 6px 0 10px; }
.ice-defs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 0 0 10px; }
.ice-defs dt { font-weight: 600; font-size: 12px; margin: 0; }
.ice-defs dd { margin: 2px 0 0; font-size: 11px; color: var(--muted); }
@media (max-width: 720px) { .ice-defs { grid-template-columns: 1fr; } }

.today-print-only { display: none; }
.screen-only { display: block; }
.print-struck { text-decoration: line-through; }

.today-quote.is-default { color: var(--muted); }

.help-overlay { position: fixed; inset: 0; z-index: 2100; display: grid; place-items: center; }
.help-backdrop { position: fixed; inset: 0; background: rgba(8, 10, 24, 0.55); backdrop-filter: blur(3px); border: none; }
.help-modal { width: min(760px, calc(100vw - 24px)); max-height: min(82vh, 760px); overflow: auto; background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 14px; box-shadow: 0 30px 90px rgba(0,0,0,0.45); position: relative; }
.help-body { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
.help-intro { margin: 0 0 4px; line-height: 1.5; }
.help-body h4 { margin: 0; font-size: 13px; }
.help-list { margin: 0; padding-left: 18px; color: var(--muted); }
.help-list li { margin: 6px 0; }

@media print {
  .header, .toolbar, .learn-footer, .today-hint, .screen-only, .ice-help { display: none !important; }
  .today-print-only { display: block !important; }
  .today-print-sheet { max-width: 100%; }
  .today-page { max-width: 100%; padding: 0; }
  .today-section { break-inside: avoid; border: 1px solid #ccc; margin-bottom: 12px; }
  .today-grid { display: block; }
  .today-grid .today-section { margin-bottom: 16px; }
  .today-print-only h1 { font-size: 22px; margin: 0 0 4px; }
  .today-print-only ol { margin: 8px 0 0; padding-left: 20px; }
  .today-print-only li { margin: 6px 0; font-size: 14px; }
  body { background: #fff; color: #111; }
}
body.printing-today .app { padding: 0; }
`;