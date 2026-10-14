const IDR_FORMAT = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export function formatIdr(amount: number) {
  return IDR_FORMAT.format(amount);
}

export function formatDate(value: string) {
  return DATE_FORMAT.format(new Date(value));
}

export function formatQuota(dataMb: number) {
  return `${dataMb / 1024} GB`;
}
