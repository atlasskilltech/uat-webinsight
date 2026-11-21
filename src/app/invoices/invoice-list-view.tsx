import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { InvoiceTable } from "./invoice-table";
import { listInvoices } from "@/lib/invoice/services/invoices";

export async function InvoiceListView({
  organizationId,
  direction,
  title,
  description,
  q,
  view,
  basePath,
}: {
  organizationId: string;
  direction?: "incoming" | "outgoing";
  title: string;
  description: string;
  q?: string;
  view?: "needs-review";
  basePath: string;
}) {
  const rows = await listInvoices(organizationId, { direction, q, view });
  const newHref = direction ? `/invoices/new?dir=${direction}` : "/invoices/new";

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Link href={newHref}>
            <Button>
              <Plus className="h-4 w-4" /> New invoice
            </Button>
          </Link>
        }
      />

      <form method="get" action={basePath} className="mb-4 flex max-w-md items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search number, PO or party…"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      <InvoiceTable rows={rows} showDirection={!direction} />
    </div>
  );
}
