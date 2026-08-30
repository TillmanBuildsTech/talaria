type AgentAvatarProps = {
  name?: string;
  display?: string;
  color?: string;
  size?: number;
};

function initialsFor(label: string): string {
  const words = label.replace(/[-_]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (label.slice(0, 1) || "?").toUpperCase();
}

export function AgentAvatar({ name = "", display = "", color = "", size = 10 }: AgentAvatarProps) {
  const label = display || name;
  const initials = initialsFor(label);

  return (
    <span
      className="rounded-full flex items-center justify-center shrink-0 font-semibold select-none"
      style={{
        backgroundColor: color || "#64748b",
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.max(8, size * 0.4)}px`,
      }}
      title={display || name}
    >
      <span className="text-white leading-none">{initials}</span>
    </span>
  );
}
