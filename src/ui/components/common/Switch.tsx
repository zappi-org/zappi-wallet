import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/ui/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** Names the control for AT — a bare role="switch" has no accessible name. */
  label?: string;
}

export function Switch({ checked, onChange, disabled, className, label }: SwitchProps) {
  const reduceMotion = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
        checked ? "bg-brand" : "bg-foreground/[0.12]",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <motion.span
        layout
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transform",
          "ring-0 transition-shadow",
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        )}
        style={{ marginTop: "2px" }}
      />
    </button>
  );
}
