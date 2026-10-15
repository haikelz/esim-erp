import type { Staff } from "@esim-erp/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/reui/badge";
import {
  Frame,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Info akun" };

const ROLE_LABELS: Record<Staff["role"], string> = {
  admin: "Admin",
  sales: "Sales",
  operations: "Operasional",
  finance: "Keuangan",
};

export default async function Page() {
  const staff = await requireStaff();

  return (
    <>
      <PageHeader
        description="Informasi akun dan akses Anda."
        title="Info akun"
      />
      <Frame className="w-full max-w-2xl" spacing="default">
        <FrameHeader>
          <FrameTitle>
            <h2>Data staf</h2>
          </FrameTitle>
        </FrameHeader>
        <FramePanel>
          <dl className="grid gap-6 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Nama</dt>
              <dd className="break-words font-medium">{staff.name}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Email staf</dt>
              <dd className="break-all">{staff.email}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Peran</dt>
              <dd>
                <Badge variant="outline">{ROLE_LABELS[staff.role]}</Badge>
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Status akses</dt>
              <dd>
                <Badge variant="success-light">Aktif</Badge>
              </dd>
            </div>
          </dl>
        </FramePanel>
        <FrameFooter>
          <p className="text-xs text-muted-foreground">
            Hubungi administrator jika data akun tidak sesuai.
          </p>
        </FrameFooter>
      </Frame>
    </>
  );
}
