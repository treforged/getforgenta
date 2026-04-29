interface ForgentaLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showWordmark?: boolean;
}

const sizes = {
  sm: { height: 32 },
  md: { height: 48 },
  lg: { height: 120 },
};

export default function ForgentaLogo({ size = 'md', className = '', showWordmark = true }: ForgentaLogoProps) {
  const s = sizes[size];
  const src = showWordmark ? '/logo-text.png' : '/logo.png';
  return (
    <span className={`inline-flex items-center ${className}`}>
      <img
        src={src}
        alt="Forgenta"
        style={{ height: s.height, width: 'auto', display: 'block' }}
        draggable={false}
      />
    </span>
  );
}
