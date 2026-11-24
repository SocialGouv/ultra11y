import { forwardRef, memo } from "react";

// The design-system shape: an anonymous forwardRef, exported under an alias, so neither its
// function name nor its display name is the export's. Its stories render it.
const Inner = forwardRef<HTMLInputElement, { label: string }>((props, ref) => (
  <label>
    {props.label}
    <input ref={ref} />
  </label>
));
export { Inner as TextField };

// A memo with an explicit displayName that differs from the export, also storied.
export const Badge = memo(({ text }: { text: string }) => <span>{text}</span>);
Badge.displayName = "UiBadge";
