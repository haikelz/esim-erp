"use client";

import type { StaffRole } from "@esim-erp/contracts";
import { ArrowUpRight, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { MetricStrip } from "@/components/common/metric-strip";
import { PageHeader } from "@/components/common/page-header";
import { RecordsTable } from "@/components/common/records-table";
import { ORDER_COLUMNS } from "@/components/operations/orders/order-columns";
import { Alert, AlertAction, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/hooks/dashboard";

type DashboardPageProps = { readonly role: StaffRole };

export function DashboardPage({ role }: DashboardPageProps) {
  const dashboard = useDashboard();
  const canCreateOrder = role === "admin" || role === "sales";
  const stats = dashboard.data;
  const orderAction = canCreateOrder ? (
    <Button
      nativeButton={false}
      render={<Link href="/app/orders/new" />}
      size="sm"
    >
      <Plus aria-hidden="true" data-icon="inline-start" />
      Buat order
    </Button>
  ) : (
    <Button
      nativeButton={false}
      render={<Link href="/app/orders" />}
      size="sm"
      variant="outline"
    >
      Lihat order
      <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
    </Button>
  );

  return (
    <>
      <PageHeader
        action={orderAction}
        description="Pembayaran, penerbitan eSIM, dan tindak lanjut order."
        title="Ringkasan operasional"
      />
      <MetricStrip
        isLoading={dashboard.isPending}
        metrics={[
          {
            label: "Total order",
            value: stats ? String(stats.totalOrders) : "—",
            description: "Sejak awal pencatatan",
          },
          {
            label: "Menunggu pembayaran",
            value: stats ? String(stats.awaitingPayment) : "—",
            description: "Invoice belum lunas",
          },
          {
            label: "Profil siap",
            value: stats ? String(stats.fulfilled) : "—",
            description: "Bukan status aktivasi jaringan",
          },
          {
            label: "Perlu perhatian",
            value: stats ? String(stats.needsAttention) : "—",
            description: "Provisioning atau rekonsiliasi",
          },
        ]}
      />
      {stats && stats.needsAttention > 0 ? (
        <Alert role="status" variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>{stats.needsAttention} order perlu diperiksa</AlertTitle>
          <AlertAction>
            <Button
              nativeButton={false}
              render={<Link href="/app/exceptions" />}
              size="sm"
              variant="outline"
            >
              Buka pengecualian
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      <RecordsTable
        columns={ORDER_COLUMNS}
        emptyAction={orderAction}
        emptyDescription="Order dari staf akan tampil di sini."
        error={dashboard.error}
        isLoading={dashboard.isPending}
        onRetry={() => {
          void dashboard.refetch();
        }}
        rows={stats?.recentOrders ?? []}
        title="Order terbaru"
        total={stats?.recentOrders.length ?? 0}
      />
      <Frame>
        <FrameHeader>
          <FrameTitle>
            <h2>Integrasi</h2>
          </FrameTitle>
        </FrameHeader>
        <FramePanel className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Supplier eSIM</p>
            <Badge variant="warning-light">Belum terhubung</Badge>
            <p className="text-xs text-muted-foreground">
              Hubungkan supplier untuk menerbitkan eSIM layanan internet.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Midtrans Snap</p>
            <Badge
              variant={stats?.midtransConfigured ? "info-light" : "secondary"}
            >
              {stats?.midtransConfigured
                ? "Konfigurasi tersedia"
                : "Belum dikonfigurasi"}
            </Badge>
            <p className="text-xs text-muted-foreground">
              Sandbox · status pembayaran diverifikasi ke Midtrans.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Notifikasi internal</p>
            <Badge variant="outline">
              {stats
                ? `${stats.pendingAutomationEvents} notifikasi menunggu`
                : "Belum dimuat"}
            </Badge>
            <p className="text-xs text-muted-foreground">
              Notifikasi order dan laporan keuangan melalui n8n.
            </p>
          </div>
        </FramePanel>
      </Frame>
    </>
  );
}
