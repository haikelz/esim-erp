"use client";

import {
  type Product,
  type ProductUpdate,
  productUpdateSchema,
} from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateProduct } from "@/hooks/catalog";
import { formatIdr } from "@/lib/format";

type ProductFormDialogProps = {
  readonly onClose: () => void;
  readonly product: Product;
};

export function ProductFormDialog({
  onClose,
  product,
}: ProductFormDialogProps) {
  const form = useForm<ProductUpdate>({
    defaultValues: {
      sellingPriceIdr: product.sellingPriceIdr,
      isActive: product.isActive,
    },
    resolver: zodResolver(productUpdateSchema),
  });
  const update = useUpdateProduct();

  async function handleSubmit(values: ProductUpdate) {
    try {
      await update.mutateAsync({ id: product.id, values });
      toast.success(
        "Paket diperbarui. Harga order yang sudah dibuat tetap sama.",
      );
      onClose();
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Paket belum dapat disimpan.",
      });
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !update.isPending) onClose();
      }}
      open
    >
      <DialogContent showCloseButton={!update.isPending}>
        <DialogHeader>
          <DialogTitle>Edit paket</DialogTitle>
          <DialogDescription>
            {product.name} · Biaya supplier {formatIdr(product.supplierCostIdr)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit(handleSubmit)}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-price">Harga jual (Rp)</Label>
            <Input
              aria-describedby="product-price-help product-price-error"
              aria-invalid={Boolean(form.formState.errors.sellingPriceIdr)}
              id="product-price"
              inputMode="numeric"
              min={1000}
              step={1}
              type="number"
              {...form.register("sellingPriceIdr", { valueAsNumber: true })}
            />
            <p
              className="text-xs text-muted-foreground"
              id="product-price-help"
            >
              Gunakan rupiah bulat, tanpa titik pemisah.
            </p>
            {form.formState.errors.sellingPriceIdr ? (
              <p className="text-sm text-destructive" id="product-price-error">
                {form.formState.errors.sellingPriceIdr.message}
              </p>
            ) : null}
          </div>
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <Label className="justify-between" htmlFor="product-active">
                Tersedia untuk order baru
                <Switch
                  checked={field.value}
                  id="product-active"
                  onCheckedChange={field.onChange}
                />
              </Label>
            )}
          />
          {form.formState.errors.root ? (
            <Alert variant="destructive">
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              disabled={update.isPending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Batal
            </Button>
            <Button disabled={update.isPending} type="submit">
              {update.isPending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : null}
              Simpan paket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
