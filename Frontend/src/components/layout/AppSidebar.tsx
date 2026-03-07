import { useState, useEffect } from "react";
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

const USER_ID = "student-001";
const API_BASE = "http://localhost:8000";

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
}

const AppSidebar = () => {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<Conversation[]>([]);

  const fetchConversations = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/chat/conversations?user_id=${USER_ID}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      // Silently fail — sidebar is non-critical
    }
  };

  // Fetch once on first mount only
  useEffect(() => {
    fetchConversations();
  }, []);

  // Listen for new conversation — wait 800ms so backend has saved the first
  // message before we fetch, ensuring the title shows correctly
  useEffect(() => {
    const handler = () => {
      setTimeout(() => fetchConversations(), 800);
    };
    window.addEventListener("conversation-created", handler);
    return () => window.removeEventListener("conversation-created", handler);
  }, []);

  // Get the active conversation id from URL
  const params = new URLSearchParams(location.search);
  const activeConversationId = params.get("conversationId");

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="pt-2 flex flex-col h-full overflow-hidden">

        {/* Sidebar toggle button — lives inside the sidebar itself */}
        <div className={`flex ${collapsed ? "justify-center" : "justify-end"} px-2 pb-1`}>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeft className="w-4 h-4" />
          </Button>
        </div>
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
                        to={item.url}
                        end
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                          isActive
                            ? "bg-primary/15 text-primary glow-blue-sm"
                            : "text-sidebar-foreground hover:bg-secondary hover:text-foreground"
                        }`}
                        activeClassName=""
                      >
                        <item.icon className="w-5 h-5 shrink-0" />
                        {!collapsed && (
                          <span className="text-sm font-medium">
                            {item.title}
                          </span>
                        )}
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/chat")}
                  className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 h-8"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New chat
                </Button>
                <hr className="border-t border-sidebar-border mt-2" />
              </div>
              <SidebarMenu className="overflow-y-auto flex-1">
                {conversations.map((chat) => {
                  const isActive =
                    activeConversationId === chat.conversation_id;
                  return (
                    <SidebarMenuItem key={chat.conversation_id}>
                      <SidebarMenuButton asChild>
                        <button
                          onClick={() =>
                            navigate(
                              `/chat?conversationId=${chat.conversation_id}`
                            )
                          }
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 w-full text-left ${
                            isActive
                              ? "bg-primary/15 text-primary"
                              : "text-sidebar-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-xs truncate">{chat.title}</span>
                        </button>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
};

export default AppSidebar;