interface Props {
  name: string;
  thumbnail: string | null;
  sizeClass?: string;
  textClass?: string;
  roundedClass?: string;
}

function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "?";
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function PersonAvatar({
  name,
  thumbnail,
  sizeClass = "h-11 w-11",
  textClass = "text-xs",
  roundedClass = "rounded-xl",
}: Props) {
  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt={name}
        className={`${sizeClass} ${roundedClass} shrink-0 border border-white/80 object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} flex shrink-0 items-center justify-center bg-[var(--cream)] font-semibold text-[var(--brown-light)] ${textClass}`}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </div>
  );
}
