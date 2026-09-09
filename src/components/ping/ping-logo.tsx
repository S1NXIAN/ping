// PING logo mark — violet gradient tile with a white pulse waveform
// and a teal live dot (mirrors public/logo.svg).
export function PingLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ping-logo-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#ping-logo-g)" />
      <path
        d="M10 32 h11 l4 -15 l7 27 l5 -19 l4 7 h13"
        fill="none"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="52" cy="32" r="3.4" fill="#2dd4bf" />
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
