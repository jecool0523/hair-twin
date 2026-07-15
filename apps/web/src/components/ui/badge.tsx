import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]",
  warning: "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]",
  danger: "bg-[hsl(var(--danger))]/15 text-[hsl(var(--danger))]",
  info: "bg-primary/15 text-primary",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
