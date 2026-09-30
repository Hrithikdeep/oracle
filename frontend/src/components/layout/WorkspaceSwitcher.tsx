"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Hardcoded single workspace for now — real workspace data comes later.
export function WorkspaceSwitcher() {
  return (
    <Select defaultValue="acme-capital">
      <SelectTrigger className="w-[220px] border-none bg-transparent">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="acme-capital">Acme Capital — Investment Intelligence</SelectItem>
      </SelectContent>
    </Select>
  );
}
