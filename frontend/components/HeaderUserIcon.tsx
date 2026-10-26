import Link from "next/link";

/** Shared top-right user icon for every app header (dashboard, editor, admin). */
export default function HeaderUserIcon() {
  return (
    <Link href="/admin" className="cb-header-user-icon" aria-label="Account / Admin" title="Account / Admin">
      <svg viewBox="0 0 141 141" aria-hidden="true">
        <rect width="141" height="141" rx="16" fill="#000" />
        <path d="M30 119V96a32 32 0 0 1 32-32h17a32 32 0 0 1 32 32v23Z" fill="#616161" />
        <circle cx="70.5" cy="39" r="29" fill="#616161" stroke="#000" strokeWidth="4" />
      </svg>
    </Link>
  );
}
