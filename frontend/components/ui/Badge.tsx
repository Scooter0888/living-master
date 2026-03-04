import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "processing";
  className?: string;
}

const variantStyles = {
  default: "bg-[var(--surface-3)] text-[var(--text-secondary)] border-[var(--border)]",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  error: "bg-red-500/10 text-red-400 border-red-500/20",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
