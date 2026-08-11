import type { HTMLAttributes, ReactNode } from "react";

interface BracketFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  children: ReactNode;
  className?: string;
  /** Hex color for the corner marks; defaults to the faint platform tone. */
  tint?: string;
}

const CORNER = "pointer-events-none absolute h-3 w-3 border-platform-faint";

/**
 * Viewfinder-corner decoration — four L-shaped marks floating just outside a
 * panel's edges, borrowed from agnost.ai's demo-frame treatment. Purely
 * decorative chrome; the panel's real border (if any) is set by the caller.
 * Extra div attributes (onClick, etc.) pass through to the wrapping element.
 */
export function BracketFrame({ children, className, tint, ...rest }: BracketFrameProps) {
  const style = tint ? { borderColor: tint } : undefined;
  return (
    <div className={`relative ${className ?? ""}`} {...rest}>
      <span aria-hidden="true" className={`${CORNER} -left-1.5 -top-1.5 border-l border-t`} style={style} />
      <span aria-hidden="true" className={`${CORNER} -right-1.5 -top-1.5 border-r border-t`} style={style} />
      <span aria-hidden="true" className={`${CORNER} -left-1.5 -bottom-1.5 border-b border-l`} style={style} />
      <span aria-hidden="true" className={`${CORNER} -right-1.5 -bottom-1.5 border-b border-r`} style={style} />
      {children}
    </div>
  );
}
