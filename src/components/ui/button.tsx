import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost";

interface SharedProps {
  variant?: Variant;
  /** Hex color (typically `lineColor(card.viaLine)`) used for the primary fill/border. */
  tint?: string;
  className?: string;
  children: ReactNode;
}

type ButtonAsLink = SharedProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & {
    href: string;
  };

type ButtonAsButton = SharedProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
  };

export type ButtonProps = ButtonAsLink | ButtonAsButton;

const BASE_CLASSES =
  "chrome inline-flex w-full items-center justify-center gap-2 px-5 py-3.5 text-[13px] font-medium tracking-[0.04em] transition duration-150 ease-out hover:scale-[1.02] active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40";

/**
 * The one button DERIVE needs: a full-width tinted primary ("I went →") and
 * a bare ghost variant for secondary actions. Renders as an <a> when `href`
 * is given, a <button> otherwise.
 */
export function Button(props: ButtonProps) {
  const { variant = "primary", tint, className, children, href, ...rest } = props;

  const variantClasses =
    variant === "primary"
      ? "border text-ground hover:brightness-110"
      : "border border-ground-line bg-transparent text-platform hover:border-platform-dim";

  const style =
    variant === "primary"
      ? { backgroundColor: tint ?? "var(--platform)", borderColor: tint ?? "var(--platform)" }
      : undefined;

  const classes = [BASE_CLASSES, variantClasses, className].filter(Boolean).join(" ");

  if (href) {
    return (
      <a
        href={href}
        className={classes}
        style={style}
        {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      className={classes}
      style={style}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}
