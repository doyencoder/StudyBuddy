import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  ClipboardList,
  Target,
  Settings,
  Plus,
  Clock,
  ImageIcon,
  PanelLeft,
  Star,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { API_BASE } from "@/config/api";

const USER_ID = "student-001";

const menuItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Chat", url: "/chat", icon: MessageSquare },
  { title: "Images", url: "/images", icon: ImageIcon },
  { title: "My Quizzes", url: "/quizzes", icon: ClipboardList },
  { title: "Goals", url: "/goals", icon: Target },
  { title: "Settings", url: "/settings", icon: Settings },
];

interface Conversation {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at?: string;
  starred: boolean;
}

const AppSidebar = () => {
  const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

  // Close the sidebar sheet on mobile after any navigation action
  const closeOnMobile = () => { if (isMobile) setOpenMobile(false); };

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isAnyTyping, setIsAnyTyping] = useState(false);

  // Per-row hover + dropdown-open tracking
  const [hoveredId, setHoveredId]     = useState<string | null>(null);
  const [openMenuId, setOpenMenuId]   = useState<string | null>(null);

  // Rename state
  const [renamingId, setRenamingId]   = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Keep in sync with ChatPage's streaming state
  useEffect(() => {
    const handler = (e: Event) => {
      setIsAnyTyping((e as CustomEvent<{ isAnyTyping: boolean }>).detail.isAnyTyping);
    };
    window.addEventListener("typing-state-changed", handler);
    return () => window.removeEventListener("typing-state-changed", handler);
  }, []);

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${API_BASE}/chat/conversations?user_id=${USER_ID}`);
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch { /* Silently fail — sidebar is non-critical */ }
  };

  // Fetch once on first mount
  useEffect(() => { fetchConversations(); }, []);

  // Refresh sidebar whenever the user navigates to any page.
  // This ensures chats that appeared in other tabs / sessions show up
  // without a full page reload. fetchConversations is a lightweight GET
  // so there is no meaningful latency impact.
  useEffect(() => {
    fetchConversations();
  }, [location.pathname]);

  // Also refresh when the browser tab becomes visible again (user switches
  // back from another tab) — catches changes made in other tabs.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchConversations();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Listen for new conversation events from ChatPage.
  // Fetch immediately (the conversation already exists when meta fires) then
  // retry after 1500ms to pick up the final AI-generated title once it is saved.
  // ✦ OUR FIX: immediate + retry — NOT a single 800ms delayed shot.
  useEffect(() => {
    const handler = () => {
      fetchConversations();
      setTimeout(() => fetchConversations(), 1500);
    };
    window.addEventListener("conversation-created", handler);
    return () => window.removeEventListener("conversation-created", handler);
  }, []);

  // Refresh when an existing conversation is updated (new prompt in old chat).
  // Immediate + short retry keeps ordering stable even if DB write and fetch race.
  useEffect(() => {
    const handler = () => {
      fetchConversations();
      setTimeout(() => fetchConversations(), 300);
    };
    window.addEventListener("conversation-updated", handler);
    return () => window.removeEventListener("conversation-updated", handler);
  }, []);

  // If any stream just finished, pull fresh ordering so active old chats rise to top
  // without requiring manual reload.
  useEffect(() => {
    if (!isAnyTyping) fetchConversations();
  }, [isAnyTyping]);

  // Auto-focus and select rename input whenever it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const params = new URLSearchParams(location.search);
  const activeConversationId = params.get("conversationId");

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleStarToggle = async (conv: Conversation) => {
    const newStarred = !conv.starred;
    // Optimistic update
    setConversations(prev =>
      prev.map(c => c.conversation_id === conv.conversation_id ? { ...c, starred: newStarred } : c)
    );
    try {
      await fetch(`${API_BASE}/chat/conversations/${conv.conversation_id}/star`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, starred: newStarred }),
      });
    } catch {
      // Roll back on failure
      setConversations(prev =>
        prev.map(c => c.conversation_id === conv.conversation_id ? { ...c, starred: conv.starred } : c)
      );
    }
  };

  const startRename = (conv: Conversation) => {
    setRenamingId(conv.conversation_id);
    setRenameValue(conv.title);
  };

  const cancelRename = () => { setRenamingId(null); setRenameValue(""); };

  const commitRename = async (conversationId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { cancelRename(); return; }
    const original = conversations.find(c => c.conversation_id === conversationId)?.title ?? "";

    // Optimistic update — name changes instantly in the sidebar
    setConversations(prev =>
      prev.map(c => c.conversation_id === conversationId ? { ...c, title: trimmed } : c)
    );
    cancelRename();

    try {
      const res = await fetch(`${API_BASE}/chat/conversations/${conversationId}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, title: trimmed }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // PATCH failed — roll back to original name
      setConversations(prev =>
        prev.map(c => c.conversation_id === conversationId ? { ...c, title: original } : c)
      );
    }
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    setDeleteTargetId(null);
    // Optimistic removal from list
    setConversations(prev => prev.filter(c => c.conversation_id !== id));
    // If the deleted conv is currently open, go to new chat
    if (activeConversationId === id) navigate("/chat");
    try {
      await fetch(`${API_BASE}/chat/conversations/${id}?user_id=${USER_ID}`, { method: "DELETE" });
    } catch { /* Silently fail */ }
  };

  // Starred conversations float to the top
  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    const aTs = a.updated_at || a.created_at || "";
    const bTs = b.updated_at || b.created_at || "";
    return bTs.localeCompare(aTs);
  });

  return (
    <>
      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the conversation and all its messages.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarContent className="pt-2 flex flex-col h-full overflow-hidden">

          {/* Sidebar toggle button */}
          <div className={`flex ${collapsed ? "justify-center" : "justify-end"} px-2 pb-1`}>
            <Button
              variant="ghost" size="icon" onClick={toggleSidebar}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
          </div>

          {/* Main nav items */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuItems.map((item) => {
                  const isActive =
                    location.pathname === item.url ||
                    (item.url === "/chat" && location.pathname === "/");
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url} end
                          onClick={closeOnMobile}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                            isActive
                              ? "bg-primary/15 text-primary glow-blue-sm"
                              : "text-sidebar-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                          activeClassName=""
                        >
                          <item.icon className="w-5 h-5 shrink-0" />
                          {!collapsed && <span className="text-sm font-medium">{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Recent Chats Section */}
          {!collapsed && (
            <SidebarGroup className="flex flex-col flex-1 overflow-hidden min-h-0">
              <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3 shrink-0">
                Your chats
              </SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="px-2 mb-2 shrink-0">
                  {/*
                    ✦ OUR FIX: dispatches "new-chat-clicked" so ChatPage clears its
                    pending state even when the URL is already "/chat" — navigate()
                    alone is a silent no-op in that case and the URL effect never
                    fires, leaving the user stuck in the in-progress stream.
                    Also: no disabled/isAnyTyping guard — the whole point of this
                    feature is to allow new chats during generation.
                  */}
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("new-chat-clicked"));
                      navigate("/chat"); // also syncs URL when coming from another page
                      closeOnMobile();
                    }}
                    title="New chat"
                    className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 h-8"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New chat
                  </Button>
                  <hr className="border-t border-sidebar-border mt-2" />
                </div>

                <SidebarMenu className="overflow-y-auto flex-1">
                  {sortedConversations.map((chat) => {
                    const isActive   = activeConversationId === chat.conversation_id;
                    const isRenaming = renamingId === chat.conversation_id;
                    // Show ··· if this row is hovered OR its dropdown is open
                    const showMenu   = hoveredId === chat.conversation_id || openMenuId === chat.conversation_id;
                    // Show star badge only when not already showing the menu
                    const showStar   = chat.starred && !showMenu;

                    return (
                      <SidebarMenuItem key={chat.conversation_id}>
                        {isRenaming ? (
                          // ── Inline rename input ────────────────────────────
                          <div className={`flex items-center px-2 py-1.5 rounded-lg ${
                            isActive ? "bg-primary/15" : "bg-secondary/60"
                          }`}>
                            <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground mr-1.5" />
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter")  commitRename(chat.conversation_id);
                                if (e.key === "Escape") cancelRename();
                              }}
                              onBlur={() => commitRename(chat.conversation_id)}
                              className="flex-1 min-w-0 text-xs bg-transparent outline-none border-none text-foreground"
                              maxLength={80}
                            />
                          </div>
                        ) : (
                          // ── Normal conversation row ────────────────────────
                          <div
                            className={`flex items-center px-2 py-1.5 rounded-lg transition-colors duration-150 w-full cursor-pointer ${
                              isActive
                                ? "bg-primary/15 text-primary"
                                : "text-sidebar-foreground hover:bg-secondary hover:text-foreground"
                            }`}
                            onMouseEnter={() => setHoveredId(chat.conversation_id)}
                            onMouseLeave={() => {
                              // Only clear hover if this row's dropdown isn't open
                              if (openMenuId !== chat.conversation_id) setHoveredId(null);
                            }}
                            onClick={() => {
                              navigate(`/chat?conversationId=${chat.conversation_id}`);
                              closeOnMobile();
                            }}
                          >
                            <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground mr-1.5" />

                            {/* Title — truncates to make room for right slot */}
                            <span className="text-xs truncate flex-1 min-w-0">
                              {chat.title}
                            </span>

                            {/* Right slot — exactly one of: nothing | star | ··· */}
                            <div className="shrink-0 ml-1 w-4 flex items-center justify-center">
                              {showStar && (
                                <Star className="w-3 h-3 text-yellow-400" fill="currentColor" />
                              )}
                              {showMenu && (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenu
                                    open={openMenuId === chat.conversation_id}
                                    onOpenChange={(open) => {
                                      setOpenMenuId(open ? chat.conversation_id : null);
                                      if (!open) setHoveredId(null);
                                    }}
                                  >
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        className="w-4 h-4 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/15 text-muted-foreground hover:text-foreground"
                                        title="More options"
                                      >
                                        <MoreHorizontal className="w-3.5 h-3.5" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent side="right" align="start" className="w-40">
                                      <DropdownMenuItem onClick={() => handleStarToggle(chat)}>
                                        <Star className="w-3.5 h-3.5 mr-2" />
                                        {chat.starred ? "Unstar" : "Star"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => startRename(chat)}>
                                        <Pencil className="w-3.5 h-3.5 mr-2" />
                                        Rename
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => setDeleteTargetId(chat.conversation_id)}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>
    </>
  );
};

export default AppSidebar;