import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Businesses from "./pages/Businesses";
import TrainingSessions from "./pages/TrainingSessions";
import ScheduledJobs from "./pages/ScheduledJobs";
import Settings from "./pages/Settings";
import Campaigns from "./pages/Campaigns";
import PackageTiers from "./pages/PackageTiers";
import Login from "./pages/Login";
import TwoFactorVerify from "./pages/TwoFactorVerify";
import ClientDashboard from "./pages/ClientDashboard";
import ClientDashboards from "./pages/ClientDashboards";
import CampaignDetail from "./pages/CampaignDetail";
import PromptTemplates from "./pages/PromptTemplates";
import KeywordCache from "./pages/KeywordCache";
import {
  LayoutDashboard,
  Building2,
  Brain,
  Calendar,
  Settings as SettingsIcon,
  Rocket,
  Package,
  Link2,
  FileText,
  Database,
} from "lucide-react";

const navigationItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Rocket },
  { href: "/businesses", label: "Businesses", icon: Building2 },
  { href: "/training", label: "Training", icon: Brain },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/packages", label: "Packages", icon: Package },
  { href: "/client-dashboards", label: "Client Links", icon: Link2 },
  { href: "/prompts", label: "Prompts", icon: FileText },
  { href: "/keyword-cache", label: "Keyword Cache", icon: Database },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/2fa-verify" component={TwoFactorVerify} />
      <Route path="/report/:token" component={ClientDashboard} />
      <Route path="/">
        <DashboardLayout navigationItems={navigationItems}>
          <Dashboard />
        </DashboardLayout>
      </Route>
      <Route path="/campaigns">
        <DashboardLayout navigationItems={navigationItems}>
          <Campaigns />
        </DashboardLayout>
      </Route>
      <Route path="/businesses">
        <DashboardLayout navigationItems={navigationItems}>
          <Businesses />
        </DashboardLayout>
      </Route>
      <Route path="/training">
        <DashboardLayout navigationItems={navigationItems}>
          <TrainingSessions />
        </DashboardLayout>
      </Route>
      <Route path="/schedule">
        <DashboardLayout navigationItems={navigationItems}>
          <ScheduledJobs />
        </DashboardLayout>
      </Route>
      <Route path="/packages">
        <DashboardLayout navigationItems={navigationItems}>
          <PackageTiers />
        </DashboardLayout>
      </Route>
      <Route path="/settings">
        <DashboardLayout navigationItems={navigationItems}>
          <Settings />
        </DashboardLayout>
      </Route>
      <Route path="/client-dashboards">
        <DashboardLayout navigationItems={navigationItems}>
          <ClientDashboards />
        </DashboardLayout>
      </Route>
      <Route path="/campaigns/:id">
        <DashboardLayout navigationItems={navigationItems}>
          <CampaignDetail />
        </DashboardLayout>
      </Route>
      <Route path="/prompts">
        <DashboardLayout navigationItems={navigationItems}>
          <PromptTemplates />
        </DashboardLayout>
      </Route>
      <Route path="/keyword-cache">
        <DashboardLayout navigationItems={navigationItems}>
          <KeywordCache />
        </DashboardLayout>
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
