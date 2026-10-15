import { Radio } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Koneksi terputus" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold">
          <Radio aria-hidden="true" className="size-5" />
          eSIM ERP
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>Koneksi terputus</h1>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Data ERP tidak tersedia secara offline. Periksa koneksi, lalu coba
              lagi.
            </p>
            <Button nativeButton={false} render={<a href="/app" />}>
              Coba lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
