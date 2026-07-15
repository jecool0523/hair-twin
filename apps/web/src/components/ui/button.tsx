import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring",
  secondary:
    "bg-muted text-foreground hover:bg-muted/70 focus-visible:ring-ring",
  outline:
    "border border-input bg-transparent hover:bg-muted focus-visible:ring-ring",
  ghost: "bg-transparent hover:bg-muted focus-visible:ring-ring",
  danger:
    "bg-[hsl(var(--danger))] text-white hover:opacity-90 focus-visible:ring-[hsl(var(--danger))]",
  success:
    "bg-[hsl(var(--success))] text-white hover:opacity-90 focus-visible:ring-[hsl(var(--success))]",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-14 px-8 text-base",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
