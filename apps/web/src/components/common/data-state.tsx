import { Shield, TriangleAlert } from "lucide-react";
import Link from "next/link";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type ErrorNoticeProps = { readonly error: Error; readonly onRetry: () => void };

export function ErrorNotice({ error, onRetry }: ErrorNoticeProps) {
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>Data belum dapat dimuat</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
      <AlertAction>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Coba lagi
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function DetailLoading() {
  return (
    <div
      aria-label="Memuat detail"
      className="grid gap-4 lg:grid-cols-2"
      role="status"
    >
      {["details", "status"].map((section) => (
        <Frame key={section}>
          <FramePanel className="flex flex-col gap-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-full" />
          </FramePanel>
        </Frame>
      ))}
    </div>
  );
}

export function PermissionNotice() {
  return (
    <Alert role="status" variant="warning">
      <Shield aria-hidden="true" />
      <AlertTitle>Akses dibatasi</AlertTitle>
      <AlertDescription>
        Role Anda tidak memiliki izin untuk halaman ini. Hubungi admin jika
        akses diperlukan.
      </AlertDescription>
      <AlertAction>
        <Button
          nativeButton={false}
          render={<Link href="/app" />}
          size="sm"
          variant="outline"
        >
          Kembali ke ringkasan
        </Button>
      </AlertAction>
    </Alert>
  );
}
