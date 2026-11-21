import { redirect } from "next/navigation";
import { requireInvoiceModuleAccess } from "@/lib/invoice/permissions";
import { isAuthError } from "@/lib/auth/guard";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

/**
 * Guards the whole Invoice Agent module. Root layout already validated the
 * session; here we enforce module access (finance membership, or app-admin
 * setup mode). The invoice DB may not be migrated yet — permission resolution
 * tolerates that so an admin can still reach Settings to initialize.
 */
export default async function InvoicesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireInvoiceModuleAccess();
  } catch (e) {
    if (isAuthError(e) && e.status === 401) redirect("/login");
    return (
      <div>
        <PageHeader
          title="Invoice Agent"
          description="AI-powered accounts payable & receivable for Atlas."
        />
        <EmptyState
          title="You don't have access to the Invoice Agent"
          description="Ask a Finance Admin to add you to an organization in Invoice Settings, then reload this page."
        />
      </div>
    );
  }
  return <>{children}</>;
}
