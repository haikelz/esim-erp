"use client";

import {
  EXCEPTION_CRITICAL_MINUTES,
  EXCEPTION_KINDS,
  type StaffRole,
} from "@esim-erp/contracts";
import { CircleAlert, Clock3, RefreshCw } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { PermissionNotice } from "@/components/common/data-state";
import { MetricStrip } from "@/components/common/metric-strip";
import { PageHeader } from "@/components/common/page-header";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useExceptionListQuery,
  useExceptions,
  useProcessFulfillment,
} from "@/hooks/exceptions";
import { useRetryProvisioning } from "@/hooks/orders";
import { formatDate, formatIdr } from "@/lib/format";
import { ExceptionAlerts } from "./exception-alerts";
import { ExceptionFollowUpDialog } from "./exception-follow-up-dialog";
import {
  canRetryException,
  EXCEPTION_KIND_LABELS,
  type ExceptionEntry,
  ExceptionsTable,
} from "./exceptions-table";

const KIND_OPTIONS = [
  { label: "Semua jenis", value: "all" },
  ...EXCEPTION_KINDS.map((kind) => ({
    label: EXCEPTION_KIND_LABELS[kind],
    value: kind,
  })),
];

type ExceptionFeedback = {
  readonly description: string;
  readonly title: string;
  readonly variant: "info" | "destructive";
};

type ExceptionsPageProps = { readonly role: StaffRole };

export function ExceptionsPage({ role }: ExceptionsPageProps) {
  const list = useExceptionListQuery();
  const kindId = useId();
  const workerDescriptionId = useId();
  const [feedback, setFeedback] = useState<ExceptionFeedback>();
  const [requiresReview, setRequiresReview] = useState(false);
  const [selected, setSelected] = useState<ExceptionEntry>();
  const exceptions = useExceptions(list.query);
  const retry = useRetryProvisioning();
  const processing = useProcessFulfillment();

  const canOperate = role === "admin" || role === "operations";
  const isMutating = retry.isPending || processing.isPending;
  const actionsDisabled =
    !exceptions.isSuccess ||
    exceptions.isPlaceholderData ||
    exceptions.isFetching ||
    isMutating ||
    requiresReview;

  async function handleRefresh() {
    if (exceptions.isFetching || isMutating) return;

    const refreshed = await exceptions.refetch({ throwOnError: false });
    if (refreshed.isSuccess) {
      setRequiresReview(false);
      if (requiresReview) {
        setFeedback({
          description:
            "Status terbaru tersedia. Periksa order sebelum mencoba lagi.",
          title: "Status diperbarui",
          variant: "info",
        });
      }
    }
  }

  function handleKindChange(value: string | null) {
    list.setKind(EXCEPTION_KINDS.find((kind) => kind === value));
  }

  const handleRetry = useCallback(
    (entry: ExceptionEntry) => {
      if (actionsDisabled || !canRetryException(entry, role)) return;

      setFeedback({
        description: `Meminta penerbitan ulang untuk order ${entry.order.number}.`,
        title: "Mengirim permintaan",
        variant: "info",
      });
      retry.mutate(entry.order.id, {
        onError: (error) => {
          setRequiresReview(true);
          setFeedback({
            description: `${error instanceof Error ? error.message : "Permintaan coba ulang belum dapat diselesaikan."} Periksa status terbaru sebelum mengirim permintaan lagi.`,
            title: "Periksa hasil coba ulang",
            variant: "destructive",
          });
        },
        onSuccess: () => {
          setFeedback({
            description: `Penerbitan ulang untuk ${entry.order.number} masuk antrean. Periksa status profil pada order.`,
            title: "Masuk antrean",
            variant: "info",
          });
        },
      });
    },
    [actionsDisabled, retry.mutate, role],
  );

  function handleProcess() {
    if (!canOperate || actionsDisabled) return;

    setFeedback({
      description:
        "Memproses hingga 10 permintaan dari seluruh antrean, termasuk di luar hasil filter.",
      title: "Memproses antrean",
      variant: "info",
    });
    processing.mutate(undefined, {
      onError: (error) => {
        setRequiresReview(true);
        setFeedback({
          description: `${error instanceof Error ? error.message : "Pemrosesan antrean belum dapat diselesaikan."} Sebagian permintaan mungkin telah diproses. Muat ulang status sebelum mencoba lagi.`,
          title: "Periksa hasil pemrosesan",
          variant: "destructive",
        });
      },
      onSuccess: (result) => {
        setFeedback({
          description:
            result.processed === 0
              ? "Tidak ada permintaan yang diproses. Periksa antrean dan saldo tercatat."
              : `${result.processed} permintaan ditangani. Periksa status profil pada tiap order.`,
          title: "Pemrosesan selesai",
          variant: "info",
        });
      },
    });
  }

  if (exceptions.permissionDenied) {
    return (
      <>
        <PageHeader
          description="Tindak lanjuti pembayaran dan penerbitan yang memerlukan pemeriksaan."
          title="Pengecualian operasional"
        />
        <PermissionNotice />
      </>
    );
  }

  const page =
    exceptions.error || exceptions.isPlaceholderData
      ? undefined
      : exceptions.data;
  const hasFilters = Boolean(
    list.query.kind || list.query.search || list.query.page > 1,
  );
  const metrics = [
    {
      label: "Pengecualian",
      value: page ? page.total.toLocaleString("id-ID") : "—",
      description: "Sesuai filter aktif",
    },
    {
      label: `Usia ≥${EXCEPTION_CRITICAL_MINUTES} menit`,
      value: page ? page.overdueCount.toLocaleString("id-ID") : "—",
      description: "Sesuai filter aktif",
    },
    {
      label: "Saldo supplier tercatat",
      value: page
        ? page.supplierBalanceIdr === null
          ? "Belum tersedia"
          : formatIdr(page.supplierBalanceIdr)
        : "—",
      description: "Belum diverifikasi supplier",
    },
    {
      label: "Penerbitan tertahan saldo",
      value: page ? page.blockedByBalanceCount.toLocaleString("id-ID") : "—",
      description: "Seluruh antrean, di luar filter",
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-busy={exceptions.isFetching}
              disabled={exceptions.isFetching || isMutating}
              onClick={() => void handleRefresh()}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" data-icon="inline-start" />
              Muat ulang
            </Button>
            {canOperate ? (
              <Button
                aria-busy={processing.isPending}
                aria-describedby={workerDescriptionId}
                disabled={actionsDisabled}
                onClick={handleProcess}
                size="sm"
                type="button"
              >
                Proses antrean (maks. 10)
              </Button>
            ) : null}
          </div>
        }
        description="Pembayaran, profil tertunda, dan hasil supplier yang perlu ditangani."
        title="Pengecualian operasional"
      />
      <p className="text-sm text-muted-foreground" id={workerDescriptionId}>
        Pemrosesan mencakup seluruh antrean, termasuk di luar hasil filter.
      </p>
      <div
        aria-atomic="true"
        aria-live="polite"
        className={feedback ? undefined : "sr-only"}
      >
        {feedback ? (
          <Alert role="none" variant={feedback.variant}>
            {feedback.variant === "destructive" ? (
              <CircleAlert aria-hidden="true" />
            ) : (
              <Clock3 aria-hidden="true" />
            )}
            <AlertTitle>{feedback.title}</AlertTitle>
            <AlertDescription>{feedback.description}</AlertDescription>
            {requiresReview ? (
              <AlertAction>
                <Button
                  disabled={exceptions.isFetching || isMutating}
                  onClick={() => void handleRefresh()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Periksa status
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        ) : null}
      </div>
      <MetricStrip
        isLoading={exceptions.isPending || exceptions.isPlaceholderData}
        metrics={metrics}
      />
      {page ? <ExceptionAlerts page={page} /> : null}
      <div className="flex min-w-0 flex-col gap-3">
        <Frame spacing="sm">
          <FramePanel className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                <label
                  className="text-xs font-medium"
                  htmlFor={kindId}
                  id={`${kindId}-label`}
                >
                  Jenis pengecualian
                </label>
                <Select
                  items={KIND_OPTIONS}
                  onValueChange={handleKindChange}
                  value={list.query.kind ?? "all"}
                >
                  <SelectTrigger
                    aria-labelledby={`${kindId}-label`}
                    className="w-full"
                    id={kindId}
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {KIND_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {hasFilters ? (
                <Button
                  onClick={list.resetFilters}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Reset filter
                </Button>
              ) : null}
            </div>
          </FramePanel>
        </Frame>
        <p
          className="text-xs text-muted-foreground"
          role={exceptions.error ? "status" : undefined}
        >
          {exceptions.error ? (
            "Data belum diperbarui. Muat ulang untuk memeriksa status terbaru."
          ) : page ? (
            <>
              Terakhir diperbarui:{" "}
              <time dateTime={page.asOf}>{formatDate(page.asOf)} WIB</time>
            </>
          ) : (
            "Memuat pengecualian…"
          )}
        </p>
        <ExceptionsTable
          actionsDisabled={actionsDisabled}
          error={exceptions.error}
          isLoading={exceptions.isPending || exceptions.isPlaceholderData}
          list={list}
          onFollowUp={setSelected}
          onRefresh={() => void handleRefresh()}
          onRetry={handleRetry}
          page={exceptions.error ? undefined : exceptions.data}
          pendingRetryId={retry.isPending ? retry.variables : undefined}
          role={role}
        />
      </div>
      {selected ? (
        <ExceptionFollowUpDialog
          entry={selected}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
    </div>
  );
}
