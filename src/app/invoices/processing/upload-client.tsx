"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UploadCloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { uploadDocumentAction } from "./actions";

export function UploadClient() {
  const [state, action] = useActionState(uploadDocumentAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Uploaded.", "success");
      formRef.current?.reset();
      router.refresh();
    } else if (state.status === "error" && state.message) {
      toast(state.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a document</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="space-y-4">
          <Field label="Direction" htmlFor="direction">
            <Select id="direction" name="direction" defaultValue="incoming">
              <option value="incoming">Incoming (supplier / payable)</option>
              <option value="outgoing">Outgoing (customer / receivable)</option>
            </Select>
          </Field>
          <Field label="File" htmlFor="file" hint="PDF, JPEG, PNG or WebP · max 20MB">
            <input
              id="file"
              name="file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              required
              className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent-foreground hover:file:bg-accent-hover"
            />
          </Field>
          <SubmitButton pendingLabel="Processing…">
            <UploadCloud className="h-4 w-4" /> Upload & process
          </SubmitButton>
        </form>

        {state.status === "success" && state.id && (
          <p className="mt-3 text-sm">
            <Link href={`/invoices/${state.id}`} className="text-accent hover:underline">
              Open the created invoice →
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
