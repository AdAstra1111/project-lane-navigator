import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ThemeProvider } from "@/hooks/useTheme";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import NewProject from "./pages/NewProject";
import ProjectDetail from "./pages/ProjectDetail";
import Trends from "./pages/Trends";
import StoryTrends from "./pages/StoryTrends";
import CastTrends from "./pages/CastTrends";
import IncentiveFinder from "./pages/IncentiveFinder";
import CoproPlanner from "./pages/CoproPlanner";
import StackCashflow from "./pages/StackCashflow";
import CompareProjects from "./pages/CompareProjects";
import Pipeline from "./pages/Pipeline";
import FestivalCalendar from "./pages/FestivalCalendar";
import ProductionCalendar from "./pages/ProductionCalendar";
import BuyerCRM from "./pages/BuyerCRM";
import About from "./pages/About";
import HowItWorks from "./pages/HowItWorks";
import FAQ from "./pages/FAQ";
import AcceptInvite from "./pages/AcceptInvite";
import Notifications from "./pages/Notifications";
import MarketIntelligence from "./pages/MarketIntelligence";
import Settings from "./pages/Settings";
import Reports from "./pages/Reports";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AnimatedRoutes = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Index />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/about" element={<ProtectedRoute><About /></ProtectedRoute>} />
        <Route path="/how-it-works" element={<ProtectedRoute><HowItWorks /></ProtectedRoute>} />
        <Route path="/faq" element={<ProtectedRoute><FAQ /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/projects/new" element={<ProtectedRoute><NewProject /></ProtectedRoute>} />
        <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
        <Route path="/trends" element={<ProtectedRoute><Trends /></ProtectedRoute>} />
        <Route path="/trends/story" element={<ProtectedRoute><StoryTrends /></ProtectedRoute>} />
        <Route path="/trends/cast" element={<ProtectedRoute><CastTrends /></ProtectedRoute>} />
        <Route path="/incentives" element={<ProtectedRoute><IncentiveFinder /></ProtectedRoute>} />
        <Route path="/incentives/copro" element={<ProtectedRoute><CoproPlanner /></ProtectedRoute>} />
        <Route path="/incentives/stack" element={<ProtectedRoute><StackCashflow /></ProtectedRoute>} />
        <Route path="/compare" element={<ProtectedRoute><CompareProjects /></ProtectedRoute>} />
        <Route path="/pipeline" element={<ProtectedRoute><Pipeline /></ProtectedRoute>} />
        <Route path="/festivals" element={<ProtectedRoute><FestivalCalendar /></ProtectedRoute>} />
        <Route path="/calendar" element={<ProtectedRoute><ProductionCalendar /></ProtectedRoute>} />
        <Route path="/buyer-crm" element={<ProtectedRoute><BuyerCRM /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="/market-intelligence" element={<ProtectedRoute><MarketIntelligence /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/invite" element={<AcceptInvite />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AnimatePresence>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AnimatedRoutes />
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
