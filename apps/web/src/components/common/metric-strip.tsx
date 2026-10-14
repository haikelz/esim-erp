import { Frame, FramePanel } from "@/components/reui/frame";
import { Skeleton } from "@/components/ui/skeleton";

type MetricStripProps = {
  readonly isLoading: boolean;
  readonly metrics: {
    readonly label: string;
    readonly value: string;
    readonly description: string;
  }[];
};

export function MetricStrip({ isLoading, metrics }: MetricStripProps) {
  return (
    <Frame
      aria-label={isLoading ? "Memuat ringkasan" : "Ringkasan operasional"}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      role={isLoading ? "status" : undefined}
    >
      {metrics.map((metric) => (
        <FramePanel key={metric.label}>
          <dl className="flex flex-col gap-2">
            <dt className="text-xs font-medium text-muted-foreground">
              {metric.label}
            </dt>
            <dd className="text-2xl font-semibold tracking-tight tabular-nums">
              {isLoading ? <Skeleton className="h-8 w-28" /> : metric.value}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {metric.description}
            </dd>
          </dl>
        </FramePanel>
      ))}
    </Frame>
  );
}
