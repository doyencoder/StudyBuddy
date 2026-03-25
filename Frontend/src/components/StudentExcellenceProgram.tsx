/**
 * StudentExcellenceProgram.tsx
 *
 * A self-contained UI component for the Student Excellence Program feature
 * shown inside the Billing tab of SettingsPage.
 *
 * States:
 *  • idle    — Upload form (Student ID + Marksheet)
 *  • pending — "Under review" confirmation panel
 *
 * Persistence: localStorage key `studybuddy_sep_submission` stores
 * { submittedAt: ISO string }. Automatically expires after 48 hours so
 * the flow can be re-demonstrated without manual cleanup.
 * A discreet "Reset for demo" button is also available in the pending state.
 *
 * ⚠ Stability contract:
 *  - Imports nothing from SettingsPage's internal state.
 *  - Makes zero API calls.
 *  - No side effects beyond its own localStorage key.
 */

import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  GraduationCap,
  Upload,
  Clock,
  FileText,
  X,
  Award,
  CheckCircle2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

// ── Constants ────────────────────────────────────────────────────────────────

const LS_KEY = "studybuddy_sep_submission";
const TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

// ── Types ────────────────────────────────────────────────────────────────────

type FileSlot = { name: string; size: string } | null;
type ProgramState = "idle" | "pending";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSubmittedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Upload Slot ───────────────────────────────────────────────────────────────

interface UploadSlotProps {
  label: string;
  hint: string;
  icon: React.ReactNode;
  file: FileSlot;
  dragActive: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (file: File) => void;
  onClear: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

const UploadSlot = ({
  label,
  hint,
  icon,
  file,
  dragActive,
  inputRef,
  onFileChange,
  onClear,
  onDragEnter,
  onDragLeave,
  onDrop,
}: UploadSlotProps) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFileChange(f);
    // Reset input so the same file can be reselected after clearing
    e.target.value = "";
  };

  return (
    <div className="flex-1 min-w-0">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={handleInputChange}
      />

      {file ? (
        /* ── Filled state ── */
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 transition-all">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">{file.size}</p>
          </div>
          <button
            onClick={onClear}
            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            aria-label="Remove file"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* ── Empty / drag state ── */
        <button
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); onDragEnter(); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-all cursor-pointer group ${
            dragActive
              ? "border-primary bg-primary/8 scale-[1.01]"
              : "border-border/50 hover:border-primary/40 hover:bg-primary/4"
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
            dragActive ? "bg-primary/20" : "bg-secondary/60 group-hover:bg-primary/10"
          }`}>
            <span className={`transition-colors ${dragActive ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`}>
              {icon}
            </span>
          </div>
          <div>
            <p className={`text-sm font-medium transition-colors ${dragActive ? "text-primary" : "text-foreground"}`}>
              {label}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
          </div>
          <div className={`flex items-center gap-1.5 mt-0.5 px-3 py-1 rounded-full border transition-all text-xs ${
            dragActive
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/50 text-muted-foreground group-hover:border-primary/30 group-hover:text-primary/80"
          }`}>
            <Upload className="w-3 h-3" />
            {dragActive ? "Drop to attach" : "Click or drag & drop"}
          </div>
        </button>
      )}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const StudentExcellenceProgram = () => {
  const [programState, setProgramState] = useState<ProgramState>("idle");
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [idCard, setIdCard] = useState<FileSlot>(null);
  const [marksheet, setMarksheet] = useState<FileSlot>(null);
  const [dragOver, setDragOver] = useState<"id" | "mark" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const idInputRef = useRef<HTMLInputElement>(null);
  const markInputRef = useRef<HTMLInputElement>(null);

  // ── On mount: check for an active pending submission ──────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { submittedAt: string };
      const age = Date.now() - new Date(parsed.submittedAt).getTime();
      if (age < TTL_MS) {
        setProgramState("pending");
        setSubmittedAt(parsed.submittedAt);
      } else {
        localStorage.removeItem(LS_KEY);
      }
    } catch {
      localStorage.removeItem(LS_KEY);
    }
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleFile = (slot: "id" | "mark", f: File) => {
    const obj = { name: f.name, size: formatFileSize(f.size) };
    if (slot === "id") setIdCard(obj);
    else setMarksheet(obj);
  };

  const handleDrop = (slot: "id" | "mark") => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(slot, f);
  };

  const handleSubmit = async () => {
    if (!idCard || !marksheet) return;
    setIsSubmitting(true);
    // Simulate a brief network feel for realism
    await new Promise((r) => setTimeout(r, 1200));
    const now = new Date().toISOString();
    localStorage.setItem(LS_KEY, JSON.stringify({ submittedAt: now }));
    setSubmittedAt(now);
    setProgramState("pending");
    setIsSubmitting(false);
  };

  const handleReset = () => {
    localStorage.removeItem(LS_KEY);
    setProgramState("idle");
    setIdCard(null);
    setMarksheet(null);
    setSubmittedAt(null);
  };

  const canSubmit = idCard !== null && marksheet !== null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Card className="bg-card border-border overflow-hidden">
      {/* Top accent strip */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      <CardContent className="pt-6 pb-6">
        {/* ── Header (always visible) ──────────────────────────────────────── */}
        <div className="flex items-start gap-3 mb-5">
          <div className="shrink-0 p-2.5 rounded-xl bg-primary/10 border border-primary/20">
            <GraduationCap className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground">Student Excellence Program</h3>
              <Badge
                variant="outline"
                className="text-[10px] font-semibold px-2 py-0.5 border-primary/30 text-primary bg-primary/10"
              >
                <Sparkles className="w-2.5 h-2.5 mr-1" />
                FREE PREMIUM
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Scored above 90%? You deserve more. Upload your Student ID and latest
              Marksheet to unlock a full year of Premium — completely free.
            </p>
          </div>
        </div>

        {programState === "idle" ? (
          <>
            {/* ── What you get banner ───────────────────────────────────── */}
            <div className="flex flex-wrap gap-4 mb-5 px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
              {[
                { icon: <Award className="w-3.5 h-3.5" />, label: "1 year of Premium, free" },
                { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Unlimited AI messages" },
                { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "All premium features" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="text-primary">{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </div>

            {/* ── Upload slots ─────────────────────────────────────────── */}
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Required Documents
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <UploadSlot
                label="Student ID Card"
                hint="College / School ID"
                icon={<ShieldCheck className="w-4.5 h-4.5" />}
                file={idCard}
                dragActive={dragOver === "id"}
                inputRef={idInputRef as React.RefObject<HTMLInputElement>}
                onFileChange={(f) => handleFile("id", f)}
                onClear={() => setIdCard(null)}
                onDragEnter={() => setDragOver("id")}
                onDragLeave={() => setDragOver(null)}
                onDrop={handleDrop("id")}
              />
              <UploadSlot
                label="Marksheet / Report Card"
                hint="Showing 90%+ score"
                icon={<FileText className="w-4.5 h-4.5" />}
                file={marksheet}
                dragActive={dragOver === "mark"}
                inputRef={markInputRef as React.RefObject<HTMLInputElement>}
                onFileChange={(f) => handleFile("mark", f)}
                onClear={() => setMarksheet(null)}
                onDragEnter={() => setDragOver("mark")}
                onDragLeave={() => setDragOver(null)}
                onDrop={handleDrop("mark")}
              />
            </div>

            <p className="text-xs text-muted-foreground/70 mb-4">
              Accepted formats: PDF, JPG, PNG, WEBP · Max 20 MB per file
            </p>

            {/* ── Submit button ─────────────────────────────────────────── */}
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || isSubmitting}
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all disabled:opacity-40"
            >
              {isSubmitting ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
                  Submitting…
                </>
              ) : (
                <>
                  <GraduationCap className="w-4 h-4 mr-2" />
                  Submit for Verification
                </>
              )}
            </Button>

            {!canSubmit && (
              <p className="text-xs text-muted-foreground/60 mt-2">
                Please attach both documents to continue.
              </p>
            )}
          </>
        ) : (
          <>
            {/* ── Pending state ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-5">
              <div className="flex items-start gap-4">
                {/* Animated status dot */}
                <div className="shrink-0 mt-0.5 w-10 h-10 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <p className="font-semibold text-foreground">Application Under Review</p>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold px-2 py-0.5 border-primary/30 text-primary bg-primary/10"
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-1.5" />
                      PENDING
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                    Your documents have been submitted successfully. Our team will verify
                    your eligibility within{" "}
                    <span className="font-medium text-foreground">2–4 business days</span>.
                    You'll be notified here and via email once a decision is made.
                  </p>

                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                      Student ID received
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                      Marksheet received
                    </div>
                  </div>

                  {submittedAt && (
                    <p className="text-xs text-muted-foreground/60 mt-3">
                      Submitted on {formatSubmittedDate(submittedAt)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Demo reset — subtle, out of the way */}
            <div className="flex justify-end mt-3">
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset for demo
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StudentExcellenceProgram;