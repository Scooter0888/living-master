"use client";
import { forwardRef, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "destructive" | "accent";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", loading, children, disabled, ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40 disabled:pointer-events-none select-none";

    const variants = {
      default:
        "bg-[var(--surface-3)] hover:bg-[var(--border-hover)] text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--border-hover)]",
      accent:
        "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-lg shadow-[var(--accent)]/20",
      ghost: "hover:bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
      outline:
        "border border-[var(--border)] hover:border-[var(--border-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
      destructive:
        "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40",
    };

    const sizes = {
      sm: "px-3 py-1.5 text-xs",
      md: "px-4 py-2 text-sm",
      lg: "px-6 py-3 text-sm",
      icon: "p-2",
    };

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
export { Button };
