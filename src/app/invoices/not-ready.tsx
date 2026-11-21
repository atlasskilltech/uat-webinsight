import Link from "next/link";
import { Cog } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

/** Shown by finance pages when there is no active organization yet. */
export function NotReady({ canSetup, title }: { canSetup?: boolean; title: string }) {
  return (
    <div>
      <PageHeader title={title} description="Invoice Agent — accounts payable & receivable." />
      <EmptyState
        icon={Cog}
        title="Invoice Agent is not set up yet"
        description="Create your finance organization to begin. Until then there is nothing to show here."
        action={
          canSetup ? (
            <Link href="/invoices/settings">
              <Button>Go to Invoice Settings</Button>
            </Link>
          ) : (
            <span className="text-sm text-muted">Ask a Finance Admin to complete setup.</span>
          )
        }
      />
    </div>
  );
}
