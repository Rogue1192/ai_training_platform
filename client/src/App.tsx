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
import AgencyLLMInsights from "./pages/AgencyLLMInsights";
import ClientIntakeForm from "./pages/ClientIntakeForm";
import CostTracking from "./pages/CostTracking";
import { useAuth } from "./_core/hooks/useAuth";
import { Redirect } from "wouter";
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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
  Mail,
  BarChart3,
  Users,
  DollarSign,
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
  // Keyword Cache is intentionally hidden from the nav. The page still exists at
  // /keyword-cache and the caching logic keeps running in the background — we
  // just removed the menu item to reduce clutter.
  { href: "/llm-insights", label: "LLM Insights", icon: BarChart3 },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/agencies", label: "Agencies", icon: Users },
  { href: "/cost-tracking", label: "Cost Tracking", icon: DollarSign },
];

// Agency navigation — limited to their portal
const agencyNavigationItems = [
  { href: "/agency", label: "My Clients", icon: Building2 },
  { href: "/agency/llm-insights", label: "LLM Insights", icon: BarChart3 },
  { href: "/agency/settings", label: "Settings", icon: SettingsIcon },
];

/** Polls Monkey Indexer account info once on mount (admin only) and shows a warning toast if credits ≤ 50. */
function MonkeyIndexerCreditWatch() {
  const { user } = useAuth();
  const warned = useRef(false);
  const { data } = trpc.indexing.getAccountInfo.useQuery(undefined, {
    enabled: !!user && user.role !== "agency",
    staleTime: 1000 * 60 * 60, // re-fetch at most once per hour
    retry: false,
  });

  useEffect(() => {
    if (!data || warned.current) return;
    const credits = data.creditsAvailable ?? Infinity;
    if (credits <= 50) {
      warned.current = true;
      toast.warning(
        `⚠️ Monkey Indexer: only ${credits} credit${credits === 1 ? "" : "s"} remaining`,
        {
          description: "Top up at monkeyindexer.com/dashboard/billing before the next indexing run.",
          duration: 12000,
          action: {
            label: "Top Up",
            onClick: () => window.open("https://monkeyindexer.com/dashboard/billing", "_blank"),
          },
        }
      );
    }
  }, [data]);

  return null;
}

function Router() {
  const { user } = useAuth();
  const isAgency = user?.role === "agency";
  const navItems = isAgency ? agencyNavigationItems : adminNavigationItems;

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/2fa-verify" component={TwoFactorVerify} />
      <Route path="/report/:token" component={ClientDashboard} />
      <Route path="/">
        {isAgency ? <Redirect to="/agency" /> : (
          <DashboardLayout navigationItems={navItems}>
            <Dashboard />
          </DashboardLayout>
        )}
      </Route>
      <Route path="/campaigns">
        <DashboardLayout navigationItems={navItems}>
          <Campaigns />
        </DashboardLayout>
      </Route>
      <Route path="/businesses">
        <DashboardLayout navigationItems={navItems}>
          <Businesses />
        </DashboardLayout>
      </Route>
      <Route path="/training">
        <DashboardLayout navigationItems={navItems}>
          <TrainingSessions />
        </DashboardLayout>
      </Route>
      <Route path="/schedule">
        <DashboardLayout navigationItems={navItems}>
          <ScheduledJobs />
        </DashboardLayout>
      </Route>
      <Route path="/packages">
        <DashboardLayout navigationItems={navItems}>
          <PackageTiers />
        </DashboardLayout>
      </Route>
      <Route path="/settings">
        <DashboardLayout navigationItems={navItems}>
          <Settings />
        </DashboardLayout>
      </Route>
      <Route path="/client-dashboards">
        <DashboardLayout navigationItems={navItems}>
          <ClientDashboards />
        </DashboardLayout>
      </Route>
      <Route path="/campaigns/:id">
        <DashboardLayout navigationItems={navItems}>
          <CampaignDetail />
        </DashboardLayout>
      </Route>
      <Route path="/prompts">
        <DashboardLayout navigationItems={navItems}>
          <PromptTemplates />
        </DashboardLayout>
      </Route>
      <Route path="/keyword-cache">
        <DashboardLayout navigationItems={navItems}>
          <KeywordCache />
        </DashboardLayout>
      </Route>
      <Route path="/emails">
        <DashboardLayout navigationItems={navItems}>
          <EmailManagement />
        </DashboardLayout>
      </Route>
      <Route path="/llm-insights">
        <DashboardLayout navigationItems={navItems}>
          <LLMInsights />
        </DashboardLayout>
      </Route>
      <Route path="/agencies">
        <DashboardLayout navigationItems={navItems}>
          <AgencyManagement />
        </DashboardLayout>
      </Route>
      <Route path="/cost-tracking">
        <DashboardLayout navigationItems={navItems}>
          <CostTracking />
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
      <Route path="/agency/llm-insights">
        <DashboardLayout navigationItems={agencyNavigationItems}>
          <AgencyLLMInsights />
        </DashboardLayout>
      </Route>

      {/* Public client intake form — no auth required */}
      <Route path="/intake/:token" component={ClientIntakeForm} />
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
          <MonkeyIndexerCreditWatch />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
