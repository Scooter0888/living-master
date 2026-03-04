"use client";
import { forwardRef, InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, icon, ...props }, ref) => {
  return (
    <div className="relative flex items-center">
      {icon && (
        <span className="absolute left-3 text-[var(--text-muted)] pointer-events-none">{icon}</span>
      )}
      <input
        ref={ref}
        className={cn(
          "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30",
          icon ? "pl-9 pr-4 py-2.5" : "px-4 py-2.5",
          className
        )}
        {...props}
      />
    </div>
  );
});

Input.displayName = "Input";
export { Input };
