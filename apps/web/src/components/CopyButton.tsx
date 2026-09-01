import { useState } from "react";

export function CopyButton({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="copy-action">
      <button
        type="button"
        onClick={() => {
          void onClick();
        }}
        aria-label={`Copy ${label}`}
      >
        Copy {label}
      </button>
      {copied ? <span role="status">Copied</span> : null}
    </span>
  );
}
