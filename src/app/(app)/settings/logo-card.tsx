"use client";

import { useRef, useState, useTransition } from "react";

import { ImageUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import mainLogo from "@/app/main_logo.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ALLOWED_LOGO_TYPES, LOGO_MAX_EDGE, checkLogoFile, scaleToFit } from "@/lib/logo";
import { removeLogoAction, saveLogoAction } from "@/server/actions/admin";

/**
 * Redraw whatever the owner picked onto a canvas at a sensible size and export
 * it as PNG.
 *
 * Doing this in the browser means a 6 MB phone photo becomes a ~100 KB logo
 * before it is ever sent, and the file that reaches the server is always plain
 * pixels — never the original file, with whatever it might have carried inside.
 */
async function toPngDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaleToFit(bitmap.width, bitmap.height, LOGO_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process images.");
    // Transparency is preserved: no background is painted first.
    context.drawImage(bitmap, 0, 0, width, height);

    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

export function LogoCard({ hasLogo, version }: { hasLogo: boolean; version: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** Shown the instant a file is picked, so the owner sees the result at once. */
  const [preview, setPreview] = useState<string | null>(null);

  const currentSrc = preview ?? (hasLogo ? `/api/logo${version ? `?v=${version}` : ""}` : mainLogo.src);

  function pick(file: File | undefined) {
    if (!file) return;

    const check = checkLogoFile(file);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }

    startTransition(async () => {
      let dataUrl: string;
      try {
        dataUrl = await toPngDataUrl(file);
      } catch {
        toast.error("That image could not be read. Try saving it as a PNG and picking it again.");
        return;
      }

      const result = await saveLogoAction(dataUrl);
      if (result.ok) {
        setPreview(dataUrl);
        toast.success("Logo saved");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cafe logo</CardTitle>
        <p className="text-sm text-ink-muted">
          Appears in the sidebar, on the sign-in screen and at the top of every printed receipt.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start gap-5">
        <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- may be a user-uploaded data URL */}
          <img src={currentSrc} alt="Dr. Games logo" className="size-full object-contain" />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_LOGO_TYPES.join(",")}
            className="sr-only"
            onChange={(event) => {
              pick(event.target.files?.[0]);
              // Reset, so picking the same file twice still counts as a change.
              event.target.value = "";
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => inputRef.current?.click()} loading={pending}>
              <ImageUp aria-hidden />
              {hasLogo ? "Replace logo" : "Choose an image"}
            </Button>
            {hasLogo ? (
              <Button type="button" variant="outline" onClick={() => setConfirmRemove(true)} disabled={pending}>
                <Trash2 aria-hidden />
                Remove
              </Button>
            ) : null}
          </div>

          <p className="text-xs text-ink-muted">
            PNG, JPG or WEBP. A square image works best — it is resized to {LOGO_MAX_EDGE}px
            automatically, and a PNG with a transparent background looks cleanest on the dark
            sidebar. It saves as soon as you pick it; nothing else on this page needs saving.
          </p>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the logo?"
        destructive
        loading={pending}
        confirmLabel="Remove logo"
        description="The interface and receipts go back to the bundled Dr. Games main logo. You can upload another logo again at any time."
        onConfirm={() =>
          startTransition(async () => {
            const result = await removeLogoAction();
            if (result.ok) {
              setPreview(null);
              setConfirmRemove(false);
              toast.success("Logo removed");
              router.refresh();
            } else {
              toast.error(result.error);
            }
          })
        }
      />
    </Card>
  );
}
