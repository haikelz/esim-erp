import type { ReactNode } from "react";

type PageHeaderProps = {
  readonly action?: ReactNode;
  readonly description: string;
  readonly title: string;
};

export function PageHeader({ action, description, title }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
