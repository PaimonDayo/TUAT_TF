import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-active active:opacity-[0.78] disabled:opacity-40 disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white",
        secondary: "bg-bg text-accent",
        ghost: "bg-transparent text-accent",
        danger: "bg-danger text-white",
        outline: "border border-separator bg-card text-ink",
      },
      size: {
        sm: "h-9 px-3 text-[13px] lg:h-8 lg:px-2.5 lg:text-[12px]",
        md: "h-11 px-4 text-[15px] lg:h-9 lg:px-3.5 lg:text-[14px]",
        lg: "h-12 px-5 text-[15px] w-full lg:h-10 lg:text-[14px]",
        icon: "h-10 w-10 lg:h-9 lg:w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
