"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv, downloadCsv } from "@/lib/csv-export";

export function ExportCsvButton({
  headers,
  rows,
  filename,
}: {
  headers: string[];
  rows: (string | number)[][];
  filename: string;
}) {
  return (
    <Button
      variant="secondary"
      onClick={() => downloadCsv(filename, toCsv(headers, rows))}
      disabled={rows.length === 0}
    >
      <Download className="h-4 w-4" /> Export CSV
    </Button>
  );
}
