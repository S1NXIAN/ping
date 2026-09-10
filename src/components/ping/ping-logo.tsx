// PING logo mark — sharp white tile with a charcoal pulse waveform and a
// charcoal live dot (mirrors public/logo.svg). White-accent theme.
export function PingLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="0" fill="#ffffff" />
      <path
        d="M10 32 h11 l4 -15 l7 27 l5 -19 l4 7 h13"
        fill="none"
        stroke="#0b0c0e"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="52" cy="32" r="3.4" fill="#0b0c0e" />
    </svg>
  );
}

export function PingWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-tight text-foreground ${className}`}>
      PING
      <span className="text-teal font-semibold">.</span>
    </span>
  );
}
