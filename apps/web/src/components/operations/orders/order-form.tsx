"use client";

import { type OrderInput, orderInputSchema } from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { ErrorNotice } from "@/components/common/data-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/reui/alert";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
import { useProducts } from "@/hooks/catalog";
import { useCreateOrder } from "@/hooks/orders";
import { formatIdr, formatQuota } from "@/lib/format";
import { HttpError } from "@/lib/http";

export function OrderForm() {
  const router = useRouter();
  const form = useForm<z.input<typeof orderInputSchema>, unknown, OrderInput>({
    defaultValues: {
      productId: "",
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      note: "",
      supplierScenario: "success",
    },
    resolver: zodResolver(orderInputSchema),
  });
  const catalog = useProducts({ page: 1, limit: 50, search: "" });
  const create = useCreateOrder();

  async function handleSubmit(values: OrderInput) {
    try {
      const order = await create.mutateAsync(values);
      toast.success(
        `Order ${order.number} dibuat. Invoice menunggu pembayaran.`,
      );
      router.push(`/app/orders/${order.id}`);
    } catch (error) {
      const message =
        error instanceof HttpError && error.code === "connection_failed"
          ? "Respons pembuatan order tidak diterima. Periksa daftar order sebelum mengirim ulang agar tidak membuat duplikat."
          : error instanceof Error
            ? error.message
            : "Order belum dapat dibuat.";
      form.setError("root", { message });
    }
  }

  const availablePackages =
    catalog.data?.products.filter((product) => product.isActive) ?? [];
  const selectedPackage = availablePackages.find(
    (product) => product.id === form.watch("productId"),
  );
  const packageOptions = availablePackages.map((product) => ({
    value: product.id,
    label: `${product.name} · ${formatQuota(product.dataMb)} / ${product.validityDays} hari`,
  }));

  return (
    <>
      <PageHeader
        description="Invoice diterbitkan otomatis saat order dibuat."
        title="Buat order"
      />
      <form
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]"
        noValidate
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <Frame>
            <FrameHeader>
              <FrameTitle>
                <h2>Data pelanggan</h2>
              </FrameTitle>
            </FrameHeader>
            <FramePanel className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="customer-name">Nama pelanggan</Label>
                <Input
                  aria-describedby={
                    form.formState.errors.customerName
                      ? "customer-name-error"
                      : undefined
                  }
                  aria-invalid={Boolean(form.formState.errors.customerName)}
                  autoComplete="name"
                  id="customer-name"
                  maxLength={100}
                  {...form.register("customerName")}
                />
                {form.formState.errors.customerName ? (
                  <p
                    className="text-sm text-destructive"
                    id="customer-name-error"
                  >
                    {form.formState.errors.customerName.message}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-email">Email pelanggan</Label>
                <Input
                  aria-describedby={
                    form.formState.errors.customerEmail
                      ? "customer-email-error"
                      : undefined
                  }
                  aria-invalid={Boolean(form.formState.errors.customerEmail)}
                  autoComplete="email"
                  id="customer-email"
                  maxLength={254}
                  type="email"
                  {...form.register("customerEmail")}
                />
                {form.formState.errors.customerEmail ? (
                  <p
                    className="text-sm text-destructive"
                    id="customer-email-error"
                  >
                    {form.formState.errors.customerEmail.message}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-phone">Nomor telepon</Label>
                <Input
                  aria-describedby={
                    form.formState.errors.customerPhone
                      ? "customer-phone-error"
                      : undefined
                  }
                  aria-invalid={Boolean(form.formState.errors.customerPhone)}
                  autoComplete="tel"
                  id="customer-phone"
                  maxLength={21}
                  type="tel"
                  {...form.register("customerPhone")}
                />
                {form.formState.errors.customerPhone ? (
                  <p
                    className="text-sm text-destructive"
                    id="customer-phone-error"
                  >
                    {form.formState.errors.customerPhone.message}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="order-note">Catatan internal (opsional)</Label>
                <Textarea
                  aria-describedby={
                    form.formState.errors.note ? "order-note-error" : undefined
                  }
                  aria-invalid={Boolean(form.formState.errors.note)}
                  id="order-note"
                  maxLength={500}
                  rows={3}
                  {...form.register("note")}
                />
                {form.formState.errors.note ? (
                  <p className="text-sm text-destructive" id="order-note-error">
                    {form.formState.errors.note.message}
                  </p>
                ) : null}
              </div>
            </FramePanel>
          </Frame>
          <Frame>
            <FrameHeader>
              <FrameTitle>
                <h2>Paket eSIM</h2>
              </FrameTitle>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-4">
              {catalog.isPending ? (
                <Skeleton
                  aria-label="Memuat paket"
                  className="h-8 w-full"
                  role="status"
                />
              ) : catalog.error ? (
                <ErrorNotice
                  error={catalog.error}
                  onRetry={() => {
                    void catalog.refetch();
                  }}
                />
              ) : availablePackages.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>Tidak ada paket aktif</EmptyTitle>
                    <EmptyDescription>
                      Minta admin mengaktifkan paket sebelum membuat order.
                    </EmptyDescription>
                  </EmptyHeader>
                  <Button
                    nativeButton={false}
                    render={<Link href="/app/products" />}
                    size="sm"
                    variant="outline"
                  >
                    Buka katalog
                  </Button>
                </Empty>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="order-package">Pilih paket</Label>
                  <Controller
                    control={form.control}
                    name="productId"
                    render={({ field }) => (
                      <Select
                        items={packageOptions}
                        onValueChange={(value) => {
                          if (value !== null) field.onChange(value);
                        }}
                        value={field.value}
                      >
                        <SelectTrigger
                          aria-describedby={
                            form.formState.errors.productId
                              ? "order-package-error"
                              : undefined
                          }
                          aria-invalid={Boolean(
                            form.formState.errors.productId,
                          )}
                          className="w-full"
                          id="order-package"
                          onBlur={field.onBlur}
                          ref={field.ref}
                        >
                          <SelectValue placeholder="Pilih paket eSIM" />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          {packageOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {form.formState.errors.productId ? (
                    <p
                      className="text-sm text-destructive"
                      id="order-package-error"
                    >
                      {form.formState.errors.productId.message}
                    </p>
                  ) : null}
                </div>
              )}
            </FramePanel>
          </Frame>
        </div>
        <Frame>
          <FrameHeader>
            <FrameTitle>
              <h2>Ringkasan order</h2>
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="flex flex-col gap-4">
            {selectedPackage ? (
              <dl className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">Paket</dt>
                  <dd className="font-medium">{selectedPackage.name}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">Cakupan</dt>
                  <dd>{selectedPackage.countries.join(", ")}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    Kuota / masa berlaku
                  </dt>
                  <dd className="tabular-nums">
                    {formatQuota(selectedPackage.dataMb)} /{" "}
                    {selectedPackage.validityDays} hari
                  </dd>
                </div>
                <div className="flex flex-col gap-1 border-t pt-3">
                  <dt className="text-xs text-muted-foreground">
                    Total invoice
                  </dt>
                  <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                    {formatIdr(selectedPackage.sellingPriceIdr)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pilih paket untuk melihat total invoice.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Penerbitan profil diproses setelah pembayaran.
            </p>
            {form.formState.errors.root ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button disabled={create.isPending} type="submit">
              {create.isPending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : null}
              Buat order
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/app/orders" />}
              type="button"
              variant="outline"
            >
              Kembali ke order
            </Button>
          </FramePanel>
        </Frame>
      </form>
    </>
  );
}
