import Link from "next/link";

export default function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand-mark" aria-label="CharacterBazaarStudio home">
      <span className="brand-symbol" aria-hidden="true">
        <span className="brand-symbol-dot brand-symbol-dot-a" />
        <span className="brand-symbol-dot brand-symbol-dot-b" />
        <span className="brand-symbol-dot brand-symbol-dot-c" />
        <span className="brand-symbol-play">▶</span>
      </span>
      {!compact && (
        <span className="brand-name">
          CharacterBazaar<span>Studio</span>
        </span>
      )}
    </Link>
  );
}
