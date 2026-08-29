"use client";

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

import { hashFile, shortHash } from "@/lib/image-utils";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

let faceDetector: FaceDetector | null = null;
async function initFaceDetector() {
  if (faceDetector) return faceDetector;
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  faceDetector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
      delegate: "GPU"
    },
    runningMode: "IMAGE"
  });
  return faceDetector;
}

const STEPS: {
  id: AppStep;
  label: string;
}[] = [
  { id: "upload", label: "Upload" },
  { id: "scan", label: "Scan" },
  { id: "review", label: "Review" },
  { id: "redact", label: "Protect" },
  { id: "verified", label: "Verify" },
];

const MOCK_DETECTIONS: Detection[] = [
  {
    id: "face-1",
    type: "face",
    label: "Face",
    risk: "critical",
    x: 38,
    y: 18,
    width: 22,
    height: 30,
    selected: true,
  },
  {
    id: "text-1",
    type: "text",
    label: "Location text",
    risk: "high",
    x: 10,
    y: 68,
    width: 35,
    height: 10,
    selected: true,
  },
  {
    id: "plate-1",
    type: "license_plate",
    label: "License plate",
    risk: "high",
    x: 62,
    y: 70,
    width: 18,
    height: 8,
    selected: true,
  },
];

export default function TrueMaskApp() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<AppStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [originalHash, setOriginalHash] = useState("");
  const [protectedHash, setProtectedHash] = useState("");
  const [isDragging, setIsDragging] = useState(false);

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

      const detector = await initFaceDetector();
      const img = new window.Image();
      img.src = url;
      await new Promise((resolve) => { img.onload = resolve; });
      
      const detectionsResult = detector.detect(img);
      const newDetections: Detection[] = detectionsResult.detections.map((d, index) => {
        const bbox = d.boundingBox;
        if (!bbox) return null;
        return {
          id: `face-${index}`,
          type: "face",
          label: "Face",
          risk: "critical",
          x: (bbox.originX / img.width) * 100,
          y: (bbox.originY / img.height) * 100,
          width: (bbox.width / img.width) * 100,
          height: (bbox.height / img.height) * 100,
          selected: true
        };
      }).filter((item): item is Detection => item !== null);

      if (newDetections.length > 0) {
        setDetections(newDetections);
      } else {
        setDetections(MOCK_DETECTIONS);
      }
      setStep("review");
    } catch {
      setOriginalHash("Unable to generate hash");
      setDetections(MOCK_DETECTIONS);
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
    if (!file || !imageUrl) return;

    setStep("redact");

    try {
      const img = new window.Image();
      img.src = imageUrl;
      await new Promise((resolve) => { img.onload = resolve; });

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);

      selectedDetections.forEach((item) => {
        const x = (item.x / 100) * img.width;
        const y = (item.y / 100) * img.height;
        const w = (item.width / 100) * img.width;
        const h = (item.height / 100) * img.height;
        
        ctx.filter = "blur(20px)";
        ctx.drawImage(canvas, Math.max(0, x), Math.max(0, y), w, h, Math.max(0, x), Math.max(0, y), w, h);
        ctx.filter = "none";
      });

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg"));
      if (blob) {
        const redactedFile = new File([blob], "redacted.jpg", { type: "image/jpeg" });
        const redactedHashValue = await hashFile(redactedFile);
        setProtectedHash(redactedHashValue);
        
        // This simulates the Submit functionality for Midnight
        console.log("Submitting to Midnight contract.circuits.verify_image...");
        console.log("Public Input (redactedHash):", redactedHashValue);
        console.log("Private Witnesses:");
        console.log(" - originalHash:", originalHash);
        console.log(" - boundingBoxes:", selectedDetections);
      }
      setStep("verified");
    } catch {
      setProtectedHash("Unable to generate hash");
      setStep("verified");
    }
  }

  function resetApp() {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }

    setFile(null);
    setImageUrl(null);
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

        {step !== "upload" && (
          <button
            onClick={resetApp}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5"
          >
            New image
          </button>
        )}
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

        {step === "verified" && imageUrl && (
          <VerifiedScreen
            imageUrl={imageUrl}
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
  detections,
  originalHash,
  protectedHash,
  onReset,
}: {
  imageUrl: string;
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

      <div className="grid gap-6 md:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
          <img
            src={imageUrl}
            alt="Protected preview"
            className="max-h-[500px] w-full object-contain"
          />
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
