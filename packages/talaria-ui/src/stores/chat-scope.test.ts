import { beforeEach, describe, expect, it } from "vitest";
import db, { type Conversation } from "../db";
import { useChatStore } from "./chat";
import { useProjectsStore } from "./projects";

// The chat store's init() talks to the network/gateway — don't call it. We
// exercise the scoping boundary directly: new conversations auto-tag the active
// scope, and loadConversations/sidebar filter to the active scope only.
beforeEach(() => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, loaded: false });
  useChatStore.setState({
    messages: [],
    conversations: [],
    activeConversationId: null,
    activeStreams: 0,
    connectionStatus: "connected",
    error: null,
  });
});

async function seedConversation(projectId: string | null | undefined): Promise<Conversation> {
  const id = await db.conversations.add({
    title: "Chat",
    lastMessage: "hi",
    updatedAt: Date.now(),
    kind: "default",
    agentIds: [],
    messageCount: 1,
    projectId,
  });
  const row = await db.conversations.get(id);
  if (!row) throw new Error("seed failed");
  return row;
}

describe("chat project scoping (P9)", () => {
  it("new DM conversations are auto-tagged with the active project", async () => {
    const proj = await useProjectsStore.getState().createProject({ name: "serv" });
    await useProjectsStore.getState().setActiveProject(proj.id);
    const id = await useChatStore.getState().newDirectMessage("developer");
    const conv = await db.conversations.get(id as number);
    expect(conv?.projectId).toBe(proj.id);
  });

  it("conversations in the active project appear in the sidebar; others are hidden", async () => {
    const proj = await useProjectsStore.getState().createProject({ name: "serv" });
    await useProjectsStore.getState().setActiveProject(proj.id);
    const inScope = await seedConversation(proj.id);
    const otherProj = await useProjectsStore.getState().createProject({ name: "abc" });
    await seedConversation(otherProj.id);
    await seedConversation(null); // global

    await useChatStore.getState().loadConversations();
    const s = useChatStore.getState();
    const sidebarIds = s.sidebarConversations().map((c) => c.id);
    expect(sidebarIds).toContain(inScope.id);
    // Only the active project's chat leaks into the current namespace.
    expect(sidebarIds).toHaveLength(1);
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual([inScope.id]);
  });

  it("global scope shows only unassigned conversations", async () => {
    const proj = await useProjectsStore.getState().createProject({ name: "serv" });
    await useProjectsStore.getState().setActiveProject(proj.id);
    await seedConversation(proj.id);
    await useProjectsStore.getState().setActiveProject(null);
    const global = await seedConversation(null);
    await useChatStore.getState().loadConversations();
    const s = useChatStore.getState();
    expect(s.sidebarConversations().map((c) => c.id)).toEqual([global.id]);
  });

  it("switching projects does not leak the previous scope's selection", async () => {
    const projA = await useProjectsStore.getState().createProject({ name: "a" });
    const projB = await useProjectsStore.getState().createProject({ name: "b" });
    await useProjectsStore.getState().setActiveProject(projA.id);
    const a = await seedConversation(projA.id);
    await useChatStore.getState().loadConversations();
    await useChatStore.getState().switchConversation(a.id as number);

    await useProjectsStore.getState().setActiveProject(projB.id);
    await useChatStore.getState().reloadForScope();
    expect(useChatStore.getState().activeConversationId).toBeNull();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });
});
