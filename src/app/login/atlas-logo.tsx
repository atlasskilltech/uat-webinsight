import Image from "next/image";

/**
 * Atlas Web Insight brand lockup used on the login page: the isometric cube
 * mark (transparent PNG, trimmed from the official brand asset) paired with a
 * two-line "ATLAS / Web Insight" wordmark. The mark's faces are coloured so it
 * reads cleanly on both the dark showcase panel and the white login card; only
 * the wordmark colour switches per surface.
 *
 *  - `tone="light"`  → for light surfaces (navy wordmark)
 *  - `tone="dark"`   → for dark surfaces (white wordmark)
 */
export function AtlasLogo({
  tone = "light",
  size = "md",
  className = "",
}: {
  tone?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const mark = size === "lg" ? "h-12 w-12" : size === "sm" ? "h-9 w-9" : "h-11 w-11";
  const atlas = size === "lg" ? "text-[1.7rem]" : size === "sm" ? "text-lg" : "text-2xl";
  const sub = size === "lg" ? "text-base" : size === "sm" ? "text-[0.7rem]" : "text-sm";
  const atlasColor = tone === "dark" ? "text-white" : "text-slate-900";
  const subColor = tone === "dark" ? "text-slate-300" : "text-slate-600";

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image
        src="/brand/atlas-mark.png"
        alt="Atlas Web Insight"
        width={536}
        height={536}
        priority
        className={`${mark} shrink-0 object-contain`}
      />
      <span className="flex flex-col leading-[1.05]">
        <span className={`font-extrabold tracking-[0.06em] ${atlas} ${atlasColor}`}>ATLAS</span>
        <span className={`font-medium tracking-wide ${sub} ${subColor}`}>Web Insight</span>
      </span>
    </span>
  );
}
