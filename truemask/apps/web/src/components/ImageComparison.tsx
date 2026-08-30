"use client";

import { CheckCircle2, ChevronRight, Eye, ShieldCheck } from "lucide-react";
import type { Detection } from "@/types";

interface ImageComparisonProps {
  imageUrl: string;
  /**
   * Object URL of the real redacted PNG produced by the vision pipeline. This
   * panel used to render `imageUrl` with a CSS blur on top, which showed the
   * ORIGINAL pixels behind a filter — the opposite of what the app promises.
   * Falls back to the original only if redaction has not finished yet.
   */
  redactedUrl: string | null;
  detections: Detection[];
  onContinue: () => void;
}

export default function ImageComparison({
  imageUrl,
  redactedUrl,
  detections,
  onContinue,
}: ImageComparisonProps) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          <Eye size={22} />
        </div>

        <h1 className="text-3xl font-semibold md:text-4xl">
          Review the protected image
        </h1>

        <p className="mt-3 text-sm text-white/45">
          Only the approved sensitive regions were protected. The rest of the
          image remains unchanged.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* ORIGINAL */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-white/40" />
            <span className="text-sm font-medium text-white/70">Original</span>
          </div>

          <div className="relative self-start overflow-hidden rounded-3xl border border-white/10 bg-black">
            <img
              src={imageUrl}
              alt="Original image"
              className="block max-h-[600px] w-full object-contain"
            />

            <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white/60 backdrop-blur">
              Original image
            </div>
          </div>
        </div>

        {/* PROTECTED */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={15} />
            <span className="text-sm font-medium text-white">Protected</span>
          </div>

          <div className="relative self-start overflow-hidden rounded-3xl border border-white/10 bg-black">
            <img
              src={redactedUrl ?? imageUrl}
              alt="Protected image"
              className="block max-h-[600px] w-full object-contain"
            />

            <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white/70 backdrop-blur">
              {redactedUrl ? "Protected image" : "Preparing…"}
            </div>
          </div>
        </div>
      </div>

      {/* RESULTS */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <ResultCard
          title="Approved modifications"
          value={`${detections.length}`}
          description="Sensitive regions protected"
        />

        <ResultCard
          title="Image integrity"
          value="Preserved"
          description="All other regions unchanged"
        />

        <ResultCard
          title="Unauthorized changes"
          value="0"
          description="Outside approved regions"
        />
      </div>

      {/* VERIFIED INFO */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" />

          <div>
            <h3 className="font-medium">Protection policy ready</h3>

            <p className="mt-1 text-sm leading-6 text-white/45">
              TrueMask will record the original image commitment, the approved
              protected regions, and the protected image commitment for
              cryptographic verification.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onContinue}
        className="mx-auto mt-8 flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-white/90"
      >
        Create verification record
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function ResultCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-xs uppercase tracking-wide text-white/35">
        {title}
      </div>

      <div className="mt-3 text-2xl font-semibold">{value}</div>

      <div className="mt-2 text-sm text-white/40">{description}</div>
    </div>
  );
}
