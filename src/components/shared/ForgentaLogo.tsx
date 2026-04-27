interface ForgentaLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showWordmark?: boolean;
}

const sizes = {
  sm: { icon: 18, text: 'text-sm', gap: 'gap-1.5' },
  md: { icon: 26, text: 'text-xl', gap: 'gap-2' },
  lg: { icon: 36, text: 'text-4xl', gap: 'gap-3' },
};

export default function ForgentaLogo({ size = 'md', className = '', showWordmark = true }: ForgentaLogoProps) {
  const s = sizes[size];
  return (
    <span className={`inline-flex items-center ${s.gap} ${className}`}>
      <svg
        width={s.icon}
        height={Math.round(s.icon * 0.72)}
        viewBox="0 0 100 72"
        fill="currentColor"
        aria-hidden="true"
      >
        {/* Horn (beak pointing left) */}
        <path d="M2,32 L30,22 L30,36 Z" />
        {/* Top face */}
        <rect x="24" y="10" width="72" height="28" rx="4" />
        {/* Waist / neck */}
        <rect x="36" y="38" width="38" height="8" rx="2" />
        {/* Base */}
        <rect x="22" y="46" width="62" height="16" rx="4" />
      </svg>
      {showWordmark && (
        <span className={`font-display font-bold tracking-tight leading-none ${s.text}`}>
          FORGENTA
        </span>
      )}
    </span>
  );
}
