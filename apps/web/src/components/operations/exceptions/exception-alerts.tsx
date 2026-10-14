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
                Ada pembayaran atau hasil supplier yang belum pasti pada halaman
                ini. Rekonsiliasi pembayaran atau periksa hasil supplier sebelum
                tindakan lain; jangan coba ulang hasil yang belum pasti.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : hasUnissued ? (
        <Alert role="status" variant="warning">
          <Clock3 aria-hidden="true" />
          <AlertTitle>Profil belum terbit</AlertTitle>
          <AlertDescription>
            Order lunas yang belum memiliki profil siap masuk inbox setelah{" "}
            {EXCEPTION_WARNING_MINUTES} menit. Periksa status antrean dan saldo
            tercatat; usia {EXCEPTION_CRITICAL_MINUTES} menit atau lebih perlu
            diprioritaskan.
          </AlertDescription>
        </Alert>
      ) : null}
      {page.blockedByBalanceCount > 0 ? (
        <Alert role="status" variant="warning">
          <Wallet aria-hidden="true" />
          <AlertTitle>Antrean tertahan saldo</AlertTitle>
          <AlertDescription>
            <p>
              {page.blockedByBalanceCount} job lunas tanpa flag pada seluruh
              antrean memiliki biaya snapshot di atas saldo tercatat
              {page.supplierBalanceIdr === null
                ? "."
                : ` ${formatIdr(page.supplierBalanceIdr)}.`}{" "}
              Minta admin atau operasional memeriksa saldo sebelum pemrosesan
              dilanjutkan. Jumlah ini tidak mengikuti filter inbox.
            </p>
            <p>
              Saldo dan integrasi supplier belum diverifikasi dengan supplier
              produksi.
            </p>
          </AlertDescription>
        </Alert>
      ) : page.supplierBalanceIdr === null ? (
        <Alert role="status" variant="warning">
          <Wallet aria-hidden="true" />
          <AlertTitle>Saldo supplier belum tersedia</AlertTitle>
          <AlertDescription>
            Periksa catatan saldo sebelum memproses antrean. Saldo dan integrasi
            supplier belum diverifikasi dengan supplier produksi.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
