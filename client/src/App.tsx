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
import EmailManagement from "./pages/EmailManagement";
import LLMInsights from "./pages/LLMInsights";
import AgencyManagement from "./pages/AgencyManagement";
import AgencyPortal from "./pages/AgencyPortal";
import AgencySettings from "./pages/AgencySettings";
import AgencyClientDetail from "./pages/AgencyClientDetail";
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
  Mail,
  BarChart3,
  Users,
} from "lucide-react";

// Admin navigation — full platform access
const adminNavigationItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Rocket },
  { href: "/businesses", label: "Businesses", icon: Building2 },
  { href: "/training", label: "Training", icon: Brain },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/packages", label: "Packages", icon: Package },
  { href: "/client-dashboards", label: "Client Links", icon: Link2 },
  { href: "/prompts", label: "Prompts", icon: FileText },
  { href: "/keyword-cache", label: "Keyword Cache", icon: Database },
  { href: "/llm-insights", label: "LLM Insights", icon: BarChart3 },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/agencies", label: "Agencies", icon: Users },
];

// Agency navigation — limited to their portal
const agencyNavigationItems = [
  { href: "/agency", label: "My Clients", icon: Building2 },
  { href: "/agency/settings", label: "Settings", icon: SettingsIcon },
];

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/2fa-verify" component={TwoFactorVerify} />
      <Route path="/report/:token" component={ClientDashboard} />
      <Route path="/">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <Dashboard />
        </DashboardLayout>
      </Route>
      <Route path="/campaigns">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <Campaigns />
        </DashboardLayout>
      </Route>
      <Route path="/businesses">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <Businesses />
        </DashboardLayout>
      </Route>
      <Route path="/training">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <TrainingSessions />
        </DashboardLayout>
      </Route>
      <Route path="/schedule">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <ScheduledJobs />
        </DashboardLayout>
      </Route>
      <Route path="/packages">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <PackageTiers />
        </DashboardLayout>
      </Route>
      <Route path="/settings">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <Settings />
        </DashboardLayout>
      </Route>
      <Route path="/client-dashboards">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <ClientDashboards />
        </DashboardLayout>
      </Route>
      <Route path="/campaigns/:id">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <CampaignDetail />
        </DashboardLayout>
      </Route>
      <Route path="/prompts">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <PromptTemplates />
        </DashboardLayout>
      </Route>
      <Route path="/keyword-cache">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <KeywordCache />
        </DashboardLayout>
      </Route>
      <Route path="/emails">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <EmailManagement />
        </DashboardLayout>
      </Route>
      <Route path="/llm-insights">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <LLMInsights />
        </DashboardLayout>
      </Route>
      <Route path="/agencies">
        <DashboardLayout navigationItems={adminNavigationItems}>
          <AgencyManagement />
        </DashboardLayout>
      </Route>

      {/* ── Agency portal routes ── */}
      <Route path="/agency">
        <DashboardLayout navigationItems={agencyNavigationItems}>
          <AgencyPortal />
        </DashboardLayout>
      </Route>
      <Route path="/agency/settings">
        <DashboardLayout navigationItems={agencyNavigationItems}>
          <AgencySettings />
        </DashboardLayout>
      </Route>
      <Route path="/agency/clients/:id">
        <DashboardLayout navigationItems={agencyNavigationItems}>
          <AgencyClientDetail />
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
