"use client";

import {
  type AuditEvent,
  type AuditQuery,
  auditQuerySchema,
} from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { PageHeader } from "@/components/common/page-header";
import { RecordsTable } from "@/components/common/records-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import type { DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuditEvents, useAuditQuery } from "@/hooks/audit";
import { formatDate } from "@/lib/format";

const AUDIT_COLUMNS: ColumnDef<DataGridFeatures, AuditEvent>[] = [
  {
    accessorKey: "createdAt",
    header: "Waktu (WIB)",
    size: 185,
    cell: ({ row }) => (
      <span className="text-xs">{formatDate(row.original.createdAt)}</span>
    ),
  },
  {
    id: "actor",
    header: "Pelaku",
    size: 225,
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          {row.original.actor?.name ?? "Worker / sistem"}
        </span>
        <span className="break-all text-xs text-muted-foreground">
          {row.original.actor?.email ?? "Proses otomatis"}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "action",
    header: "Aksi",
    size: 240,
    cell: ({ row }) => (
      <span className="break-all font-mono text-xs">{row.original.action}</span>
    ),
  },
  {
    accessorKey: "resourceId",
    header: "ID objek",
    size: 220,
    cell: ({ row }) => (
      <span className="break-all font-mono text-xs">
        {row.original.resourceId ?? "—"}
      </span>
    ),
  },
  {
    id: "details",
    header: "Perubahan",
    size: 300,
    cell: ({ row }) =>
      Object.keys(row.original.details).length ? (
        <dl className="flex flex-col gap-1 text-xs">
          {Object.entries(row.original.details).map(([key, value]) => (
            <div className="flex flex-wrap gap-1" key={key}>
              <dt className="font-medium">{key}:</dt>
              <dd className="break-all">{String(value ?? "—")}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <span className="text-xs text-muted-foreground">
          Tanpa rincian tambahan
        </span>
      ),
  },
];

type AuditFiltersProps = { readonly filters: ReturnType<typeof useAuditQuery> };

function AuditFilters({ filters }: AuditFiltersProps) {
  const form = useForm<z.input<typeof auditQuerySchema>, unknown, AuditQuery>({
    defaultValues: filters.query ?? { ...filters.list.query, action: "" },
    resolver: zodResolver(auditQuerySchema),
  });
  const errors = form.formState.errors;

  return (
    <Frame spacing="sm">
      <FramePanel>
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={form.handleSubmit(filters.setFilters)}
        >
          <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="audit-action">Aksi</Label>
              <Input
                aria-describedby={
                  errors.action ? "audit-action-error" : undefined
                }
                aria-invalid={Boolean(errors.action)}
                id="audit-action"
                maxLength={100}
                placeholder="staff.updated"
                {...form.register("action")}
              />
              {errors.action ? (
                <p className="text-xs text-destructive" id="audit-action-error">
                  {errors.action.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="audit-actor">ID staf pelaku</Label>
              <Input
                aria-describedby={
                  errors.actorId ? "audit-actor-error" : undefined
                }
                aria-invalid={Boolean(errors.actorId)}
                id="audit-actor"
                placeholder="UUID staf (opsional)"
                {...form.register("actorId", {
                  setValueAs: (value: unknown) =>
                    value === "" ? undefined : value,
                })}
              />
              {errors.actorId ? (
                <p className="text-xs text-destructive" id="audit-actor-error">
                  Gunakan ID staf dalam format UUID.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="audit-from">Dari tanggal (WIB)</Label>
              <Input
                aria-describedby={errors.from ? "audit-from-error" : undefined}
                aria-invalid={Boolean(errors.from)}
                id="audit-from"
                type="date"
                {...form.register("from", {
                  setValueAs: (value: unknown) =>
                    value === "" ? undefined : value,
                })}
              />
              {errors.from ? (
                <p className="text-xs text-destructive" id="audit-from-error">
                  {errors.from.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="audit-to">Sampai tanggal (WIB)</Label>
              <Input
                aria-describedby={errors.to ? "audit-to-error" : undefined}
                aria-invalid={Boolean(errors.to)}
                id="audit-to"
                type="date"
                {...form.register("to", {
                  setValueAs: (value: unknown) =>
                    value === "" ? undefined : value,
                })}
              />
              {errors.to ? (
                <p className="text-xs text-destructive" id="audit-to-error">
                  {errors.to.message}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" type="submit">
              Terapkan filter
            </Button>
            <Button
              onClick={filters.resetFilters}
              size="sm"
              type="button"
              variant="outline"
            >
              Reset filter
            </Button>
            <p className="text-xs text-muted-foreground">
              Filter aksi menggunakan kata kunci. Periode mencakup kedua
              tanggal.
            </p>
          </div>
        </form>
      </FramePanel>
    </Frame>
  );
}

export function AuditPage() {
  const filters = useAuditQuery();
  const audit = useAuditEvents(filters.query);

  return (
    <>
      <PageHeader
        description="Telusuri perubahan akses, pembayaran, katalog, dan fulfillment tanpa merekam kata sandi, token, atau kode instalasi."
        title="Riwayat audit"
      />
      <AuditFilters filters={filters} key={filters.params} />
      {filters.validationError ? (
        <Alert variant="warning">
          <AlertTitle>Filter belum valid</AlertTitle>
          <AlertDescription>
            {filters.validationError}{" "}
            <Button
              onClick={filters.resetFilters}
              size="sm"
              type="button"
              variant="outline"
            >
              Reset filter
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <RecordsTable
          columns={AUDIT_COLUMNS}
          emptyAction={
            <Button
              onClick={filters.resetFilters}
              size="sm"
              type="button"
              variant="outline"
            >
              Reset filter
            </Button>
          }
          emptyDescription="Tidak ada peristiwa audit yang cocok."
          error={audit.error}
          isLoading={audit.isPending || audit.isPlaceholderData}
          list={filters.list}
          onRetry={() => {
            void audit.refetch();
          }}
          rows={audit.isPlaceholderData ? [] : (audit.data?.events ?? [])}
          searchPlaceholder="Cari pelaku, aksi, atau ID objek…"
          title="Peristiwa audit"
          total={audit.data?.total ?? 0}
        />
      )}
    </>
  );
}
