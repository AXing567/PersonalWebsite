import type { HTMLAttributes, ReactNode } from "react";

type GlassCardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: "article" | "section" | "div";
  tone?: "default" | "quiet" | "strong";
};

export default function GlassCard({ as = "article", tone = "default", className = "", children, ...props }: GlassCardProps) {
  const Component = as;

  return (
    <Component className={`glass-card glass-card-${tone} ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}
