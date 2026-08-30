import type { Conversation } from "../db";
import { useChatStore } from "../stores/chat";

type ConversationBadgeProps = {
  conv: Conversation;
};

export function ConversationBadge({ conv }: ConversationBadgeProps) {
  const agentColor = useChatStore((s) => s.agentColor);
  const agentDisplay = useChatStore((s) => s.agentDisplay);

  const isGroup = conv.kind === "group";
  const agent = conv.agentIds?.length ? conv.agentIds[0] : null;
  const ids = conv.agentIds || [];
  const shown = ids.slice(0, 3);
  const overlap = ids.length > 3 ? ids.length - 3 : 0;

  return (
    <span className="w-8 shrink-0 flex items-center">
      {isGroup ? (
        <span className="flex">
          {shown.map((name, i) => (
            <span
              key={name}
              className="w-4 h-4 rounded-full border-2 border-slate-950 flex items-center justify-center"
              style={{ backgroundColor: agentColor(name), marginLeft: i ? -8 : 0 }}
              title={agentDisplay(name) ?? undefined}
            />
          ))}
          {overlap > 0 && (
            <span
              className="w-4 h-4 rounded-full border-2 border-slate-950 bg-slate-700 text-[8px] text-slate-300 flex items-center justify-center"
              style={{ marginLeft: -8 }}
            >
              +{overlap}
            </span>
          )}
        </span>
      ) : agent ? (
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: agentColor(agent) }} title={agentDisplay(agent) ?? undefined} />
      ) : null}
    </span>
  );
}
