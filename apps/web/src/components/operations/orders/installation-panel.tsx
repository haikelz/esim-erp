"use client";

import { Copy, Eye, LoaderCircle } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { useRevealInstallation } from "@/hooks/orders";

type InstallationPanelProps = { readonly orderId: string };

export function InstallationPanel({ orderId }: InstallationPanelProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const reveal = useRevealInstallation();

  useEffect(() => {
    if (!canvas.current || !reveal.data) return;

    void QRCode.toCanvas(canvas.current, reveal.data.activationCode, {
      width: 192,
      margin: 2,
      errorCorrectionLevel: "M",
    }).catch(() =>
      setQrError("QR belum dapat dibuat. Kode instalasi tetap dapat disalin."),
    );
  }, [reveal.data]);

  async function handleCopy() {
    if (!reveal.data) return;

    try {
      await navigator.clipboard.writeText(reveal.data.activationCode);
      toast.success("Kode instalasi disalin.");
    } catch {
      toast.error(
        "Clipboard tidak tersedia. Pilih dan salin kode secara manual.",
        { duration: Number.POSITIVE_INFINITY },
      );
    }
  }

  return (
    <Frame>
      <FrameHeader>
        <FrameTitle>
          <h2>Instalasi eSIM</h2>
        </FrameTitle>
        <FrameDescription>
          Periksa kode sebelum dibagikan. Akses dicatat dalam audit.
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="flex flex-col gap-4">
        {/* Profiles without supplier service must never appear installable. */}
        {reveal.data?.mode === "mock" ? (
          <>
            <Alert role="status" variant="warning">
              <AlertTitle>Instalasi belum tersedia</AlertTitle>
              <AlertDescription>
                Integrasi supplier belum terhubung. Kode instalasi tersedia
                setelah profil diterima dari supplier layanan internet.
              </AlertDescription>
            </Alert>
            <div>
              <Button
                onClick={() => reveal.reset()}
                size="sm"
                type="button"
                variant="ghost"
              >
                Tutup rincian
              </Button>
            </div>
          </>
        ) : reveal.data ? (
          <>
            <div className="flex flex-wrap items-start gap-4">
              <canvas
                aria-label="QR instalasi eSIM"
                className="max-w-full"
                ref={canvas}
                role="img"
              />
              <dl className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">ICCID</dt>
                  <dd className="break-all font-mono text-xs">
                    {reveal.data.iccid}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    Kode instalasi
                  </dt>
                  <dd className="break-all font-mono text-xs">
                    {reveal.data.activationCode}
                  </dd>
                </div>
              </dl>
            </div>
            {qrError ? (
              <Alert variant="warning">
                <AlertDescription>{qrError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleCopy}
                size="sm"
                type="button"
                variant="outline"
              >
                <Copy aria-hidden="true" data-icon="inline-start" />
                Salin kode
              </Button>
              <Button
                onClick={() => {
                  reveal.reset();
                  setQrError(null);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Sembunyikan kode
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Kode hanya tampil setelah diminta. Profil siap belum berarti eSIM
              terpasang atau aktif.
            </p>
            {reveal.error ? (
              <Alert variant="destructive">
                <AlertDescription>{reveal.error.message}</AlertDescription>
              </Alert>
            ) : null}
            <div>
              <Button
                disabled={reveal.isPending}
                onClick={() => reveal.mutate(orderId)}
                size="sm"
                type="button"
                variant="outline"
              >
                {reveal.isPending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Eye aria-hidden="true" data-icon="inline-start" />
                )}
                Periksa kode instalasi
              </Button>
            </div>
          </>
        )}
      </FramePanel>
    </Frame>
  );
}
