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

const menuItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Chat", url: "/chat", icon: MessageSquare },
  { title: "Images", url: "/images", icon: ImageIcon },
  { title: "My Quizzes", url: "/quizzes", icon: ClipboardList },
  { title: "Goals", url: "/goals", icon: Target },
  { title: "Settings", url: "/settings", icon: Settings },
];

const RECENT_CHATS = [
  { id: "1", title: "Photosynthesis Explained" },
  { id: "2", title: "Newton's Laws of Motion" },
  { id: "3", title: "World War II Timeline" },
  { id: "4", title: "Python Data Structures" },
  { id: "5", title: "Organic Chemistry Basics" },
  { id: "6", title: "Calculus Integration" },
];

const AppSidebar = () => {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="pt-2">

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
                const isActive = location.pathname === item.url || (item.url === "/chat" && location.pathname === "/");
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
                          <span className="text-sm font-medium">{item.title}</span>
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
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3">
              Your chats
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="px-2 mb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/chat")}
                  className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 h-8"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New chat
                </Button>
              </div>
              <SidebarMenu>
                {RECENT_CHATS.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton asChild>
                      <button
                        onClick={() => navigate("/chat")}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sidebar-foreground hover:bg-secondary hover:text-foreground transition-all duration-200 w-full text-left"
                      >
                        <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs truncate">{chat.title}</span>
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
};

export default AppSidebar;