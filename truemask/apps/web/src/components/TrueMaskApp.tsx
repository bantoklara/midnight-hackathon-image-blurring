"use client";

import ImageComparison from "@/components/ImageComparison";
import { useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileImage,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import type { AppStep, Detection } from "@/types";

import {
  hashFile,
  loadRgbaImage,
  rgbaToPngBlob,
  sha256Bytes,
  shortHash,
} from "@/lib/image-utils";
import { vision } from "truemask-api";

/**
 * Detection, block-splitting, hashing and redaction all live in the shared
 * pipeline (`api/src/vision`), not in this component. That matters: the regions
 * the journalist sees here and the blocks the circuit hashes have to come from
 * one implementation, or the UI can show one thing while the proof commits to
 * another.
 */
type PixelDetection = vision.Detection;

const STEPS: {
  id: AppStep;
  label: string;
}[] = [
  { id: "upload", label: "Upload" },
  { id: "scan", label: "Scan" },
  { id: "review", label: "Review" },
  { id: "redact", label: "Protect" },
  { id: "compare", label: "Compare" },
  { id: "verified", label: "Verify" },
];



import { useMidnight } from "@/hooks/useMidnight";

/**
 * The pipeline works in pixels; the UI positions overlays in percentages.
 * These two helpers are the only place the two coordinate systems meet.
 */
function toUiDetection(item: PixelDetection, index: number, image: ImageData): Detection {
  const type: Detection["type"] = item.kind === "face" ? "face" : "text";
  return {
    id: `${item.kind}-${index}`,
    type,
    label: item.kind === "face" ? "Face" : item.text ? `Text: ${item.text}` : "Text",
    risk: item.kind === "face" ? "critical" : "high",
    x: (item.box.x / image.width) * 100,
    y: (item.box.y / image.height) * 100,
    width: (item.box.width / image.width) * 100,
    height: (item.box.height / image.height) * 100,
    selected: true,
  };
}

const toHexString = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function toPixelDetection(item: Detection, image: ImageData): PixelDetection {
  return {
    kind: item.type === "face" ? "face" : "text",
    confidence: 1,
    box: {
      x: (item.x / 100) * image.width,
      y: (item.y / 100) * image.height,
      width: (item.width / 100) * image.width,
      height: (item.height / 100) * image.height,
    },
  };
}

  export default function TrueMaskApp() {
  const inputRef = useRef<HTMLInputElement>(null);
  
  const { address, isConnecting, connect, isWalletAvailable, getApi } = useMidnight();

  const [step, setStep] = useState<AppStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [originalHash, setOriginalHash] = useState("");
  const [protectedHash, setProtectedHash] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  /** The decoded original pixels. Held so the protect step hashes what was scanned. */
  const sourcePixels = useRef<ImageData | null>(null);
  /** Object URL of the real redacted PNG. This is what the "protected" panels show. */
  const [redactedUrl, setRedactedUrl] = useState<string | null>(null);

  const currentStepIndex = STEPS.findIndex((item) => item.id === step);

  const selectedDetections = useMemo(
    () => detections.filter((item) => item.selected),
    [detections],
  );

  async function handleFile(selectedFile: File) {
    if (!selectedFile.type.startsWith("image/")) {
      alert("Please upload an image file.");
      return;
    }

    const url = URL.createObjectURL(selectedFile);

    setFile(selectedFile);
    setImageUrl(url);
    setStep("scan");
    setDetections([]);

    try {
      const hash = await hashFile(selectedFile);
      setOriginalHash(hash);

      const image = await loadRgbaImage(url);
      sourcePixels.current = image;

      // Faces via MediaPipe, signs and documents via OCR — both from the shared
      // pipeline, so these are the same boxes the redaction will use.
      //
      // Run independently: Tesseract downloads language data on first use and is
      // the more fragile of the two. Awaiting both in one array meant an OCR
      // failure threw away perfectly good face detections as well.
      setStatus("Scanning for faces and text…");
      const [faces, text] = await Promise.allSettled([
        vision.detectFaces(image),
        vision.detectText(image, { minConfidence: 0.75 }),
      ]);

      const found: PixelDetection[] = [
        ...(faces.status === "fulfilled" ? faces.value : []),
        // Drop word boxes smaller than a block — on a photo these are mostly
        // noise (logos, menu fragments) rather than location-revealing text.
        ...(text.status === "fulfilled"
          ? text.value.filter((item) => item.box.width >= 16 && item.box.height >= 8)
          : []),
      ];

      const failures = [
        faces.status === "rejected" ? "face detection" : null,
        text.status === "rejected" ? "text detection" : null,
      ].filter(Boolean);
      if (faces.status === "rejected") console.error("Face detection failed:", faces.reason);
      if (text.status === "rejected") console.error("Text detection failed:", text.reason);

      setStatus(
        failures.length
          ? `${failures.join(" and ")} unavailable — showing ${found.length} region(s) from the rest. Add any missed area by hand before protecting.`
          : found.length
            ? null
            : "No faces or text detected. Nothing will be redacted unless you add a region.",
      );

      setDetections(found.map((item, index) => toUiDetection(item, index, image)));
      setStep("review");
    } catch (err) {
      console.error("Scan failed:", err);
      setStatus(err instanceof Error ? err.message : "Scan failed.");
      setDetections([]);
      setStep("review");
    }
  }

  function toggleDetection(id: string) {
    setDetections((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              selected: !item.selected,
            }
          : item,
      ),
    );
  }

  async function protectImage() {
    const image = sourcePixels.current;
    if (!file || !imageUrl || !image) return;

    setStep("redact");
    setStatus(null);

    try {
      // One call does the whole thing: grid, block mapping, block hashes, the
      // preserved root, the bitmap commitment and the blacked-out pixels.
      // Blackout, not blur: blur and pixelation are reversible enough to attack,
      // and this exists to protect sources.
      const totalBlocks = Math.ceil(image.width / 16) * Math.ceil(image.height / 16);
      setStatus(`Hashing ${totalBlocks.toLocaleString()} blocks…`);
      const redaction = await new Promise<vision.RedactionResult>((resolve, reject) => {
        const worker = new Worker(new URL('../workers/redact.worker.ts', import.meta.url));
        worker.onerror = (err) => {
          worker.terminate();
          reject(new Error("Worker error: " + (err.message || "failed to load script")));
        };
        worker.onmessage = (e) => {
          if (e.data.type === "progress") {
            setStatus(`Hashing blocks… ${Math.round((e.data.done / e.data.total) * 100)}%`);
          } else if (e.data.type === "done") {
            worker.terminate();
            resolve(e.data.redaction);
          } else if (e.data.type === "error") {
            worker.terminate();
            reject(new Error(e.data.error));
          }
        };
        worker.postMessage({
          image,
          detections: selectedDetections.map((item) => toPixelDetection(item, image))
        });
      });

      // PNG, never JPEG. JPEG re-quantises every block, which changes bytes
      // outside the redacted regions and breaks the proof for everyone.
      const pngBlob = await rgbaToPngBlob(redaction.redactedImage);
      const pngBytes = await pngBlob.arrayBuffer();
      const redactedHash = await sha256Bytes(pngBytes);
      setProtectedHash(toHexString(redactedHash));

      // This is the image the app actually protected. Previously it was hashed
      // and then dropped, and every "protected" panel rendered the original.
      setRedactedUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(pngBlob);
      });

      if (!isWalletAvailable) {
        setStatus(
          "Redaction complete and verifiable offline. Connect a Midnight Lace wallet to publish the record on-chain.",
        );
      } else {
        try {
          setStatus("Proving redaction on Midnight...");
          const api = await getApi();
          await api.submitRedaction(redactedHash, redaction);
          setStatus("Redaction proven and recorded on Midnight.");
        } catch (err) {
          console.error("Midnight submission failed:", err);
          setStatus(
            `Redaction is complete, but publishing it on-chain failed: ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          );
        }
      }

      setStep("verified");
    } catch (err) {
      console.error("Protection failed:", err);
      setProtectedHash("Unable to generate hash");
      setStatus(err instanceof Error ? err.message : "Protection failed.");
    }

    window.setTimeout(() => {
      setStep("compare");
    }, 1800);
  }

  function resetApp() {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }
    if (redactedUrl) {
      URL.revokeObjectURL(redactedUrl);
    }

    setFile(null);
    setImageUrl(null);
    setRedactedUrl(null);
    setStatus(null);
    setDetections([]);
    setOriginalHash("");
    setProtectedHash("");
    setStep("upload");
  }

  return (
    <main className="min-h-screen px-5 py-6 md:px-10">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between">
        <button onClick={resetApp} className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <ShieldCheck size={20} />
          </div>

          <div className="text-left">
            <div className="text-lg font-bold tracking-tight">TrueMask</div>
            <div className="text-xs text-white/45">Privacy with proof</div>
          </div>
        </button>

        <div className="flex items-center gap-4">
          {/*
            Only offered when a Midnight wallet is actually installed. Redaction
            and the integrity commitments are entirely local; the wallet is only
            needed to publish the record on-chain. Showing a dead "Connect"
            button to everyone else just implies the app is broken without one.
          */}
          {address ? (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-400">
              Connected: {address.slice(0, 8)}...
            </div>
          ) : isWalletAvailable ? (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5 disabled:opacity-50"
            >
              {isConnecting ? "Connecting..." : "Connect wallet"}
            </button>
          ) : null}
          {step !== "upload" && (
            <button
              onClick={resetApp}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5"
            >
              New image
            </button>
          )}
        </div>
      </header>

      <section className="mx-auto mt-10 max-w-4xl">
        <div className="mb-10 flex items-center justify-between gap-2">
          {STEPS.map((item, index) => {
            const active = index <= currentStepIndex;

            return (
              <div key={item.id} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs ${
                    active
                      ? "border-white bg-white text-black"
                      : "border-white/10 text-white/30"
                  }`}
                >
                  {index < currentStepIndex ? <Check size={14} /> : index + 1}
                </div>

                <span
                  className={`hidden text-xs md:block ${
                    active ? "text-white" : "text-white/30"
                  }`}
                >
                  {item.label}
                </span>

                {index < STEPS.length - 1 && (
                  <div
                    className={`h-px flex-1 ${
                      index < currentStepIndex ? "bg-white/70" : "bg-white/10"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {status && (
          <p className="mx-auto mt-4 max-w-3xl text-center text-sm text-white/50">
            {status}
          </p>
        )}

        {step === "upload" && (
          <UploadScreen
            inputRef={inputRef}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            onFile={handleFile}
          />
        )}

        {step === "scan" && imageUrl && <ScanningScreen imageUrl={imageUrl} />}

        {step === "review" && imageUrl && (
          <ReviewScreen
            imageUrl={imageUrl}
            detections={detections}
            toggleDetection={toggleDetection}
            onContinue={protectImage}
          />
        )}

        {step === "redact" && imageUrl && (
          <ProtectingScreen
            imageUrl={imageUrl}
            count={selectedDetections.length}
          />
        )}

        {step === "compare" && imageUrl && (
          <ImageComparison
            imageUrl={imageUrl}
            redactedUrl={redactedUrl}
            detections={selectedDetections}
            onContinue={() => setStep("verified")}
          />
        )}

        {step === "verified" && imageUrl && (
          <VerifiedScreen
            imageUrl={imageUrl}
            redactedUrl={redactedUrl}
            detections={selectedDetections}
            originalHash={originalHash}
            protectedHash={protectedHash}
            onReset={resetApp}
          />
        )}
      </section>
    </main>
  );
}

function UploadScreen({
  inputRef,
  isDragging,
  setIsDragging,
  onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  setIsDragging: (value: boolean) => void;
  onFile: (file: File) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl pt-10 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <Lock size={24} />
      </div>

      <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
        Protect sensitive information.
        <br />
        Prove what stayed unchanged.
      </h1>

      <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-white/50">
        Upload a photograph. Identify sensitive regions. Create a protected
        version with a verifiable integrity record.
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);

          const droppedFile = event.dataTransfer.files?.[0];

          if (droppedFile) {
            onFile(droppedFile);
          }
        }}
        className={`mt-10 rounded-3xl border border-dashed p-12 transition ${
          isDragging
            ? "border-white bg-white/10"
            : "border-white/15 bg-white/[0.03]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const selectedFile = event.target.files?.[0];

            if (selectedFile) {
              onFile(selectedFile);
            }
          }}
        />

        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-black">
          <Upload size={22} />
        </div>

        <h2 className="mt-5 text-lg font-medium">Upload photograph</h2>

        <p className="mt-2 text-sm text-white/40">
          Drag and drop an image here or choose a file.
        </p>

        <button
          onClick={() => inputRef.current?.click()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90"
        >
          Choose image
          <ChevronRight size={16} />
        </button>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-white/30">
          <Lock size={12} />
          Original image stays in your browser during this demo.
        </div>
      </div>
    </div>
  );
}

function ScanningScreen({ imageUrl }: { imageUrl: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-center">
        <Sparkles className="mx-auto mb-4" size={24} />

        <h1 className="text-3xl font-semibold">Scanning for privacy risks</h1>

        <p className="mt-2 text-sm text-white/45">
          Detecting identifying information in the image.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black">
        <img
          src={imageUrl}
          alt="Uploaded"
          className="max-h-[600px] w-full object-contain opacity-80"
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 animate-pulse bg-white" />
      </div>

      <div className="mt-6 space-y-3">
        {[
          "Analyzing visual identity signals",
          "Checking visible text",
          "Checking location clues",
          "Preparing exposure risk map",
        ].map((item) => (
          <div
            key={item}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm text-white/60"
          >
            <RefreshCw size={16} className="animate-spin" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewScreen({
  imageUrl,
  detections,
  toggleDetection,
  onContinue,
}: {
  imageUrl: string;
  detections: Detection[];
  toggleDetection: (id: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
      <div>
        <div className="mb-4">
          <div className="flex items-center gap-2 text-sm text-white/45">
            <Eye size={15} />
            Exposure risk map
          </div>

          <h1 className="mt-2 text-3xl font-semibold">
            Review sensitive regions
          </h1>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black">
          <img
            src={imageUrl}
            alt="Detection preview"
            className="max-h-[620px] w-full object-contain"
          />

          {detections.map((item) => (
            <button
              key={item.id}
              onClick={() => toggleDetection(item.id)}
              style={{
                left: `${item.x}%`,
                top: `${item.y}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
              }}
              className={`absolute rounded-lg border-2 transition ${
                item.selected
                  ? "border-white bg-white/10"
                  : "border-white/20 bg-black/20 opacity-50"
              }`}
              aria-label={`Toggle ${item.label}`}
            >
              <span className="absolute -top-7 left-0 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[10px] text-white">
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <div className="text-sm text-white/45">AI findings</div>

        <div className="mt-5 space-y-3">
          {detections.map((item) => (
            <button
              key={item.id}
              onClick={() => toggleDetection(item.id)}
              className={`w-full rounded-xl border p-4 text-left transition ${
                item.selected
                  ? "border-white/25 bg-white/10"
                  : "border-white/5 bg-black/10 opacity-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{item.label}</span>

                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                    item.selected
                      ? "border-white bg-white text-black"
                      : "border-white/20"
                  }`}
                >
                  {item.selected && <Check size={12} />}
                </div>
              </div>

              <div className="mt-2 text-xs text-white/40">
                Risk level: {item.risk}
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={onContinue}
          disabled={detections.filter((item) => item.selected).length === 0}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          Protect selected regions
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function ProtectingScreen({
  imageUrl,
  count,
}: {
  imageUrl: string;
  count: number;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <ShieldCheck size={24} className="animate-pulse" />
      </div>

      <h1 className="text-3xl font-semibold">Creating protected image</h1>

      <p className="mt-3 text-white/45">
        Applying {count} approved privacy protection
        {count === 1 ? "" : "s"} and generating integrity commitments.
      </p>

      <div className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-black">
        <img
          src={imageUrl}
          alt="Processing"
          className="max-h-[520px] w-full object-contain opacity-60"
        />
      </div>

      <div className="mt-6 space-y-3 text-left">
        {[
          "Recording original image commitment",
          "Recording approved protection policy",
          "Generating protected image commitment",
          "Preparing verification statement",
        ].map((item) => (
          <div
            key={item}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm"
          >
            <RefreshCw size={16} className="animate-spin" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function VerifiedScreen({
  imageUrl,
  redactedUrl,
  detections,
  originalHash,
  protectedHash,
  onReset,
}: {
  imageUrl: string;
  redactedUrl: string | null;
  detections: Detection[];
  originalHash: string;
  protectedHash: string;
  onReset: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 text-center">
        <CheckCircle2 className="mx-auto mb-4" size={44} />

        <h1 className="text-4xl font-semibold">Protection record created</h1>

        <p className="mt-3 text-white/45">
          Your image has a privacy protection policy and cryptographic integrity
          commitments ready for Midnight verification.
        </p>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-2">
        <div className="self-start overflow-hidden rounded-3xl border border-white/10 bg-black">
          <img
            src={redactedUrl ?? imageUrl}
            alt="Protected image"
            className="block max-h-[500px] w-full object-contain"
          />

          {redactedUrl && (
            <a
              href={redactedUrl}
              download="truemask-protected.png"
              className="flex items-center justify-center gap-2 border-t border-white/10 px-4 py-3 text-sm text-white/70 hover:text-white"
            >
              <FileImage size={15} />
              Download protected PNG
            </a>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} />
            <span className="font-medium">Integrity record</span>
          </div>

          <div className="mt-6 space-y-5">
            <RecordItem
              label="Approved protected regions"
              value={`${detections.length} region${
                detections.length === 1 ? "" : "s"
              }`}
            />

            <RecordItem
              label="Original image commitment"
              value={shortHash(originalHash)}
            />

            <RecordItem
              label="Protected image commitment"
              value={shortHash(protectedHash)}
            />

            <RecordItem
              label="Verification status"
              value="Ready for Midnight verification"
              success
            />
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/50">
            Next integration step: submit the commitments and approved
            protection policy to the Compact contract.
          </div>

          <button
            onClick={onReset}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-black"
          >
            <FileImage size={16} />
            Protect another image
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordItem({
  label,
  value,
  success = false,
}: {
  label: string;
  value: string;
  success?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-white/35">
        {label}
      </div>

      <div
        className={`mt-2 break-all text-sm ${
          success ? "text-white" : "text-white/70"
        }`}
      >
        {success && <CheckCircle2 size={15} className="mr-2 inline" />}

        {value}
      </div>
    </div>
  );
}
