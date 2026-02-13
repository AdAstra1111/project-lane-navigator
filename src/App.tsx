import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CommandPalette } from "@/components/CommandPalette";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { CorpusIntegrityBanner } from "@/components/corpus/CorpusIntegrityBanner";
import { UIModeProvider } from "@/hooks/useUIMode";

// Eagerly load landing + auth (first paint)
import Index from "./pages/Index";
import Auth from "./pages/Auth";

// Lazy-load everything else
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NewProject = lazy(() => import("./pages/NewProject"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const Trends = lazy(() => import("./pages/Trends"));
const StoryTrends = lazy(() => import("./pages/StoryTrends"));
const CastTrends = lazy(() => import("./pages/CastTrends"));
const IncentiveFinder = lazy(() => import("./pages/IncentiveFinder"));
const CoproPlanner = lazy(() => import("./pages/CoproPlanner"));
const StackCashflow = lazy(() => import("./pages/StackCashflow"));
const CompareProjects = lazy(() => import("./pages/CompareProjects"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const FestivalCalendar = lazy(() => import("./pages/FestivalCalendar"));
const ProductionCalendar = lazy(() => import("./pages/ProductionCalendar"));
const BuyerCRM = lazy(() => import("./pages/BuyerCRM"));
const About = lazy(() => import("./pages/About"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const FAQ = lazy(() => import("./pages/FAQ"));
const HowIFFYThinks = lazy(() => import("./pages/HowIFFYThinks"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const Notifications = lazy(() => import("./pages/Notifications"));
const MarketIntelligence = lazy(() => import("./pages/MarketIntelligence"));
const Settings = lazy(() => import("./pages/Settings"));
const Reports = lazy(() => import("./pages/Reports"));
const Companies = lazy(() => import("./pages/Companies"));
const CompanyDetail = lazy(() => import("./pages/CompanyDetail"));
const PresentationMode = lazy(() => import("./pages/PresentationMode"));
const TrendGovernance = lazy(() => import("./pages/TrendGovernance"));
const CinematicDemo = lazy(() => import("./pages/CinematicDemo"));
const InteractiveDemo = lazy(() => import("./pages/InteractiveDemo"));
const ExecutiveDemo = lazy(() => import("./pages/ExecutiveDemo"));
const Pricing = lazy(() => import("./pages/Pricing"));
const CoverageLab = lazy(() => import("./pages/CoverageLab"));
const PitchIdeas = lazy(() => import("./pages/PitchIdeas"));
const CalibrationLab = lazy(() => import("./pages/CalibrationLab"));
const PitchDeckViewer = lazy(() => import("./pages/PitchDeckViewer"));
const InvestorPresentation = lazy(() => import("./pages/InvestorPresentation"));
const DevelopmentEngine = lazy(() => import("./pages/DevelopmentEngine"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 min – avoid redundant refetches
      gcTime: 1000 * 60 * 10, // 10 min garbage collection
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const PageFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-8 w-8 rounded-md bg-primary animate-pulse" />
  </div>
);

const AnimatedRoutes = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="popLayout">
      <Suspense fallback={<PageFallback />}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/about" element={<ProtectedRoute><About /></ProtectedRoute>} />
          <Route path="/how-it-works" element={<ProtectedRoute><HowItWorks /></ProtectedRoute>} />
          <Route path="/faq" element={<ProtectedRoute><FAQ /></ProtectedRoute>} />
          <Route path="/how-iffy-thinks" element={<ProtectedRoute><HowIFFYThinks /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/projects/new" element={<ProtectedRoute><NewProject /></ProtectedRoute>} />
          <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
          <Route path="/trends" element={<ProtectedRoute><Trends /></ProtectedRoute>} />
          <Route path="/trends/story" element={<ProtectedRoute><StoryTrends /></ProtectedRoute>} />
          <Route path="/trends/cast" element={<ProtectedRoute><CastTrends /></ProtectedRoute>} />
          <Route path="/trends/governance" element={<ProtectedRoute><TrendGovernance /></ProtectedRoute>} />
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
          <Route path="/companies" element={<ProtectedRoute><Companies /></ProtectedRoute>} />
          <Route path="/companies/:id" element={<ProtectedRoute><CompanyDetail /></ProtectedRoute>} />
          <Route path="/projects/:id/present" element={<ProtectedRoute><PresentationMode /></ProtectedRoute>} />
          <Route path="/projects/:id/pitch-deck" element={<ProtectedRoute><PitchDeckViewer /></ProtectedRoute>} />
          <Route path="/pricing" element={<ProtectedRoute><Pricing /></ProtectedRoute>} />
          <Route path="/coverage-lab" element={<ProtectedRoute><CoverageLab /></ProtectedRoute>} />
          <Route path="/pitch-ideas" element={<ProtectedRoute><PitchIdeas /></ProtectedRoute>} />
          <Route path="/calibration-lab" element={<ProtectedRoute><CalibrationLab /></ProtectedRoute>} />
          <Route path="/demo" element={<CinematicDemo />} />
          <Route path="/demo/interactive" element={<InteractiveDemo />} />
          <Route path="/demo/executive" element={<ExecutiveDemo />} />
          <Route path="/investor" element={<ProtectedRoute><InvestorPresentation /></ProtectedRoute>} />
          <Route path="/development-engine" element={<ProtectedRoute><DevelopmentEngine /></ProtectedRoute>} />
          <Route path="/invite" element={<AcceptInvite />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AnimatePresence>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
    <UIModeProvider>
    <ThemeProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <CorpusIntegrityBanner />
        <CommandPalette />
        <AnimatedRoutes />
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
    </UIModeProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
