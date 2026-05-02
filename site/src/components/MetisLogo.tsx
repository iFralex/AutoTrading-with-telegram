const sizes = {
  sm: { img: "w-7 h-7", text: "text-sm" },
  md: { img: "w-8 h-8", text: "text-lg" },
  lg: { img: "w-9 h-9", text: "text-xl" },
}

export function MetisLogo({
  size = "md",
  hideText = false,
  className = "",
}: {
  size?: keyof typeof sizes
  hideText?: boolean
  className?: string
}) {
  const s = sizes[size]
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <img src="/logo.svg" alt="METIS" className={`${s.img} shrink-0`} />
      {!hideText && (
        <span
          className={`font-bold text-white ${s.text}`}
          style={{ fontFamily: "Inter, sans-serif", letterSpacing: "0.15em" }}
        >
          METIS
        </span>
      )}
    </span>
  )
}
