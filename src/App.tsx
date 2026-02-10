import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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
import About from "./pages/About";
import HowItWorks from "./pages/HowItWorks";
import FAQ from "./pages/FAQ";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
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
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
