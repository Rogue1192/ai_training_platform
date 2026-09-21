import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Businesses from "./pages/Businesses";
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
import AgencyClientReports from "./pages/AgencyClientReports";
import ClientIntakeForm from "./pages/ClientIntakeForm";
import CostTracking from "./pages/CostTracking";
import ProspectAudit from "./pages/ProspectAudit";
import AuditHistory from "./pages/AuditHistory";
import PublicAuditReport from "./pages/PublicAuditReport";
import AuditOverageSuccess from "./pages/AuditOverageSuccess";
import AuditWidget from "./pages/AuditWidget";
import V7Accounts from "./pages/V7Accounts";
import { useAuth } from "./_core/hooks/useAuth";
import { Redirect } from "wouter";
import { useEffect, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Building2,
  Settings as SettingsIcon,
  Rocket,
  Package,
  Link2,
  FileText,
  Mail,
  BarChart3,
  Users,
  DollarSign,
  FileBarChart,
  BrainCircuit,
} from "lucide-react";

// Admin navigation — full platform access
const adminNavigationItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Rocket },
  { href: "/businesses", label: "Businesses", icon: Building2 },
  { href: "/packages", label: "Packages", icon: Package },
  { href: "/client-dashboards", label: "Client Links", icon: Link2 },
  { href: "/prompts", label: "Prompts", icon: FileText },
  // Keyword Cache is intentionally hidden from the nav. The page still exists at
  // /keyword-cache and the caching logic keeps running in the background — we
  // just removed the menu item to reduce clutter.
  { href: "/llm-insights", label: "LLM Insights", icon: BarChart3 },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/agencies", label: "Agencies", icon: Users },
  { href: "/cost-tracking", label: "Cost Tracking", icon: DollarSign },
  { href: "/prospect-audit", label: "AI Visibility Audit", icon: FileBarChart, openInNewWindow: true },
  { href: "/audit-history", label: "Audit History", icon: BarChart3 },
  { href: "/v7-accounts", label: "V7 Accounts", icon: BrainCircuit },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

// Base agency nav — alertCount is injected dynamically by AgencyNavWrapper
const BASE_AGENCY_NAV = [
  { href: "/agency", label: "My Clients", icon: Building2 },
  { href: "/agency/client-reports", label: "Client Reports", icon: FileBarChart },
  { href: "/agency/llm-insights", label: "LLM Insights", icon: BarChart3 },
  { href: "/prospect-audit", label: "AI Visibility Audit", icon: FileBarChart, openInNewWindow: true },
  { href: "/audit-history", label: "Audit History", icon: BarChart3 },
  { href: "/agency/settings", label: "Settings", icon: SettingsIcon },
];
// Note: Settings is intentionally last in both nav arrays — it should always appear at the bottom.

/** Wraps agency routes and injects the blocked-client count badge into the nav. */
function AgencyRoute({ children }: { children: React.ReactNode }) {
  const { data: clients } = trpc.agency.myClients.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  const agencyNavigationItems = useMemo(() => {
    const blockedCount = (clients ?? []).filter((c: any) => c.campaignBlocked === true).length;
    return BASE_AGENCY_NAV.map((item) =>
      item.href === "/agency" && blockedCount > 0
        ? { ...item, alertCount: blockedCount }
        : item
    );
  }, [clients]);
  return (
    <DashboardLayout navigationItems={agencyNavigationItems}>
      {children}
    </DashboardLayout>
  );
}

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
  const navItems = isAgency ? BASE_AGENCY_NAV : adminNavigationItems;

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
      <Route path="/v7-accounts">
        <DashboardLayout navigationItems={navItems}>
          <V7Accounts />
        </DashboardLayout>
      </Route>

      {/* Prospect Audit — opens in new window, no platform chrome */}
      <Route path="/prospect-audit" component={ProspectAudit} />

      {/* Audit History — inside platform chrome.
           navItems is already agency nav when user.role === 'agency'.
           When a super-admin is impersonating (sessionStorage has impersonatedAgencyId)
           we also need agency nav — AgencyRoute handles that. */}
      <Route path="/audit-history">
        {(() => {
          const impersonating = typeof sessionStorage !== 'undefined' && !!sessionStorage.getItem('impersonatedAgencyId');
          return impersonating ? (
            <AgencyRoute><AuditHistory /></AgencyRoute>
          ) : (
            <DashboardLayout navigationItems={navItems}>
              <AuditHistory />
            </DashboardLayout>
          );
        })()}
      </Route>

      {/* Stripe overage success landing page */}
      <Route path="/audit-overage-success" component={AuditOverageSuccess} />

      {/* Public shareable audit report — no auth required */}
      <Route path="/audit/:token" component={PublicAuditReport} />

      {/* Embeddable audit widget — no auth required, loaded in iframe by embed script */}
      <Route path="/audit-widget" component={AuditWidget} />

      {/* ── Agency portal routes ── */}
      <Route path="/agency">
        <AgencyRoute><AgencyPortal /></AgencyRoute>
      </Route>
      <Route path="/agency/settings">
        <AgencyRoute><AgencySettings /></AgencyRoute>
      </Route>
      <Route path="/agency/clients/:id">
        <AgencyRoute><AgencyClientDetail /></AgencyRoute>
      </Route>
      <Route path="/agency/client-reports">
        <AgencyRoute><AgencyClientReports /></AgencyRoute>
      </Route>
      <Route path="/agency/llm-insights">
        <AgencyRoute><AgencyLLMInsights /></AgencyRoute>
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
