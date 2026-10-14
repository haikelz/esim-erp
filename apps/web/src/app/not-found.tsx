import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h1>Halaman tidak ditemukan</h1>
          </EmptyTitle>
          <EmptyDescription>
            Alamat tidak tersedia. Kembali ke aplikasi untuk melihat order dan
            invoice.
          </EmptyDescription>
        </EmptyHeader>
        <Button
          nativeButton={false}
          render={<Link href="/app" />}
          size="sm"
          variant="outline"
        >
          Kembali ke aplikasi
        </Button>
      </Empty>
    </main>
  );
}
