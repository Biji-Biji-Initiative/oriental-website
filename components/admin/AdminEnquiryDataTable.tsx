"use client";

import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type Row,
  type RowSelectionState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
  ExternalLinkIcon,
  MailIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  UserRoundCogIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AdminLeadWorkflowForm } from "@/components/admin/AdminLeadWorkflowForm";
import { Badge } from "@/components/admin/Badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ADMIN_LEAD_OWNERS,
  type AdminLeadPriority,
  type AdminLeadStatus,
  adminLeadPriorityLabels,
  adminLeadSlaState,
  adminLeadStatusLabels,
  normalizeAdminLeadPriority,
  normalizeAdminLeadStatus,
} from "@/lib/admin-workflow";
import { getSegment } from "@/lib/segments";

export type AdminEnquiryRow = {
  leadId: string;
  name: string;
  email: string;
  org: string;
  message: string;
  source: "voice" | "form" | "hero-email";
  segment: string;
  routedTo: string;
  status: string;
  priority?: string;
  owner?: string;
  nextActionAt?: number;
  nextActionNote?: string;
  outcomeReason?: string;
  workflowRevision?: number;
  notificationDelivered?: boolean;
  notificationEmailOk?: boolean;
  notificationSlackOk?: boolean;
  notificationClickUpOk?: boolean;
  notificationClickUpTaskUrl?: string;
  archivedAt?: number;
  archivedBy?: string;
  archiveReason?: string;
  preArchiveStatus?: string;
  restoredAt?: number;
  restoredBy?: string;
  createdAt: number;
  recordHref: string;
};

type ArchiveIntent = {
  action: "archive" | "restore";
  rows: AdminEnquiryRow[];
} | null;

type AdminEnquiryDataTableProps = {
  generatedAt: number;
  initialStatusScope?: string;
  readOnly?: boolean;
  rows: AdminEnquiryRow[];
  totalRows: number;
  totalRowsLowerBound?: boolean;
};

export function AdminEnquiryDataTable({
  generatedAt,
  initialStatusScope = "active",
  readOnly = false,
  rows,
  totalRows,
  totalRowsLowerBound = false,
}: AdminEnquiryDataTableProps) {
  const router = useRouter();
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([{ id: "status", value: initialStatusScope }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    source: false,
    ...(readOnly ? { actions: false, select: false } : {}),
  });
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [editing, setEditing] = useState<AdminEnquiryRow | null>(null);
  const [archiveIntent, setArchiveIntent] = useState<ArchiveIntent>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentOwner, setAssignmentOwner] = useState("");
  const [assignmentDue, setAssignmentDue] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const beginArchive = useCallback((action: "archive" | "restore", targets: AdminEnquiryRow[]) => {
    setArchiveReason("");
    setArchiveIntent({ action, rows: targets });
  }, []);

  const columns = useMemo<ColumnDef<AdminEnquiryRow>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
        enableSorting: false,
        header: ({ table }) =>
          readOnly ? null : (
            <Checkbox
              aria-label="Select all visible enquiries"
              checked={table.getIsAllPageRowsSelected()}
              indeterminate={table.getIsSomePageRowsSelected()}
              onCheckedChange={(checked) => table.toggleAllPageRowsSelected(Boolean(checked))}
            />
          ),
        cell: ({ row }) =>
          readOnly ? null : (
            <Checkbox
              aria-label={`Select ${row.original.name || row.original.email}`}
              checked={row.getIsSelected()}
              onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
            />
          ),
      },
      {
        id: "contact",
        accessorFn: (lead) => `${lead.name} ${lead.email} ${lead.org}`,
        header: ({ column }) => <SortableHeader column={column} label="Contact" />,
        cell: ({ row }) => (
          <div className="min-w-52 max-w-64">
            <a
              aria-label={`Open ${row.original.name || row.original.email} enquiry record`}
              className="font-semibold text-sky-300 transition hover:text-sky-200 hover:underline"
              href={row.original.recordHref}
            >
              {row.original.name.trim() || "Unnamed visitor"}
            </a>
            <div className="mt-1 truncate text-xs text-slate-400">
              {row.original.org.trim() || "Organisation not captured"}
            </div>
            <a
              className="mt-1 block truncate text-xs font-medium text-slate-300 transition hover:text-sky-300 hover:underline"
              href={`mailto:${encodeURIComponent(row.original.email)}`}
            >
              {row.original.email}
            </a>
          </div>
        ),
      },
      {
        id: "request",
        accessorFn: (lead) => `${lead.message} ${getSegment(lead.segment).label}`,
        header: ({ column }) => <SortableHeader column={column} label="Request" />,
        cell: ({ row }) => (
          <div className="min-w-64 max-w-md whitespace-normal">
            <p className="line-clamp-2 text-sm leading-5">
              {row.original.message.trim() || "No request brief captured."}
            </p>
            <p className="mt-1.5 text-xs text-slate-400">{getSegment(row.original.segment).label}</p>
          </div>
        ),
      },
      {
        accessorKey: "owner",
        header: ({ column }) => <SortableHeader column={column} label="Owner" />,
        filterFn: exactFilter,
        cell: ({ row }) => (
          <Badge tone={row.original.owner?.trim() ? "green" : "amber"}>
            {row.original.owner?.trim() || "Unassigned"}
          </Badge>
        ),
      },
      {
        id: "status",
        accessorFn: (lead) => normalizeAdminLeadStatus(lead.status),
        header: ({ column }) => <SortableHeader column={column} label="Pipeline" />,
        filterFn: statusFilter,
        cell: ({ row }) => {
          const status = normalizeAdminLeadStatus(row.original.status);
          return <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>;
        },
      },
      {
        id: "priority",
        accessorFn: (lead) => normalizeAdminLeadPriority(lead.priority),
        header: ({ column }) => <SortableHeader column={column} label="Priority" />,
        filterFn: exactFilter,
        cell: ({ row }) => {
          const priority = normalizeAdminLeadPriority(row.original.priority);
          return <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>;
        },
      },
      {
        id: "sla",
        accessorFn: (lead) =>
          adminLeadSlaState(normalizeAdminLeadStatus(lead.status), lead.nextActionAt, generatedAt).state,
        header: ({ column }) => <SortableHeader column={column} label="Next action" />,
        filterFn: exactFilter,
        cell: ({ row }) => {
          const state = adminLeadSlaState(
            normalizeAdminLeadStatus(row.original.status),
            row.original.nextActionAt,
            generatedAt,
          );
          return (
            <div className="min-w-44 max-w-56 whitespace-normal">
              <Badge tone={slaTone(state.state)}>{state.label}</Badge>
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-400">
                {row.original.nextActionNote?.trim() || "No next action recorded"}
              </p>
            </div>
          );
        },
      },
      {
        id: "source",
        accessorFn: (lead) => lead.source,
        header: ({ column }) => <SortableHeader column={column} label="Source" />,
        filterFn: exactFilter,
        cell: ({ row }) => (
          <div>
            <Badge tone={row.original.source === "voice" ? "blue" : "neutral"}>
              {sourceLabel(row.original.source)}
            </Badge>
            <p className="mt-1.5 text-xs text-slate-400">Route: {row.original.routedTo || "Not set"}</p>
          </div>
        ),
      },
      {
        id: "delivery",
        accessorFn: (lead) => deliveryState(lead).label,
        header: ({ column }) => <SortableHeader column={column} label="Delivery" />,
        cell: ({ row }) => {
          const delivery = deliveryState(row.original);
          return (
            <div className="min-w-28">
              <Badge tone={delivery.tone}>{delivery.label}</Badge>
              <p className="mt-1.5 text-xs text-slate-400">
                {row.original.notificationClickUpOk === true ? "ClickUp synced" : "ClickUp gap"}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortableHeader column={column} label="Received" />,
        cell: ({ row }) => (
          <div className="min-w-28">
            <div className="font-semibold">{relativeAge(row.original.createdAt, generatedAt)}</div>
            <div className="mt-1 text-xs text-slate-400">{formatDate(row.original.createdAt)}</div>
          </div>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) =>
          readOnly ? null : (
            <RowActions
              lead={row.original}
              onArchive={(action) => beginArchive(action, [row.original])}
              onEdit={() => setEditing(row.original)}
            />
          ),
      },
    ],
    [beginArchive, generatedAt, readOnly],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnFilters, columnVisibility, globalFilter, rowSelection, sorting },
    enableRowSelection: !readOnly,
    getRowId: (row) => row.leadId,
    globalFilterFn: globalLeadFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 15 } },
  });

  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);
  const assignableRows = selectedRows.filter((lead) => {
    const status = normalizeAdminLeadStatus(lead.status);
    return status !== "archived" && status !== "qualified";
  });
  const archivableRows = selectedRows.filter((lead) => normalizeAdminLeadStatus(lead.status) !== "archived");
  const restorableRows = selectedRows.filter((lead) => normalizeAdminLeadStatus(lead.status) === "archived");
  const visibleRows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;

  function resetFilters() {
    setGlobalFilter("");
    setColumnFilters([{ id: "status", value: "active" }]);
    table.setPageIndex(0);
  }

  function submitArchive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!archiveIntent) return;
    startTransition(async () => {
      const response = await fetch("/api/admin/leads/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: archiveIntent.action,
          leads: archiveIntent.rows.map((lead) => ({
            leadId: lead.leadId,
            expectedRevision: lead.workflowRevision ?? 0,
          })),
          reason: archiveReason,
        }),
      });
      const body = (await response.json().catch(() => null)) as { count?: number; error?: string } | null;
      if (!response.ok) {
        toast.error(response.status === 409 ? "Some enquiries changed before this action." : "CRM action failed.", {
          description:
            response.status === 409
              ? "The latest rows are being loaded. Review the selection and try again."
              : (body?.error ?? `HTTP ${response.status}`),
        });
        if (response.status === 409) router.refresh();
        return;
      }
      const verb = archiveIntent.action === "archive" ? "archived" : "restored";
      toast.success(`${body?.count ?? archiveIntent.rows.length} enquiries ${verb}.`);
      setArchiveIntent(null);
      setArchiveReason("");
      setRowSelection({});
      router.refresh();
    });
  }

  function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const response = await fetch("/api/admin/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: assignableRows.map((lead) => ({
            leadId: lead.leadId,
            expectedRevision: lead.workflowRevision ?? 0,
          })),
          owner: assignmentOwner,
          nextActionAt: assignmentDue ? new Date(assignmentDue).getTime() : 0,
          nextActionNote: assignmentNote,
          reason: assignmentReason,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        count?: number;
        error?: string;
        fields?: Record<string, string>;
      } | null;
      if (!response.ok) {
        const fieldMessage = body?.fields ? Object.values(body.fields)[0] : undefined;
        toast.error(response.status === 409 ? "Some enquiries changed before assignment." : "Bulk assignment failed.", {
          description:
            response.status === 409
              ? "The latest rows are being loaded. Review the selection and try again."
              : (fieldMessage ?? body?.error ?? `HTTP ${response.status}`),
        });
        if (response.status === 409) router.refresh();
        return;
      }
      toast.success(`${body?.count ?? assignableRows.length} enquiries assigned to ${assignmentOwner}.`);
      setAssignmentOpen(false);
      setAssignmentNote("");
      setAssignmentReason("");
      setRowSelection({});
      router.refresh();
    });
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)]"
      data-admin-enquiry-table
      id="enquiry-table"
    >
      <header className="border-b border-white/10 bg-gradient-to-r from-sky-400/[0.09] via-blue-400/[0.035] to-transparent px-4 py-5 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Enquiry pipeline</h2>
              <Badge tone="blue">{filteredCount} visible</Badge>
              <Badge tone="neutral">
                {totalRowsLowerBound ? "≥" : ""}
                {totalRows} canonical{totalRowsLowerBound ? " · lower bound" : ""}
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              Search every captured field, control the columns, sort the pipeline, edit workflow, and archive or restore
              records without deleting customer evidence immediately. Archived records remain recoverable during the
              published two-year retention window.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Badge tone="green">Convex canonical</Badge>
            <span>Up to 500 newest enquiries loaded · archived hidden by default</span>
          </div>
        </div>
      </header>

      <div className="grid gap-3 border-b border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <label className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              aria-label="Search enquiries"
              className="h-10 border-white/10 bg-white/[0.04] pl-9 text-slate-100 placeholder:text-slate-500"
              onChange={(event) => {
                setGlobalFilter(event.target.value);
                table.setPageIndex(0);
              }}
              placeholder="Search name, email, organisation, request, owner, source, route…"
              value={globalFilter}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              label="Status"
              onChange={(value) => {
                table.getColumn("status")?.setFilterValue(value);
                table.setPageIndex(0);
              }}
              options={[
                ["active", "Active + qualified"],
                ["all", "All records"],
                ["new", "New"],
                ["reviewing", "Reviewing"],
                ["contacted", "Contacted"],
                ["qualified", "Qualified"],
                ["archived", "Archived"],
              ]}
              value={(table.getColumn("status")?.getFilterValue() as string) ?? "active"}
            />
            <FilterSelect
              label="Owner"
              onChange={(value) => table.getColumn("owner")?.setFilterValue(value === "all" ? undefined : value)}
              options={[
                ["all", "All owners"],
                ["unassigned", "Unassigned"],
                ...(ADMIN_LEAD_OWNERS.map((owner) => [owner, owner]) as Array<[string, string]>),
              ]}
              value={(table.getColumn("owner")?.getFilterValue() as string | undefined) ?? "all"}
            />
            <FilterSelect
              label="Priority"
              onChange={(value) => table.getColumn("priority")?.setFilterValue(value === "all" ? undefined : value)}
              options={[
                ["all", "All priorities"],
                ["urgent", "Urgent"],
                ["high", "High"],
                ["normal", "Normal"],
                ["low", "Low"],
              ]}
              value={(table.getColumn("priority")?.getFilterValue() as string | undefined) ?? "all"}
            />
            <FilterSelect
              label="SLA"
              onChange={(value) => table.getColumn("sla")?.setFilterValue(value === "all" ? undefined : value)}
              options={[
                ["all", "All SLA states"],
                ["overdue", "Overdue"],
                ["due-soon", "Due within 24h"],
                ["unscheduled", "Missing next action"],
                ["scheduled", "Scheduled"],
                ["closed", "Closed"],
              ]}
              value={(table.getColumn("sla")?.getFilterValue() as string | undefined) ?? "all"}
            />
            <FilterSelect
              label="Source"
              onChange={(value) => table.getColumn("source")?.setFilterValue(value === "all" ? undefined : value)}
              options={[
                ["all", "All sources"],
                ["voice", "Reka voice"],
                ["form", "Website form"],
                ["hero-email", "Email interest"],
              ]}
              value={(table.getColumn("source")?.getFilterValue() as string | undefined) ?? "all"}
            />
            <DropdownMenu onOpenChange={setColumnMenuOpen} open={columnMenuOpen}>
              <DropdownMenuTrigger
                onPointerUp={(event) => {
                  if (event.pointerType === "touch") setColumnMenuOpen(true);
                }}
                render={<Button aria-label="Choose visible columns" variant="outline" />}
              >
                <Columns3Icon /> Columns
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                  {table
                    .getAllLeafColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => (
                      <DropdownMenuCheckboxItem
                        checked={column.getIsVisible()}
                        key={column.id}
                        onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
                      >
                        {columnLabel(column.id)}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={resetFilters} variant="ghost">
              <RotateCcwIcon /> Reset
            </Button>
          </div>
        </div>

        {selectedRows.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-sky-400/25 bg-sky-400/[0.06] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold">{selectedRows.length} selected</div>
              <div className="text-xs text-slate-400">
                {assignableRows.length} assignable · {archivableRows.length} archivable · {restorableRows.length}{" "}
                restorable
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={assignableRows.length === 0} onClick={() => setAssignmentOpen(true)} variant="outline">
                <UserRoundCogIcon /> Assign selected
              </Button>
              <Button
                disabled={archivableRows.length === 0}
                onClick={() => beginArchive("archive", archivableRows)}
                variant="destructive"
              >
                <ArchiveIcon /> Archive {archivableRows.length || "selected"}
              </Button>
              <Button
                disabled={restorableRows.length === 0}
                onClick={() => beginArchive("restore", restorableRows)}
                variant="outline"
              >
                <RotateCcwIcon /> Restore {restorableRows.length || "selected"}
              </Button>
              <Button onClick={() => setRowSelection({})} variant="ghost">
                Clear
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {visibleRows.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <SlidersHorizontalIcon className="mx-auto size-7 text-slate-500" />
          <p className="mt-3 font-semibold">No enquiries match this data view.</p>
          <p className="mt-1 text-sm text-slate-400">Reset filters or switch Status to All records.</p>
          <Button className="mt-4" onClick={resetFilters} variant="outline">
            Reset filters
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden max-h-[72vh] overflow-auto lg:block" data-crm-table>
            <Table className="min-w-[1320px] border-collapse">
              <TableHeader className="sticky top-0 z-10 bg-[#0b101e]/95 text-[11px] uppercase tracking-[0.09em] text-slate-500 backdrop-blur">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead className="px-3" key={header.id}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow
                    data-lead-id={row.original.leadId}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    key={row.id}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell className="px-3 py-3.5 align-top" key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 bg-white/[0.02] p-3 lg:hidden" data-crm-mobile-cards>
            {visibleRows.map((row) => (
              <MobileEnquiryCard
                generatedAt={generatedAt}
                key={row.id}
                lead={row.original}
                onArchive={(action) => beginArchive(action, [row.original])}
                onEdit={() => setEditing(row.original)}
                onSelect={(checked) => row.toggleSelected(checked)}
                readOnly={readOnly}
                selected={row.getIsSelected()}
              />
            ))}
          </div>
        </>
      )}

      <footer className="flex flex-col gap-3 border-t border-white/10 bg-white/[0.015] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="text-xs text-slate-400">
          Showing {visibleRows.length} of {filteredCount} matching rows · {table.getSelectedRowModel().rows.length}{" "}
          selected
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Rows"
            onChange={(value) => table.setPageSize(Number(value))}
            options={[
              ["10", "10 rows"],
              ["15", "15 rows"],
              ["25", "25 rows"],
              ["50", "50 rows"],
            ]}
            value={String(table.getState().pagination.pageSize)}
          />
          <span className="px-2 text-xs font-medium">
            Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
          </span>
          <Button
            aria-label="Previous table page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            size="icon"
            variant="outline"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            aria-label="Next table page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            size="icon"
            variant="outline"
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </footer>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent
          className="max-h-[calc(100dvh-1rem)] w-[min(760px,calc(100vw-1rem))] max-w-none overflow-y-auto border border-white/10 bg-[#0b101e] sm:max-w-none"
          overlayClassName="bg-[#04060c]/70 backdrop-blur-sm"
        >
          <DialogTitle>Edit enquiry workflow</DialogTitle>
          <DialogDescription>
            Update ownership, stage, priority, next action, and the reason. Every change is revision-checked and
            audited.
          </DialogDescription>
          {editing ? (
            <AdminLeadWorkflowForm
              leadId={editing.leadId}
              initialNextActionAt={editing.nextActionAt}
              initialNextActionNote={editing.nextActionNote}
              initialOutcomeReason={editing.outcomeReason}
              initialOwner={editing.owner}
              initialPriority={normalizeAdminLeadPriority(editing.priority)}
              initialRevision={editing.workflowRevision}
              initialStatus={normalizeAdminLeadStatus(editing.status)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(archiveIntent)} onOpenChange={(open) => !open && setArchiveIntent(null)}>
        <DialogContent
          className="w-[min(560px,calc(100vw-1rem))] max-w-none border border-white/10 bg-[#0b101e] sm:max-w-none"
          overlayClassName="bg-[#04060c]/70 backdrop-blur-sm"
        >
          <DialogTitle>{archiveIntent?.action === "restore" ? "Restore enquiries" : "Archive enquiries"}</DialogTitle>
          <DialogDescription>
            {archiveIntent?.action === "restore"
              ? "Restore the selected records to their prior pipeline state. The archive history remains visible."
              : "Hide the selected records from the active pipeline. Archiving does not delete them now; the published two-year retention window and verified privacy requests still apply."}
          </DialogDescription>
          <form className="grid gap-4" onSubmit={submitArchive}>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
              Reason
              <Input
                autoFocus
                className="h-10 border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500"
                maxLength={300}
                minLength={3}
                onChange={(event) => setArchiveReason(event.target.value)}
                placeholder={
                  archiveIntent?.action === "restore" ? "New context received" : "Duplicate or no longer actionable"
                }
                required
                value={archiveReason}
              />
            </label>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">
              {archiveIntent?.rows.length ?? 0} record{archiveIntent?.rows.length === 1 ? "" : "s"} · atomic action ·
              revision checked
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setArchiveIntent(null)} type="button" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={isPending || archiveReason.trim().length < 3}
                type="submit"
                variant={archiveIntent?.action === "archive" ? "destructive" : "default"}
              >
                {isPending ? "Saving" : archiveIntent?.action === "restore" ? "Restore records" : "Archive records"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={assignmentOpen} onOpenChange={setAssignmentOpen}>
        <DialogContent
          className="w-[min(660px,calc(100vw-1rem))] max-w-none border border-white/10 bg-[#0b101e] sm:max-w-none"
          overlayClassName="bg-[#04060c]/70 backdrop-blur-sm"
        >
          <DialogTitle>Assign selected enquiries</DialogTitle>
          <DialogDescription>
            Apply one owner and one dated next action to {assignableRows.length} active records. The mutation is
            all-or-nothing.
          </DialogDescription>
          <form className="grid gap-4" onSubmit={submitAssignment}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
                Owner
                <select
                  className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                  onChange={(event) => setAssignmentOwner(event.target.value)}
                  required
                  value={assignmentOwner}
                >
                  <option value="">Choose owner</option>
                  {ADMIN_LEAD_OWNERS.map((owner) => (
                    <option key={owner} value={owner}>
                      {owner}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
                Due
                <Input
                  onChange={(event) => setAssignmentDue(event.target.value)}
                  className="h-10 border-white/10 bg-white/[0.04] text-slate-100"
                  required
                  type="datetime-local"
                  value={assignmentDue}
                />
              </label>
            </div>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
              Shared next action
              <Input
                maxLength={500}
                minLength={3}
                className="h-10 border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500"
                onChange={(event) => setAssignmentNote(event.target.value)}
                placeholder="Review context and send a tailored introduction"
                required
                value={assignmentNote}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
              Reason for assignment
              <Input
                maxLength={300}
                minLength={3}
                className="h-10 border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500"
                onChange={(event) => setAssignmentReason(event.target.value)}
                placeholder="Morning intake allocation"
                required
                value={assignmentReason}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setAssignmentOpen(false)} type="button" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={
                  isPending ||
                  assignableRows.length === 0 ||
                  !assignmentOwner ||
                  !assignmentDue ||
                  assignmentNote.trim().length < 3 ||
                  assignmentReason.trim().length < 3
                }
                type="submit"
              >
                {isPending ? "Assigning" : `Assign ${assignableRows.length}`}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SortableHeader({
  column,
  label,
}: {
  column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (desc?: boolean, multi?: boolean) => void };
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      className="inline-flex items-center gap-1 font-semibold transition hover:text-sky-300"
      onClick={(event) => column.toggleSorting(sorted === "asc", event.shiftKey)}
      type="button"
    >
      {label}
      {sorted === "asc" ? <ArrowUpIcon /> : sorted === "desc" ? <ArrowDownIcon /> : <ArrowUpDownIcon />}
    </button>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <Select onValueChange={(next) => next !== null && onChange(next)} value={value}>
      <SelectTrigger aria-label={label} className="h-10 border-white/10 bg-white/[0.04] text-slate-200">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([optionValue, optionLabel]) => (
          <SelectItem key={`${label}:${optionValue || "empty"}`} value={optionValue}>
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RowActions({
  lead,
  onArchive,
  onEdit,
}: {
  lead: AdminEnquiryRow;
  onArchive: (action: "archive" | "restore") => void;
  onEdit: () => void;
}) {
  const archived = normalizeAdminLeadStatus(lead.status) === "archived";
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
      <DropdownMenuTrigger
        onPointerUp={(event) => {
          if (event.pointerType === "touch") setMenuOpen(true);
        }}
        render={<Button aria-label={`Actions for ${lead.name || lead.email}`} size="icon" variant="ghost" />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Record actions</DropdownMenuLabel>
          <DropdownMenuItem render={<a href={lead.recordHref} />}>
            <ExternalLinkIcon /> Open complete record
          </DropdownMenuItem>
          {!archived ? (
            <DropdownMenuItem onClick={onEdit}>
              <UserRoundCogIcon /> Edit workflow
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem render={<a href={`mailto:${encodeURIComponent(lead.email)}`} />}>
            <MailIcon /> Email contact
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onArchive(archived ? "restore" : "archive")}
          variant={archived ? "default" : "destructive"}
        >
          {archived ? <RotateCcwIcon /> : <ArchiveIcon />}
          {archived ? "Restore record" : "Archive record"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileEnquiryCard({
  generatedAt,
  lead,
  onArchive,
  onEdit,
  onSelect,
  readOnly,
  selected,
}: {
  generatedAt: number;
  lead: AdminEnquiryRow;
  onArchive: (action: "archive" | "restore") => void;
  onEdit: () => void;
  onSelect: (checked: boolean) => void;
  readOnly: boolean;
  selected: boolean;
}) {
  const status = normalizeAdminLeadStatus(lead.status);
  const priority = normalizeAdminLeadPriority(lead.priority);
  const sla = adminLeadSlaState(status, lead.nextActionAt, generatedAt);
  return (
    <article
      className="rounded-xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-white/20"
      data-lead-id={lead.leadId}
    >
      <div className="flex items-start gap-3">
        {readOnly ? null : (
          <Checkbox
            aria-label={`Select ${lead.name || lead.email}`}
            checked={selected}
            onCheckedChange={(checked) => onSelect(Boolean(checked))}
          />
        )}
        <div className="min-w-0 flex-1">
          <a className="block truncate font-semibold text-sky-300 transition hover:text-sky-200" href={lead.recordHref}>
            {lead.name.trim() || "Unnamed visitor"}
          </a>
          <p className="mt-1 truncate text-xs text-slate-400">{lead.org.trim() || lead.email}</p>
        </div>
        {readOnly ? null : <RowActions lead={lead} onArchive={onArchive} onEdit={onEdit} />}
      </div>
      <p className="mt-3 line-clamp-3 text-sm leading-6">{lead.message.trim() || "No request brief captured."}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
        <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>
        <Badge tone={lead.owner?.trim() ? "green" : "amber"}>{lead.owner?.trim() || "Unassigned"}</Badge>
        <Badge tone={slaTone(sla.state)}>{sla.label}</Badge>
      </div>
      {status === "archived" ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-400">
          Archived {lead.archivedAt ? formatDate(lead.archivedAt) : "before archive metadata was introduced"}
          {lead.archivedBy ? ` by ${lead.archivedBy}` : ""}
          {lead.archiveReason ? ` · ${lead.archiveReason}` : ""}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs text-slate-400">
        <span>{sourceLabel(lead.source)}</span>
        <span>{relativeAge(lead.createdAt, generatedAt)}</span>
      </div>
      <a
        aria-label="Open CRM record"
        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg border border-sky-400/25 bg-sky-400/[0.07] text-sm font-semibold text-sky-300 transition hover:border-sky-400/50 hover:bg-sky-400/10"
        href={lead.recordHref}
      >
        Open CRM record
      </a>
    </article>
  );
}

function globalLeadFilter(row: Row<AdminEnquiryRow>, _columnId: string, value: unknown) {
  const query = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!query) return true;
  const lead = row.original;
  return [
    lead.name,
    lead.email,
    lead.org,
    lead.message,
    lead.owner,
    lead.source,
    lead.segment,
    lead.routedTo,
    lead.status,
    lead.priority,
    lead.nextActionNote,
    lead.archiveReason,
  ].some((candidate) => candidate?.toLowerCase().includes(query));
}

function exactFilter(row: Row<AdminEnquiryRow>, columnId: string, value: unknown) {
  if (typeof value !== "string") return true;
  const rowValue = String(row.getValue(columnId) ?? "");
  if (value === "unassigned") return rowValue === "";
  return rowValue === value;
}

function statusFilter(row: Row<AdminEnquiryRow>, columnId: string, value: unknown) {
  const status = String(row.getValue(columnId));
  if (value === "all" || typeof value !== "string") return true;
  if (value === "active") return status !== "archived";
  return status === value;
}

function statusTone(status: AdminLeadStatus): "neutral" | "blue" | "green" | "amber" {
  if (status === "qualified") return "green";
  if (status === "archived") return "neutral";
  if (status === "reviewing") return "blue";
  return "amber";
}

function priorityTone(priority: AdminLeadPriority): "neutral" | "blue" | "red" | "amber" {
  if (priority === "urgent") return "red";
  if (priority === "high") return "amber";
  if (priority === "low") return "neutral";
  return "blue";
}

function slaTone(state: ReturnType<typeof adminLeadSlaState>["state"]): "neutral" | "green" | "red" | "amber" {
  if (state === "overdue") return "red";
  if (state === "due-soon" || state === "unscheduled") return "amber";
  if (state === "scheduled") return "green";
  return "neutral";
}

function deliveryState(lead: AdminEnquiryRow): {
  label: string;
  tone: "neutral" | "green" | "red" | "amber";
} {
  if (lead.notificationDelivered === false) return { label: "Failed", tone: "red" };
  const successes = [lead.notificationEmailOk, lead.notificationSlackOk, lead.notificationClickUpOk].filter(
    Boolean,
  ).length;
  if (successes > 0) return { label: successes > 1 ? `Sent +${successes - 1}` : "Sent", tone: "green" };
  if (lead.source === "hero-email") return { label: "Captured", tone: "green" };
  return { label: "Pending", tone: "amber" };
}

function sourceLabel(source: AdminEnquiryRow["source"]) {
  if (source === "voice") return "Reka voice";
  if (source === "hero-email") return "Email interest";
  return "Website form";
}

function columnLabel(columnId: string) {
  return (
    {
      contact: "Contact",
      request: "Request",
      owner: "Owner",
      status: "Status",
      priority: "Priority",
      sla: "Next action",
      source: "Source and route",
      delivery: "Delivery",
      createdAt: "Received",
    }[columnId] ?? columnId
  );
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function relativeAge(value: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - value) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
