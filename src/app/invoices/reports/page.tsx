import type { Metadata } from "next";
import { getInvoiceContext } from "@/lib/invoice/org";
import { getReport, REPORT_TYPES, type ReportType } from "@/lib/invoice/services/reports";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Options } from "@/components/ui/form";
import { PAYMENT_STATUS_OPTIONS } from "@/lib/invoice/enums";
import { NotReady } from "../not-ready";
import { ExportCsvButton } from "./reports-client";

export const metadata: Metadata = { title: "Financial Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; from?: string; to?: string; status?: string }>;
}) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Financial Reports" canSetup={ctx?.canSetup} />;

  const sp = await searchParams;
  const type = (REPORT_TYPES.some((t) => t.value === sp.type) ? sp.type : "payables") as ReportType;
  const report = await getReport(ctx.organizationId, type, { from: sp.from, to: sp.to, status: sp.status });

  const showStatus = type === "payables" || type === "receivables";
  const showDates = type !== "overdue";
  const filename = `atlas-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  const csvRows = report.totalsRow ? [...report.rows, report.totalsRow] : report.rows;

  return (
    <div>
      <PageHeader
        title="Financial Reports"
        description="Payables, receivables, overdue, GST and monthly summaries. Totals match the underlying records; export to CSV or print."
        actions={<ExportCsvButton headers={report.headers} rows={csvRows} filename={filename} />}
      />

      <Card className="mb-6">
        <CardContent>
          <form method="get" action="/invoices/reports" className="flex flex-wrap items-end gap-3">
            <Field label="Report" htmlFor="type" className="w-48">
              <Select id="type" name="type" defaultValue={type}>
                <Options options={REPORT_TYPES} />
              </Select>
            </Field>
            {showDates && (
              <>
                <Field label="From" htmlFor="from">
                  <Input id="from" name="from" type="date" defaultValue={sp.from} />
                </Field>
                <Field label="To" htmlFor="to">
                  <Input id="to" name="to" type="date" defaultValue={sp.to} />
                </Field>
              </>
            )}
            {showStatus && (
              <Field label="Payment status" htmlFor="status" className="w-44">
                <Select id="status" name="status" defaultValue={sp.status ?? ""}>
                  <option value="">All</option>
                  <Options options={PAYMENT_STATUS_OPTIONS} />
                </Select>
              </Field>
            )}
            <Button type="submit">Run report</Button>
          </form>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-foreground">{report.title}</h2>

      {report.rows.length === 0 ? (
        <EmptyState title="No data for this report" description="Adjust the filters or add invoices first." />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                {report.headers.map((h) => (
                  <TH key={h} className={/total|balance|paid|taxable|cgst|sgst|igst|grand|days|invoices|payable|receivable|received/i.test(h) ? "text-right" : ""}>
                    {h}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {report.rows.map((row, i) => (
                <TR key={i}>
                  {row.map((cell, j) => (
                    <TD key={j} className={typeof cell === "number" || /^-?\d/.test(String(cell)) ? "text-right tabular-nums" : ""}>
                      {String(cell)}
                    </TD>
                  ))}
                </TR>
              ))}
              {report.totalsRow && (
                <TR className="font-semibold">
                  {report.totalsRow.map((cell, j) => (
                    <TD key={j} className="text-right tabular-nums">{String(cell)}</TD>
                  ))}
                </TR>
              )}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
