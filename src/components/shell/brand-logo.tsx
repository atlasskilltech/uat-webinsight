"use client";

import Image from "next/image";
import Link from "next/link";

/**
 * Atlas Web Insight sidebar branding.
 *
 * The sidebar background is deep navy in BOTH light and dark themes, so the
 * white/transparent logo variant is the correct choice for maximum contrast in
 * either theme (the green-on-brand variant is reserved for light surfaces like
 * the login card). This keeps the mark sharp and readable and never lets it
 * blend into the navy.
 *  - Expanded sidebar (and full-width mobile drawer): wide white lockup.
 *  - Collapsed sidebar: white square mark.
 */
export function BrandLogo({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <Link href="/" aria-label="Atlas Web Insight — home" className="flex items-center justify-center">
        <Image
          src="/brand/atlas-logo-mark-dark.png"
          alt="Atlas Web Insight"
          width={4268}
          height={4268}
          priority
          className="h-10 w-10 object-contain"
        />
      </Link>
    );
  }

  return (
    <Link href="/" aria-label="Atlas Web Insight — home" className="flex items-center">
      <Image
        src="/brand/atlas-logo-desktop-dark.png"
        alt="Atlas Web Insight"
        width={1893}
        height={608}
        priority
        className="h-10 w-auto max-w-[180px] object-contain"
      />
    </Link>
  );
}
