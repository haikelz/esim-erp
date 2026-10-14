"use client";

import { type FinancePeriod, financePeriodSchema } from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FinancePeriodFilterProps = {
  readonly helpText?: string;
  readonly onReset: () => void;
  readonly onSubmit: (period: FinancePeriod) => void;
  readonly period: FinancePeriod | undefined;
};

export function FinancePeriodFilter({
  helpText = "Kedua tanggal terbit tercakup (WIB). Status dan penyesuaian mengikuti kondisi saat ini, bukan saldo historis. Pencarian hanya membatasi tabel dan CSV.",
  onReset,
  onSubmit,
  period,
}: FinancePeriodFilterProps) {
  const form = useForm<FinancePeriod>({
    defaultValues: period ?? {},
    resolver: zodResolver(financePeriodSchema),
  });
  const errors = form.formState.errors;

  return (
    <Frame spacing="sm">
      <FramePanel>
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="finance-from">Terbit dari tanggal (WIB)</Label>
              <Input
                aria-describedby={
                  errors.from ? "finance-from-error" : undefined
                }
                aria-invalid={Boolean(errors.from)}
                id="finance-from"
                type="date"
                {...form.register("from", {
                  setValueAs: (value: unknown) =>
                    value === "" ? undefined : value,
                })}
              />
              {errors.from ? (
                <p className="text-xs text-destructive" id="finance-from-error">
                  {errors.from.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="finance-to">Terbit sampai tanggal (WIB)</Label>
              <Input
                aria-describedby={errors.to ? "finance-to-error" : undefined}
                aria-invalid={Boolean(errors.to)}
                id="finance-to"
                type="date"
                {...form.register("to", {
                  setValueAs: (value: unknown) =>
                    value === "" ? undefined : value,
                })}
              />
              {errors.to ? (
                <p className="text-xs text-destructive" id="finance-to-error">
                  {errors.to.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:pt-6">
              <Button size="sm" type="submit">
                Terapkan periode
              </Button>
              <Button
                onClick={onReset}
                size="sm"
                type="button"
                variant="outline"
              >
                Semua periode
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{helpText}</p>
        </form>
      </FramePanel>
    </Frame>
  );
}
