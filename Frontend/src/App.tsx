import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AppearanceProvider } from "@/contexts/AppearanceContext";
import { UserProvider } from "@/contexts/UserContext";
import { CoinProvider } from "@/contexts/CoinContext";
import AppLayout from "@/components/layout/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import ChatPage from "@/pages/ChatPage";
import QuizzesPage from "@/pages/QuizzesPage";
import FlashcardsPage from "@/pages/FlashcardsPage";
import GoalsPage from "@/pages/GoalsPage";
import SettingsPage from "@/pages/SettingsPage";
import ImagesPage from "@/pages/ImagesPage";
import NovaPage from "@/pages/NovaPage";
import StorePage from "@/pages/StorePage";
import LandingPage from "@/pages/LandingPage";
import NotFound from "@/pages/NotFound";
import SharedChatPage from "@/pages/SharedChatPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LanguageProvider>
        <AppearanceProvider>
          {/* UserProvider wraps CoinProvider so CoinContext can consume useUser() */}
          <UserProvider>
            <CoinProvider>
              <Toaster />
              <Sonner position="top-center" />
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route element={<AppLayout />}>
                    <Route path="/chat" element={<ChatPage />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/images" element={<ImagesPage />} />
                    <Route path="/quizzes" element={<QuizzesPage />} />
                    <Route path="/flashcards" element={<FlashcardsPage />} />
                    <Route path="/goals" element={<GoalsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/nova" element={<NovaPage />} />
                    <Route path="/store" element={<StorePage />} />
                  </Route>
                  <Route path="/chat/shared/:conversationId" element={<SharedChatPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </CoinProvider>
          </UserProvider>
        </AppearanceProvider>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;