import type { AgentRole } from "../db";

type AgentAvatarProps = {
  name?: string;
  display?: string;
  color?: string;
  size?: number;
  role?: AgentRole;
};

// Role badge colors (CEO mode org chart) — the dotted status ring on the
// avatar tells you the agent's job at a glance.
const ROLE_BADGE_COLORS: Record<AgentRole, string> = {
  ceo: "#fbbf24", // amber — executive
  coder: "#38bdf8", // sky — ships code
  qa: "#fb7185", // rose — verifies
  research: "#a78bfa", // violet — digs
  ops: "#34d399", // emerald — runs things
};

function initialsFor(label: string): string {
  const words = label.replace(/[-_]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (label.slice(0, 1) || "?").toUpperCase();
}

export function AgentAvatar({ name = "", display = "", color = "", size = 10, role }: AgentAvatarProps) {
  const label = display || name;
  const initials = initialsFor(label);

  return (
    <span
      className="relative rounded-full flex items-center justify-center shrink-0 font-semibold select-none"
      style={{
        backgroundColor: color || "#64748b",
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.max(8, size * 0.4)}px`,
      }}
      title={display || name}
    >
      <span className="text-white leading-none">{initials}</span>
      {role && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-950"
          style={{ backgroundColor: ROLE_BADGE_COLORS[role] }}
          aria-label={`Role: ${role}`}
          title={`${display || name} — ${role}`}
        />
      )}
    </span>
  );
}