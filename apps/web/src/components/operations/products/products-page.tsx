"use client";

import type { Product, StaffRole } from "@esim-erp/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { RecordsTable } from "@/components/common/records-table";
import { Badge } from "@/components/reui/badge";
import type { DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProducts, useSyncProducts } from "@/hooks/catalog";
import { useListQuery } from "@/hooks/list-query";
import { formatDate, formatIdr, formatQuota } from "@/lib/format";
import { ProductFormDialog } from "./product-form-dialog";

type ProductsPageProps = { readonly role: StaffRole };

export function ProductsPage({ role }: ProductsPageProps) {
  const [editing, setEditing] = useState<Product | null>(null);
  const list = useListQuery();
  const catalog = useProducts(list.query);
  const sync = useSyncProducts();
  const canSync = role === "admin" || role === "operations";
  const columns = useMemo<ColumnDef<DataGridFeatures, Product>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Paket",
        size: 205,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "countries",
        header: "Cakupan",
        size: 200,
        cell: ({ row }) => (
          <span className="whitespace-normal">
            {row.original.countries.join(", ")}
          </span>
        ),
      },
      {
        id: "quota",
        header: "Kuota / berlaku",
        size: 140,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuota(row.original.dataMb)} / {row.original.validityDays}{" "}
            hari
          </span>
        ),
      },
      {
        accessorKey: "supplierCostIdr",
        header: "Biaya supplier",
        size: 135,
        meta: {
          headerClassName: "text-right",
          cellClassName: "text-right tabular-nums",
        },
        cell: ({ row }) => formatIdr(row.original.supplierCostIdr),
      },
      {
        accessorKey: "sellingPriceIdr",
        header: "Harga jual",
        size: 135,
        meta: {
          headerClassName: "text-right",
          cellClassName: "text-right tabular-nums font-medium",
        },
        cell: ({ row }) => formatIdr(row.original.sellingPriceIdr),
      },
      {
        accessorKey: "isActive",
        header: "Katalog",
        size: 110,
        cell: ({ row }) => (
          <Badge
            variant={row.original.isActive ? "success-light" : "secondary"}
          >
            {row.original.isActive ? "Aktif" : "Nonaktif"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 90,
        cell: ({ row }) =>
          role === "admin" ? (
            <Button
              aria-label={`Edit ${row.original.name}`}
              onClick={() => setEditing(row.original)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Edit
            </Button>
          ) : null,
      },
    ],
    [role],
  );

  async function handleSync() {
    try {
      await sync.mutateAsync();
      toast.success(
        "Katalog diperbarui. Harga jual dan status aktif tetap dipertahankan.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Katalog belum dapat diperbarui.",
        { duration: Number.POSITIVE_INFINITY },
      );
    }
  }

  const supplier = catalog.data?.supplier;
  const syncAction = canSync ? (
    <Button
      disabled={sync.isPending}
      onClick={handleSync}
      size="sm"
      type="button"
      variant="outline"
    >
      <RefreshCw
        aria-hidden="true"
        className={
          sync.isPending ? "animate-spin motion-reduce:animate-none" : undefined
        }
        data-icon="inline-start"
      />
      Perbarui katalog
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        action={syncAction}
        description="Kelola cakupan, kuota, biaya supplier, dan harga jual. Setiap order menyimpan snapshot paketnya."
        title="Paket & supplier"
      />
      <Frame>
        <FrameHeader>
          <FrameTitle>
            <h2>Supplier eSIM</h2>
          </FrameTitle>
        </FrameHeader>
        <FramePanel className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="font-medium">Integrasi supplier</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning-light">Belum terhubung</Badge>
              <span className="text-xs text-muted-foreground">
                Diperbarui:{" "}
                {supplier?.syncedAt
                  ? formatDate(supplier.syncedAt)
                  : "Belum tersedia"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Katalog dan saldo belum diverifikasi ke supplier.
            </p>
          </div>
          <dl className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Saldo tercatat</dt>
            <dd className="text-xl font-semibold tracking-tight tabular-nums">
              {catalog.isPending ? (
                <Skeleton className="h-7 w-36" />
              ) : supplier ? (
                formatIdr(supplier.balanceIdr)
              ) : (
                "—"
              )}
            </dd>
          </dl>
        </FramePanel>
      </Frame>
      <RecordsTable
        columns={columns}
        emptyAction={syncAction}
        emptyDescription="Perbarui katalog agar paket tersedia."
        error={catalog.error}
        isLoading={catalog.isPending || catalog.isPlaceholderData}
        list={list}
        onRetry={() => {
          void catalog.refetch();
        }}
        rows={catalog.data?.products ?? []}
        title="Katalog paket"
        total={catalog.data?.total ?? 0}
      />
      {editing ? (
        <ProductFormDialog
          key={editing.id}
          onClose={() => setEditing(null)}
          product={editing}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        Saldo dikurangi saat profil berhasil diterbitkan. Paket aktif di katalog
        bukan berarti eSIM pelanggan sudah aktif.
      </p>
    </>
  );
}
