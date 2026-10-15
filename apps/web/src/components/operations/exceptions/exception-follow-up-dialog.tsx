"use client";

import {
  type ExceptionFollowUpInput,
  exceptionFollowUpInputSchema,
  FOLLOW_UP_OUTCOMES,
} from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ErrorNotice } from "@/components/common/data-state";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useExceptionAssignees,
  useExceptionFollowUps,
  useRecordExceptionFollowUp,
} from "@/hooks/exceptions";
import { formatDate } from "@/lib/format";
import { type ExceptionEntry, FOLLOW_UP_LABELS } from "./exceptions-table";

const OUTCOME_OPTIONS = FOLLOW_UP_OUTCOMES.map((value) => ({
  value,
  label: FOLLOW_UP_LABELS[value],
}));

type ExceptionFollowUpDialogProps = {
  readonly entry: ExceptionEntry;
  readonly onClose: () => void;
};

export function ExceptionFollowUpDialog({
  entry,
  onClose,
}: ExceptionFollowUpDialogProps) {
  const [page, setPage] = useState(1);
  const form = useForm<ExceptionFollowUpInput>({
    defaultValues: {
      assigneeId: entry.followUp?.assignee?.id ?? null,
      outcome: entry.followUp?.outcome ?? "investigating",
      note: "",
    },
    resolver: zodResolver(exceptionFollowUpInputSchema),
  });
  const assignees = useExceptionAssignees();
  const history = useExceptionFollowUps(entry.order.id, page);
  const record = useRecordExceptionFollowUp();
  const errors = form.formState.errors;
  const isUnavailable =
    record.isPending ||
    assignees.isPending ||
    history.isPending ||
    Boolean(assignees.error || history.error);
  const assigneeOptions = [
    { value: "none", label: "Belum ditugaskan" },
    ...(assignees.data?.assignees ?? []).map((staff) => ({
      value: staff.id,
      label: staff.name,
    })),
  ];

  async function handleSubmit(values: ExceptionFollowUpInput) {
    try {
      await record.mutateAsync({ orderId: entry.order.id, values });
      form.reset({ ...values, note: "" });
      setPage(1);
      toast.success("Tindak lanjut dicatat.");
    } catch (error) {
      form.setError("root", {
        message: `${error instanceof Error ? error.message : "Tindak lanjut belum dapat dipastikan."} Periksa riwayat sebelum mencoba lagi.`,
      });
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !record.isPending) onClose();
      }}
      open
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        finalFocus={() =>
          document.getElementById(`exception-follow-up-${entry.order.id}`)
        }
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Tindak lanjut {entry.order.number}</DialogTitle>
          <DialogDescription>
            Catatan ini tidak menyelesaikan pengecualian atau mengubah status
            order.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit(handleSubmit)}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="follow-up-assignee">Penanggung jawab</Label>
            <Controller
              control={form.control}
              name="assigneeId"
              render={({ field }) => (
                <Select
                  disabled={isUnavailable}
                  items={assigneeOptions}
                  onValueChange={(value) =>
                    field.onChange(value === "none" ? null : value)
                  }
                  value={field.value ?? "none"}
                >
                  <SelectTrigger
                    aria-invalid={Boolean(errors.assigneeId)}
                    className="w-full"
                    id="follow-up-assignee"
                    onBlur={field.onBlur}
                    ref={field.ref}
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assigneeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {assignees.error ? (
              <ErrorNotice
                error={assignees.error}
                onRetry={() => {
                  void assignees.refetch();
                }}
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="follow-up-outcome">Hasil sementara</Label>
            <Controller
              control={form.control}
              name="outcome"
              render={({ field }) => (
                <Select
                  disabled={isUnavailable}
                  items={OUTCOME_OPTIONS}
                  onValueChange={(value) => {
                    if (value) field.onChange(value);
                  }}
                  value={field.value}
                >
                  <SelectTrigger
                    aria-invalid={Boolean(errors.outcome)}
                    className="w-full"
                    id="follow-up-outcome"
                    onBlur={field.onBlur}
                    ref={field.ref}
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOME_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="follow-up-note">Catatan</Label>
            <Textarea
              aria-describedby={
                errors.note
                  ? "follow-up-note-help follow-up-note-error"
                  : "follow-up-note-help"
              }
              aria-invalid={Boolean(errors.note)}
              disabled={isUnavailable}
              id="follow-up-note"
              maxLength={1000}
              rows={3}
              {...form.register("note")}
            />
            <p
              className="text-xs text-muted-foreground"
              id="follow-up-note-help"
            >
              Tulis langkah pemeriksaan atau hasilnya; minimal tiga karakter.
            </p>
            {errors.note ? (
              <p className="text-xs text-destructive" id="follow-up-note-error">
                {errors.note.message}
              </p>
            ) : null}
          </div>
          {errors.root ? (
            <Alert variant="destructive">
              <AlertDescription>{errors.root.message}</AlertDescription>
            </Alert>
          ) : null}
          <section
            aria-labelledby="follow-up-history"
            className="flex flex-col gap-3 border-t pt-4"
          >
            <h3 className="text-sm font-semibold" id="follow-up-history">
              Riwayat tindak lanjut
            </h3>
            {history.isPending ? (
              <div
                aria-label="Memuat riwayat"
                className="flex flex-col gap-3"
                role="status"
              >
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : history.error ? (
              <ErrorNotice
                error={history.error}
                onRetry={() => {
                  void history.refetch();
                }}
              />
            ) : history.data?.followUps.length ? (
              <ol className="flex flex-col gap-3">
                {history.data.followUps.map((followUp) => (
                  <li
                    className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0"
                    key={followUp.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="info-light">
                        {FOLLOW_UP_LABELS[followUp.outcome]}
                      </Badge>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={followUp.createdAt}
                      >
                        {formatDate(followUp.createdAt)} WIB
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {followUp.note}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Dicatat {followUp.actorName} ·{" "}
                      {followUp.assignee?.name ?? "Belum ditugaskan"}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                Belum ada catatan. Simpan tindak lanjut untuk mencatat
                pemeriksaan.
              </p>
            )}
            {history.data && history.data.total > 10 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {(page - 1) * 10 + 1}–
                  {Math.min(page * 10, history.data.total)} dari{" "}
                  {history.data.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    disabled={page === 1 || history.isFetching}
                    onClick={() => setPage((current) => current - 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    disabled={
                      page * 10 >= history.data.total || history.isFetching
                    }
                    onClick={() => setPage((current) => current + 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
          <DialogFooter>
            <Button
              disabled={record.isPending}
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              Tutup
            </Button>
            <Button
              aria-busy={record.isPending}
              disabled={isUnavailable}
              size="sm"
              type="submit"
            >
              {record.isPending ? "Menyimpan…" : "Simpan tindak lanjut"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
