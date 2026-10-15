import {
  EXCEPTION_CRITICAL_MINUTES,
  EXCEPTION_WARNING_MINUTES,
  type ExceptionPage,
} from "@esim-erp/contracts";
import { CircleAlert, Clock3, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { formatIdr } from "@/lib/format";

type ExceptionAlertsProps = { readonly page: ExceptionPage };

export function ExceptionAlerts({ page }: ExceptionAlertsProps) {
  const hasUncertainty = page.exceptions.some(
    (entry) =>
      entry.kinds.includes("reconciliation") ||
      entry.kinds.includes("supplier_unknown"),
  );
  const hasUnissued = page.exceptions.some((entry) =>
    entry.kinds.includes("paid_unissued"),
  );

  if (
    page.overdueCount === 0 &&
    !hasUncertainty &&
    !hasUnissued &&
    page.blockedByBalanceCount === 0 &&
    page.supplierBalanceIdr !== null
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {page.overdueCount > 0 || hasUncertainty ? (
        <Alert role="status" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Prioritaskan penanganan</AlertTitle>
          <AlertDescription>
            {page.overdueCount > 0 ? (
              <p>
                {page.overdueCount} order dalam hasil pencarian dan jenis ini
                telah menunggu {EXCEPTION_CRITICAL_MINUTES} menit atau lebih.
                Periksa penyebab penundaan pada detail order.
              </p>
            ) : null}
            {hasUncertainty ? (
              <p>
                Ada pembayaran atau hasil supplier yang belum pasti. Periksa
                statusnya sebelum mencoba ulang.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : hasUnissued ? (
        <Alert role="status" variant="warning">
          <Clock3 aria-hidden="true" />
          <AlertTitle>Profil belum terbit</AlertTitle>
          <AlertDescription>
            Order lunas menunggu profil setidaknya {EXCEPTION_WARNING_MINUTES}{" "}
            menit. Periksa antrean dan saldo; prioritaskan yang menunggu{" "}
            {EXCEPTION_CRITICAL_MINUTES} menit atau lebih.
          </AlertDescription>
        </Alert>
      ) : null}
      {page.blockedByBalanceCount > 0 ? (
        <Alert role="status" variant="warning">
          <Wallet aria-hidden="true" />
          <AlertTitle>Antrean tertahan saldo</AlertTitle>
          <AlertDescription>
            <p>
              {page.blockedByBalanceCount} permintaan dari seluruh antrean
              tertahan: biaya paket melebihi saldo tercatat
              {page.supplierBalanceIdr === null
                ? "."
                : ` ${formatIdr(page.supplierBalanceIdr)}.`}{" "}
              Periksa saldo sebelum memproses lagi.
            </p>
            <p>Saldo belum diverifikasi ke supplier.</p>
          </AlertDescription>
        </Alert>
      ) : page.supplierBalanceIdr === null ? (
        <Alert role="status" variant="warning">
          <Wallet aria-hidden="true" />
          <AlertTitle>Saldo supplier belum tersedia</AlertTitle>
          <AlertDescription>
            Periksa saldo tercatat sebelum memproses antrean. Supplier belum
            terhubung.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
