"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deleteAudit, createIssueFromFinding } from "../actions";

export function DeleteAuditButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this audit and its findings?")) return;
        start(async () => {
          await deleteAudit(id);
          toast("Audit deleted.");
          router.push("/inspector");
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" /> Delete
    </Button>
  );
}

export function PromoteFindingButton({ findingId }: { findingId: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createIssueFromFinding(findingId);
          toast(res.message ?? "", res.status === "success" ? "success" : "error");
          router.refresh();
        })
      }
    >
      <FilePlus2 className="h-3.5 w-3.5" /> Add to issue register
    </Button>
  );
}
