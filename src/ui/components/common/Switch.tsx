import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
        checked ? "bg-[#3b7df5]" : "bg-primary/20",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
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
