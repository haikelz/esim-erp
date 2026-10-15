"use client";

import { type ColumnDef, useTable } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { type FormEvent, type ReactNode, useId } from "react";
import { ErrorNotice } from "@/components/common/data-state";
import {
  DataGrid,
  type DataGridFeatures,
  dataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import {
  Frame,
  FrameFooter,
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
import type { useListQuery } from "@/hooks/list-query";

type RecordsTableProps<Row extends { id: string }> = {
  readonly columns: ColumnDef<DataGridFeatures, Row>[];
  readonly emptyAction?: ReactNode;
  readonly emptyDescription: string;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly list?: ReturnType<typeof useListQuery>;
  readonly onRetry: () => void;
  readonly rows: Row[];
  readonly searchPlaceholder?: string;
  readonly showSearch?: boolean;
  readonly title: string;
  readonly total: number;
};

export function RecordsTable<Row extends { id: string }>({
  columns,
  emptyAction,
  emptyDescription,
  error,
  isLoading,
  list,
  onRetry,
  rows,
  searchPlaceholder = "Cari nama, paket, atau nomor…",
  showSearch = true,
  title,
  total,
}: RecordsTableProps<Row>) {
  const searchId = useId();
  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: rows,
    enableSorting: false,
    getRowId: (row: Row) => row.id,
    manualPagination: true,
    rowCount: total,
    state: { pagination: list?.pagination ?? { pageIndex: 0, pageSize: 5 } },
    onPaginationChange: list?.onPaginationChange,
  });

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = new FormData(event.currentTarget).get("search");
    if (typeof search === "string") list?.setSearch(search);
  }

  const emptyState = (
    <Empty role="status">
      <EmptyHeader>
        <EmptyTitle>Belum ada hasil</EmptyTitle>
        <EmptyDescription>
          {list?.query.search
            ? "Tidak ada hasil untuk pencarian ini. Coba kata kunci lain."
            : emptyDescription}
        </EmptyDescription>
      </EmptyHeader>
      {list?.query.search || (list && list.query.page > 1) ? (
        <Button
          onClick={() => list.setSearch("")}
          size="sm"
          type="button"
          variant="outline"
        >
          {list.query.search ? "Reset pencarian" : "Kembali ke halaman pertama"}
        </Button>
      ) : (
        (emptyAction ?? (
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            Muat ulang
          </Button>
        ))
      )}
    </Empty>
  );

  return (
    <DataGrid
      emptyMessage={emptyState}
      isLoading={isLoading}
      loadingMessage="Memuat data…"
      recordCount={total}
      table={table}
      tableClassNames={{ base: "min-w-[760px]" }}
      tableLayout={{ dense: true, width: "fixed" }}
    >
      <Frame className="min-w-0 w-full" dense stacked>
        <FrameHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <FrameTitle>
            <h2>{title}</h2>
          </FrameTitle>
          {list && showSearch ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-sm"
              key={list.query.search}
              onSubmit={handleSearch}
            >
              <label className="sr-only" htmlFor={searchId}>
                Cari {title.toLowerCase()}
              </label>
              <Input
                defaultValue={list.query.search}
                id={searchId}
                maxLength={100}
                name="search"
                placeholder={searchPlaceholder}
                type="search"
              />
              <Button
                aria-label={`Cari ${title.toLowerCase()}`}
                size="icon-sm"
                type="submit"
                variant="outline"
              >
                <Search aria-hidden="true" />
              </Button>
            </form>
          ) : null}
        </FrameHeader>
        {/* This keeps the installed c-data-grid-23 example's unpadded table panel. */}
        <FramePanel className="p-0">
          {error ? (
            <div className="p-4">
              <ErrorNotice error={error} onRetry={onRetry} />
            </div>
          ) : (
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          )}
        </FramePanel>
        {list ? (
          <FrameFooter>
            <DataGridPagination
              info="{from}–{to} dari {count} baris"
              nextPageLabel="Halaman berikutnya"
              previousPageLabel="Halaman sebelumnya"
              rowsPerPageLabel="Baris per halaman"
              sizes={[5, 10, 25, 50]}
            />
          </FrameFooter>
        ) : null}
      </Frame>
    </DataGrid>
  );
}
