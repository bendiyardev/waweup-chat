import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "flex h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-foreground shadow-none transition-colors duration-150 placeholder:text-muted-foreground hover:border-border-strong focus:border-border-strong focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
