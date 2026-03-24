import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  ClipboardList,
  Layers,
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
  BarChart2,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { API_BASE } from "@/config/api";
import { cacheAPIResponse, getCachedAPI, addToSyncQueue, cacheConversation } from "@/lib/offlineStore";

const USER_ID = "student-001";

const menuItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Chat",      url: "/chat",      icon: MessageSquare },
  { title: "Images",    url: "/images",    icon: ImageIcon },
  { title: "My Quizzes",url: "/quizzes",   icon: ClipboardList },
  { title: "Flashcards",url: "/flashcards",icon: Layers },
  { title: "Goals",     url: "/goals",     icon: Target },
  { title: "Nova",      url: "/nova",     icon: BarChart2 },
  { title: "Settings",  url: "/settings",  icon: Settings },
];

interface Conversation {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at?: string;
  starred: boolean;
}

const AppSidebar = () => {
  const { state, toggleSidebar, isMobile, setOpenMobile, setOpen } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

  const closeOnMobile = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleNavClick = (url: string) => {
    closeOnMobile();
    if (isMobile) return;
    if (url === "/nova") {
      // Reset the sidebar only when arriving on Nova from another page.
      if (location.pathname !== "/nova") {
        setOpen(false);
      }
    }
  };

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isAnyTyping, setIsAnyTyping] = useState(false);

  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [renamingId, setRenamingId]   = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [openTooltipKey, setOpenTooltipKey] = useState<string | null>(null);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const optimisticTsSnapshotRef = useRef<Map<string, string | undefined>>(new Map());

  useEffect(() => {
    const handler = (e: Event) => {
      setIsAnyTyping((e as CustomEvent<{ isAnyTyping: boolean }>).detail.isAnyTyping);
    };
    window.addEventListener("typing-state-changed", handler);
    return () => window.removeEventListener("typing-state-changed", handler);
  }, []);

  useEffect(() => {
    if (!collapsed) {
      setOpenTooltipKey(null);
    }
  }, [collapsed]);

  const fetchConversations = async () => {
    const cacheKey = `conversations_${USER_ID}`;
    try {
      const res = await fetch(`${API_BASE}/chat/conversations?user_id=${USER_ID}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const incoming: Conversation[] = data.conversations || [];

      // Cache for offline use
      cacheAPIResponse(cacheKey, incoming).catch(() => {});

      // Preserve optimistic bump while a prompt is in-flight for an existing chat.
      setConversations((prev) => {
        const prevById = new Map(prev.map((c) => [c.conversation_id, c]));
        return incoming.map((conv) => {
          if (!optimisticTsSnapshotRef.current.has(conv.conversation_id)) return conv;
          const prevConv = prevById.get(conv.conversation_id);
          return prevConv?.updated_at ? { ...conv, updated_at: prevConv.updated_at } : conv;
        });
      });
    } catch {
      // Offline — try loading from cache
      try {
        const cached = await getCachedAPI<Conversation[]>(cacheKey);
        if (cached && conversations.length === 0) {
          setConversations(cached.data);
        }
      } catch { /* silently fail */ }
    }
  };

  useEffect(() => { fetchConversations(); }, []);
  useEffect(() => { fetchConversations(); }, [location.pathname]);

  // Proactively fetch & cache starred conversations for offline access
  const cachedStarredRef = useRef(new Set<string>());
  useEffect(() => {
    if (!navigator.onLine) return;
    const starred = conversations.filter(c => c.starred);
    for (const conv of starred) {
      if (cachedStarredRef.current.has(conv.conversation_id)) continue;
      cachedStarredRef.current.add(conv.conversation_id);
      // Fire-and-forget: fetch history and cache it
      fetch(`${API_BASE}/chat/history/${conv.conversation_id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.messages) {
            cacheConversation({
              conversation_id: conv.conversation_id,
              messages: data.messages,
              starred: true,
              cachedAt: new Date().toISOString(),
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }
  }, [conversations]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchConversations();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

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
    const handler = (event: Event) => {
      fetchConversations();
      setTimeout(() => fetchConversations(), 300);
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId) {
        optimisticTsSnapshotRef.current.delete(detail.conversationId);
      }
    };
    window.addEventListener("conversation-updated", handler as EventListener);
    return () => window.removeEventListener("conversation-updated", handler as EventListener);
  }, []);

  // Optimistically bump an existing conversation to top as soon as user sends a prompt.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      const conversationId = detail?.conversationId;
      if (!conversationId) return;

      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.conversation_id === conversationId);
        if (idx === -1) return prev;
        const target = prev[idx];
        if (!optimisticTsSnapshotRef.current.has(conversationId)) {
          optimisticTsSnapshotRef.current.set(conversationId, target.updated_at);
        }
        const bumped = {
          ...target,
          updated_at: new Date().toISOString(),
        };
        const next = [...prev];
        next[idx] = bumped;
        return next;
      });
    };

    window.addEventListener("conversation-optimistic-bump", handler as EventListener);
    return () => window.removeEventListener("conversation-optimistic-bump", handler as EventListener);
  }, []);

  // Roll back optimistic bump if the prompt fails before any assistant answer is produced.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      const conversationId = detail?.conversationId;
      if (!conversationId) return;
      const snapshot = optimisticTsSnapshotRef.current.get(conversationId);
      if (!optimisticTsSnapshotRef.current.has(conversationId)) return;

      setConversations((prev) =>
        prev.map((c) =>
          c.conversation_id === conversationId ? { ...c, updated_at: snapshot } : c
        )
      );
      optimisticTsSnapshotRef.current.delete(conversationId);
    };

    window.addEventListener("conversation-optimistic-rollback", handler as EventListener);
    return () => window.removeEventListener("conversation-optimistic-rollback", handler as EventListener);
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

  const handleStarToggle = async (conv: Conversation) => {
    const newStarred = !conv.starred;
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
      setConversations(prev =>
        prev.map(c => c.conversation_id === conv.conversation_id ? { ...c, starred: conv.starred } : c)
      );
    }
  };

  const startRename = (conv: Conversation) => {
    setRenamingId(conv.conversation_id);
    setRenameValue(conv.title);
  };

  const handleGenerateFlashcards = async (conv: Conversation) => {
    navigate("/flashcards", {
      state: {
        flashcardGeneration: {
          conversationId: conv.conversation_id,
          title: conv.title,
          requestId: Date.now(),
        },
      },
    });
    closeOnMobile();
  };

  const cancelRename = () => { setRenamingId(null); setRenameValue(""); };

  const commitRename = async (conversationId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { cancelRename(); return; }
    const original = conversations.find(c => c.conversation_id === conversationId)?.title ?? "";
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
      setConversations(prev =>
        prev.map(c => c.conversation_id === conversationId ? { ...c, title: original } : c)
      );
    }
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    setDeleteTargetId(null);
    setConversations(prev => prev.filter(c => c.conversation_id !== id));
    if (activeConversationId === id) navigate("/chat");
    if (!navigator.onLine) {
      addToSyncQueue({ type: "chat_delete", url: `${API_BASE}/chat/conversations/${id}?user_id=${USER_ID}`, method: "DELETE", body: "", createdAt: new Date().toISOString() }).catch(() => {});
      return;
    }
    try {
      await fetch(`${API_BASE}/chat/conversations/${id}?user_id=${USER_ID}`, { method: "DELETE" });
    } catch { /* Silently fail */ }
  };

  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    const aTs = a.updated_at || a.created_at || "";
    const bTs = b.updated_at || b.created_at || "";
    return bTs.localeCompare(aTs);
  });

  return (
    <>
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

          {/* Sidebar toggle */}
          <div className={`flex ${collapsed ? "justify-center" : "justify-end"} px-2 pb-1`}>
            <Button
              variant="ghost" size="icon" onClick={toggleSidebar}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
          </div>

          {/* Main nav items — with tooltips when collapsed */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <TooltipProvider delayDuration={0}>
                  {menuItems.map((item) => {
                    const isActive =
                      location.pathname === item.url ||
                      (item.url === "/chat" && location.pathname === "/");

                    const navNode = (
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          end
                          onClick={() => handleNavClick(item.url)}
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
                    );

                    if (!collapsed) {
                      return (
                        <SidebarMenuItem key={item.title}>
                          {navNode}
                        </SidebarMenuItem>
                      );
                    }

                    return (
                      <SidebarMenuItem key={item.title}>
                        <Tooltip
                          open={openTooltipKey === item.title}
                          onOpenChange={(open) => setOpenTooltipKey(open ? item.title : null)}
                        >
                          <TooltipTrigger asChild>
                            {navNode}
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8}>
                            {item.title}
                          </TooltipContent>
                        </Tooltip>
                      </SidebarMenuItem>
                    );
                  })}
                </TooltipProvider>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Recent chats — only shown when expanded */}
          {!collapsed && (
            <SidebarGroup className="flex flex-col flex-1 overflow-hidden min-h-0">
              <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3 shrink-0">
                Your chats
              </SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="px-2 mb-2 shrink-0">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("new-chat-clicked"));
                      navigate("/chat");
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
                    const showMenu   = hoveredId === chat.conversation_id || openMenuId === chat.conversation_id;
                    const showStar   = chat.starred && !showMenu;

                    return (
                      <SidebarMenuItem key={chat.conversation_id}>
                        {isRenaming ? (
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
                          <div
                            className={`flex items-center px-2 py-1.5 rounded-lg transition-colors duration-150 w-full cursor-pointer ${
                              isActive
                                ? "bg-primary/15 text-primary"
                                : "text-sidebar-foreground hover:bg-secondary hover:text-foreground"
                            }`}
                            onMouseEnter={() => setHoveredId(chat.conversation_id)}
                            onMouseLeave={() => {
                              if (openMenuId !== chat.conversation_id) setHoveredId(null);
                            }}
                            onClick={() => {
                              navigate(`/chat?conversationId=${chat.conversation_id}`);
                              closeOnMobile();
                            }}
                          >
                            <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground mr-1.5" />
                            <span className="text-xs truncate flex-1 min-w-0">{chat.title}</span>
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
                                    <DropdownMenuContent side="right" align="start" className="w-48">
                                      <DropdownMenuItem onClick={() => handleStarToggle(chat)}>
                                        <Star className="w-3.5 h-3.5 mr-2" />
                                        {chat.starred ? "Unstar" : "Star"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => startRename(chat)}>
                                        <Pencil className="w-3.5 h-3.5 mr-2" />
                                        Rename
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleGenerateFlashcards(chat)}>
                                        <Layers className="w-3.5 h-3.5 mr-2" />
                                        Generate Flashcards
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
