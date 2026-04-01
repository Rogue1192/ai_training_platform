/**
 * Email Service (Resend Integration)
 *
 * White-label branded email sending via Resend.
 * White-label settings are loaded from the DB at send time (serviceKeys table, service='whitelabel').
 * Falls back to hardcoded defaults if not configured.
 *
 * Templates:
 * - Win notification emails (sent to clients when new rankings detected)
 * - Baseline visibility emails (sent on Day 1 with before-videos for every query)
 * - Package upgrade emails (sent when trial converts to full package at day 14)
 * - Visibility report emails (periodic visibility score updates)
 * - Welcome/onboarding emails (sent when a new campaign starts)
 * - Campaign milestone emails (pipeline progress updates)
 * - Trial admin notification emails (internal alerts for trial wins)
 * - Trial expired emails (sent when trial ends without wins)
 */

import { Resend } from "resend";

// ─── White-Label Settings ────────────────────────────────────────────────────

export interface WhiteLabelSettings {
  companyName: string;
  fromEmail: string;
  supportEmail: string;
  appUrl: string;
  footerText: string;
  logoUrl?: string;
}

const DEFAULT_WHITE_LABEL: WhiteLabelSettings = {
  companyName: "AI Answer Forge",
  fromEmail: "AI Answer Forge <updates@my.aianswerforge.com>",
  supportEmail: "support@my.aianswerforge.com",
  appUrl: "https://aianswerforge.com",
  footerText: "Powered by AI Answer Forge",
};

let cachedWhiteLabel: WhiteLabelSettings | null = null;
let whiteLabelCacheExpiry = 0;

/**
 * Load white-label settings from DB (cached for 5 minutes).
 * Falls back to defaults if not configured.
 */
async function getWhiteLabel(): Promise<WhiteLabelSettings> {
  const now = Date.now();
  if (cachedWhiteLabel && now < whiteLabelCacheExpiry) {
    return cachedWhiteLabel;
  }
  try {
    const { getServiceKey } = await import("./db");
    const { decrypt } = await import("./encryption");
    const record = await getServiceKey("whitelabel" as any);
    if (record?.encryptedValue) {
      const json = decrypt(record.encryptedValue);
      const parsed = JSON.parse(json) as Partial<WhiteLabelSettings>;
      cachedWhiteLabel = { ...DEFAULT_WHITE_LABEL, ...parsed };
      whiteLabelCacheExpiry = now + 5 * 60 * 1000;
      return cachedWhiteLabel;
    }
  } catch {
    // Fall through to defaults
  }
  return DEFAULT_WHITE_LABEL;
}

/** Invalidate the white-label cache (call after saving new settings). */
export function invalidateWhiteLabelCache(): void {
  cachedWhiteLabel = null;
  whiteLabelCacheExpiry = 0;
}

// ─── Resend Client ────────────────────────────────────────────────────────────

let resendClient: Resend | null = null;

async function getResend(): Promise<Resend> {
  if (resendClient) return resendClient;
  try {
    const { getServiceKey } = await import("./db");
    const { decrypt } = await import("./encryption");
    const record = await getServiceKey("resend");
    if (record?.encryptedValue) {
      const apiKey = decrypt(record.encryptedValue);
      if (apiKey) {
        resendClient = new Resend(apiKey);
        return resendClient;
      }
    }
  } catch {
    // Fall through to env var
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Resend API key not configured. Please add it in Settings → Service Keys.");
  resendClient = new Resend(apiKey);
  return resendClient;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WinEmailData {
  businessName: string;
  contactName: string;
  contactEmail: string;
  totalWins: number;
  wins: Array<{
    platform: string;
    query: string;
    location: string;
    message: string;
    significance: "minor" | "moderate" | "major" | "breakthrough";
    beforeVideoChatgpt?: string;
    beforeVideoGoogleAi?: string;
    afterVideoChatgpt?: string;
    afterVideoGoogleAi?: string;
  }>;
  currentScore: number;
  previousScore: number | null;
  dashboardUrl?: string;
  paymentUrl?: string;
  packageName?: string;
  monthlyPrice?: number;
}

export interface VisibilityReportEmailData {
  businessName: string;
  contactName: string;
  contactEmail: string;
  currentScore: number;
  baselineScore: number | null;
  previousScore: number | null;
  chatgptScore: number;
  geminiScore: number;
  aiOverviewScore: number;
  mentionedQueries: number;
  totalQueries: number;
  topWins: Array<{
    query: string;
    platform: string;
    position: number | null;
  }>;
  dashboardUrl?: string;
  reportPeriod: string;
}

export interface WelcomeEmailData {
  businessName: string;
  contactName: string;
  contactEmail: string;
  packageName: string;
  dashboardUrl?: string;
}

export interface MilestoneEmailData {
  businessName: string;
  contactName: string;
  contactEmail: string;
  milestone: string;
  milestoneDescription: string;
  nextStep: string;
  dashboardUrl?: string;
}

export interface BaselineVisibilityEmailData {
  businessName: string;
  contactName: string;
  contactEmail: string;
  dashboardUrl?: string;
  notRankingQueries: Array<{
    query: string;
    location: string;
    beforeVideoChatgpt?: string;
    beforeVideoGoogleAi?: string;
  }>;
  alreadyRankingQueries: Array<{
    query: string;
    location: string;
  }>;
}

export interface PackageUpgradeEmailData {
  businessName: string;
  contactName: string;
  contactEmail: string;
  packageName: string;
  maxQueries: number;
  maxLocations: number;
  dashboardUrl?: string;
  newBaselineQueries: Array<{
    query: string;
    location: string;
    beforeVideoChatgpt?: string;
    beforeVideoGoogleAi?: string;
  }>;
}

// ─── Base Template ──────────────────────────────────────────────────────────

function baseTemplate(content: string, preheader: string = "", wl: WhiteLabelSettings = DEFAULT_WHITE_LABEL): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${wl.companyName}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #0a0e1a;
      color: #e2e8f0;
      -webkit-font-smoothing: antialiased;
    }

    .preheader {
      display: none !important;
      visibility: hidden;
      mso-hide: all;
      font-size: 1px;
      line-height: 1px;
      max-height: 0;
      max-width: 0;
      opacity: 0;
      overflow: hidden;
    }

    .wrapper {
      width: 100%;
      background-color: #0a0e1a;
      padding: 40px 0;
    }

    .container {
      max-width: 600px;
      margin: 0 auto;
      background: linear-gradient(180deg, #111827 0%, #0f172a 100%);
      border-radius: 16px;
      border: 1px solid rgba(59, 130, 246, 0.15);
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }

    .header {
      background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 50%, #1a1a2e 100%);
      padding: 32px 40px;
      text-align: center;
      border-bottom: 1px solid rgba(59, 130, 246, 0.2);
    }

    .logo-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
      font-size: 24px;
    }

    .brand-name {
      font-size: 20px;
      font-weight: 700;
      color: #f8fafc;
      margin: 0;
      letter-spacing: -0.02em;
    }

    .brand-tagline {
      font-size: 13px;
      color: #64748b;
      margin: 4px 0 0;
    }

    .content {
      padding: 40px;
    }

    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #f8fafc;
      margin: 0 0 8px;
      letter-spacing: -0.02em;
    }

    h2 {
      font-size: 18px;
      font-weight: 600;
      color: #e2e8f0;
      margin: 24px 0 12px;
    }

    p {
      font-size: 15px;
      line-height: 1.6;
      color: #94a3b8;
      margin: 0 0 16px;
    }

    .subtitle {
      font-size: 15px;
      color: #64748b;
      margin: 0 0 24px;
    }

    .score-card {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(37, 99, 235, 0.05));
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      margin: 24px 0;
    }

    .score-value {
      font-size: 56px;
      font-weight: 700;
      letter-spacing: -0.04em;
      line-height: 1;
      margin: 0;
    }

    .score-label {
      font-size: 13px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 8px 0 0;
    }

    .score-change {
      font-size: 14px;
      font-weight: 600;
      margin: 8px 0 0;
    }

    .score-change.positive { color: #22c55e; }
    .score-change.negative { color: #ef4444; }
    .score-change.neutral { color: #64748b; }

    /* ── Win Hero Card ── */
    .win-hero {
      background: linear-gradient(135deg, #0d2137 0%, #0f172a 100%);
      border: 2px solid rgba(34, 197, 94, 0.4);
      border-radius: 14px;
      padding: 28px 24px;
      margin: 16px 0;
      text-align: center;
    }

    .win-hero-badge {
      display: inline-block;
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 4px 14px;
      border-radius: 20px;
      margin-bottom: 14px;
    }

    .win-hero-badge.breakthrough {
      background: rgba(234, 179, 8, 0.15);
      color: #eab308;
    }

    .win-hero-headline {
      font-size: 22px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.3;
      margin: 0 0 10px;
      letter-spacing: -0.02em;
    }

    .win-hero-sub {
      font-size: 13px;
      color: #64748b;
      margin: 0 0 18px;
    }

    .video-btn-row {
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
    }

    .video-btn {
      display: inline-block;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
    }

    .video-btn-before {
      background: rgba(59, 130, 246, 0.15);
      color: #93c5fd;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    .video-btn-after {
      background: rgba(34, 197, 94, 0.15);
      color: #86efac;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }

    /* ── Baseline Query Card ── */
    .query-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(59, 130, 246, 0.15);
      border-radius: 12px;
      padding: 20px;
      margin: 10px 0;
    }

    .query-card-title {
      font-size: 16px;
      font-weight: 700;
      color: #f1f5f9;
      margin: 0 0 4px;
    }

    .query-card-loc {
      font-size: 12px;
      color: #64748b;
      margin: 0 0 14px;
    }

    /* ── Generic win-card (legacy) ── */
    .win-card {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(59, 130, 246, 0.15);
      border-radius: 10px;
      padding: 16px;
      margin: 8px 0;
    }

    .win-card.breakthrough {
      border-color: rgba(234, 179, 8, 0.4);
      background: linear-gradient(135deg, rgba(234, 179, 8, 0.08), rgba(234, 179, 8, 0.02));
    }

    .win-card.major {
      border-color: rgba(34, 197, 94, 0.3);
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(34, 197, 94, 0.02));
    }

    .win-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    .win-badge.breakthrough { background: rgba(234, 179, 8, 0.15); color: #eab308; }
    .win-badge.major        { background: rgba(34, 197, 94, 0.15);  color: #22c55e; }
    .win-badge.moderate     { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .win-badge.minor        { background: rgba(100, 116, 139, 0.15); color: #94a3b8; }

    .win-text {
      font-size: 14px;
      color: #e2e8f0;
      margin: 0;
      line-height: 1.5;
    }

    .win-meta {
      font-size: 12px;
      color: #64748b;
      margin: 6px 0 0;
    }

    .platform-grid {
      display: flex;
      gap: 12px;
      margin: 16px 0;
    }

    .platform-card {
      flex: 1;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(59, 130, 246, 0.1);
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }

    .platform-name {
      font-size: 12px;
      color: #64748b;
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .platform-score {
      font-size: 28px;
      font-weight: 700;
      margin: 0;
    }

    .comparison-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(59, 130, 246, 0.08);
    }

    .comparison-label { font-size: 14px; color: #94a3b8; }
    .comparison-values { display: flex; align-items: center; gap: 8px; }
    .comparison-old { font-size: 14px; color: #64748b; text-decoration: line-through; }
    .comparison-arrow { color: #22c55e; font-size: 14px; }
    .comparison-new { font-size: 14px; font-weight: 600; color: #22c55e; }

    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      margin: 24px 0;
      text-align: center;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3);
    }

    .divider {
      height: 1px;
      background: rgba(59, 130, 246, 0.1);
      margin: 24px 0;
    }

    .footer {
      padding: 24px 40px;
      text-align: center;
      border-top: 1px solid rgba(59, 130, 246, 0.1);
    }

    .footer p {
      font-size: 12px;
      color: #475569;
      margin: 4px 0;
    }

    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }

    @media only screen and (max-width: 640px) {
      .container { margin: 0 12px; }
      .content { padding: 24px; }
      .header { padding: 24px; }
      .footer { padding: 20px 24px; }
      .score-value { font-size: 44px; }
      .win-hero-headline { font-size: 18px; }
    }
  </style>
</head>
<body>
  <div class="preheader">${preheader}</div>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        ${wl.logoUrl
          ? `<img src="${wl.logoUrl}" alt="${wl.companyName}" style="height:48px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />`
          : `<div class="logo-icon">&#9889;</div>`
        }
        <p class="brand-name">${wl.companyName}</p>
        <p class="brand-tagline">AI Search Visibility Platform</p>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>${wl.footerText}</p>
        <p style="margin-top: 12px;">Questions? Contact <a href="mailto:${wl.supportEmail}">${wl.supportEmail}</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Score Helpers ──────────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#3b82f6";
  if (score >= 30) return "#eab308";
  if (score >= 15) return "#f97316";
  return "#ef4444";
}

function getScoreLabel(score: number): string {
  if (score >= 70) return "Dominating";
  if (score >= 50) return "Strong";
  if (score >= 30) return "Growing";
  if (score >= 15) return "Emerging";
  if (score > 0) return "Barely Visible";
  return "Invisible";
}

// ─── Win Headline Builder ────────────────────────────────────────────────────

/**
 * Build a punchy, client-readable headline for a single win.
 * e.g. "Sample Business is now the #1 recommendation on ChatGPT for 'best HVAC company in Dallas'"
 */
function buildWinHeadline(win: WinEmailData["wins"][0], businessName: string): string {
  const platform = win.platform.toLowerCase().includes("google") ? "Google AI" : "ChatGPT";
  if (win.significance === "breakthrough" || win.significance === "major") {
    return `${businessName} is now the <span style="color:#22c55e;">#1 recommendation</span> on ${platform} for &ldquo;${win.query}&rdquo; in ${win.location}`;
  }
  if (win.significance === "moderate") {
    return `${businessName} is now <span style="color:#3b82f6;">appearing in ${platform}</span> for &ldquo;${win.query}&rdquo; in ${win.location}`;
  }
  return `${businessName} is gaining visibility on ${platform} for &ldquo;${win.query}&rdquo; in ${win.location}`;
}

// ─── Win Notification Email ─────────────────────────────────────────────────

function buildWinEmailHtml(data: WinEmailData, wl: WhiteLabelSettings): string {
  const scoreColor = getScoreColor(data.currentScore);
  const scoreLabel = getScoreLabel(data.currentScore);

  const scoreChange = data.previousScore !== null
    ? data.currentScore - data.previousScore
    : null;

  const scoreChangeHtml = scoreChange !== null
    ? `<p class="score-change ${scoreChange > 0 ? "positive" : scoreChange < 0 ? "negative" : "neutral"}">
        ${scoreChange > 0 ? "&#9650;" : scoreChange < 0 ? "&#9660;" : "&#9654;"} ${scoreChange > 0 ? "+" : ""}${scoreChange} points ${scoreChange > 0 ? "improvement" : scoreChange < 0 ? "decline" : "no change"}
      </p>`
    : "";

  // Sort wins by significance
  const significanceOrder: Record<string, number> = { breakthrough: 0, major: 1, moderate: 2, minor: 3 };
  const sortedWins = [...data.wins].sort(
    (a, b) => significanceOrder[a.significance] - significanceOrder[b.significance]
  );

  const winsHtml = sortedWins.slice(0, 5).map((win) => {
    const badgeLabel =
      win.significance === "breakthrough" ? "&#127942; Breakthrough Win" :
      win.significance === "major"        ? "&#11088; Major Win" :
      win.significance === "moderate"     ? "&#128200; Improvement" :
                                            "&#128077; Progress";

    const headline = buildWinHeadline(win, data.businessName);

    // Video buttons
    const beforeBtns: string[] = [];
    const afterBtns: string[] = [];
    if (win.beforeVideoChatgpt)  beforeBtns.push(`<a href="${win.beforeVideoChatgpt}"  class="video-btn video-btn-before" style="display:inline-block;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.3);">&#9654; Before — ChatGPT</a>`);
    if (win.beforeVideoGoogleAi) beforeBtns.push(`<a href="${win.beforeVideoGoogleAi}" class="video-btn video-btn-before" style="display:inline-block;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.3);">&#9654; Before — Google AI</a>`);
    if (win.afterVideoChatgpt)   afterBtns.push(`<a href="${win.afterVideoChatgpt}"   class="video-btn video-btn-after"  style="display:inline-block;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;background:rgba(34,197,94,0.15);color:#86efac;border:1px solid rgba(34,197,94,0.3);">&#9654; After — ChatGPT</a>`);
    if (win.afterVideoGoogleAi)  afterBtns.push(`<a href="${win.afterVideoGoogleAi}"  class="video-btn video-btn-after"  style="display:inline-block;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;background:rgba(34,197,94,0.15);color:#86efac;border:1px solid rgba(34,197,94,0.3);">&#9654; After — Google AI</a>`);

    const videosHtml = (beforeBtns.length > 0 || afterBtns.length > 0) ? `
      <div style="margin-top:14px;">
        ${beforeBtns.length > 0 ? `<div style="margin-bottom:8px;"><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Before:</span><br/><div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">${beforeBtns.join("")}</div></div>` : ""}
        ${afterBtns.length > 0  ? `<div><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">After:</span><br/><div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">${afterBtns.join("")}</div></div>` : ""}
      </div>` : "";

    return `
    <div class="win-hero" style="background:linear-gradient(135deg,#0d2137 0%,#0f172a 100%);border:2px solid rgba(34,197,94,0.4);border-radius:14px;padding:28px 24px;margin:16px 0;text-align:center;">
      <div class="win-hero-badge ${win.significance}" style="display:inline-block;background:rgba(34,197,94,0.15);color:#22c55e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;padding:4px 14px;border-radius:20px;margin-bottom:14px;">${badgeLabel}</div>
      <p class="win-hero-headline" style="font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;margin:0 0 10px;letter-spacing:-0.02em;">${headline}</p>
      <p class="win-hero-sub" style="font-size:13px;color:#64748b;margin:0;">${win.platform} &bull; ${win.location}</p>
      ${videosHtml}
    </div>`;
  }).join("");

  const content = `
    <h1>&#127942; ${data.totalWins} New Win${data.totalWins > 1 ? "s" : ""} for ${data.businessName}!</h1>
    <p class="subtitle">Hi ${data.contactName} — your business just appeared in AI search results. Here's the proof.</p>

    <div class="score-card">
      <p class="score-label">Current Visibility Score</p>
      <p class="score-value" style="color: ${scoreColor};">${data.currentScore}</p>
      <p class="score-label">${scoreLabel}</p>
      ${scoreChangeHtml}
    </div>

    ${winsHtml}
    ${data.wins.length > 5 ? `<p style="text-align:center;font-size:13px;color:#64748b;">+ ${data.wins.length - 5} more wins in your dashboard</p>` : ""}

    ${data.dashboardUrl ? `
    <div style="text-align:center;margin-top:32px;">
      <a href="${data.dashboardUrl}" class="cta-button" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;margin:24px 0;">View Live Dashboard &rarr;</a>
    </div>
    ` : ""}

    <div class="divider"></div>
    <p style="font-size:13px;color:#64748b;">Every time your name appears in a new AI result, you'll receive an email like this with video proof. Keep watching — more wins are on the way.</p>
  `;

  const preheader = `${data.businessName} just appeared in AI search results — ${data.totalWins} new win${data.totalWins > 1 ? "s" : ""}!`;
  return baseTemplate(content, preheader, wl);
}

// ─── Baseline Visibility Email ────────────────────────────────────────────────

function buildBaselineVisibilityEmailHtml(data: BaselineVisibilityEmailData, wl: WhiteLabelSettings): string {
  const queryRows = data.notRankingQueries.map((q) => {
    const beforeBtns: string[] = [];
    if (q.beforeVideoChatgpt) {
      beforeBtns.push(`<a href="${q.beforeVideoChatgpt}" style="display:inline-block;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.3);">&#9654; Watch ChatGPT Scan</a>`);
    }
    if (q.beforeVideoGoogleAi) {
      beforeBtns.push(`<a href="${q.beforeVideoGoogleAi}" style="display:inline-block;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.3);">&#9654; Watch Google AI Scan</a>`);
    }
    return `
      <div class="query-card" style="background:rgba(15,23,42,0.7);border:1px solid rgba(59,130,246,0.15);border-radius:12px;padding:20px;margin:10px 0;">
        <p class="query-card-title" style="font-size:16px;font-weight:700;color:#f1f5f9;margin:0 0 4px;">&ldquo;${q.query}&rdquo;</p>
        <p class="query-card-loc" style="font-size:12px;color:#64748b;margin:0 0 14px;">&#128205; ${q.location} &nbsp;&bull;&nbsp; Not yet appearing in AI results</p>
        ${beforeBtns.length > 0
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">${beforeBtns.join("")}</div>`
          : `<p style="font-size:12px;color:#475569;margin:0;">No video recorded yet</p>`
        }
      </div>`;
  }).join("\n");

  const alreadyRankingSection = data.alreadyRankingQueries.length > 0 ? `
    <div style="margin-top:28px;">
      <h2 style="font-size:16px;color:#22c55e;margin-bottom:8px;">Already Appearing &#10003;</h2>
      <p style="color:#94a3b8;font-size:13px;margin-bottom:12px;">Great news — ${data.businessName} already shows up in AI results for these queries. We'll focus our efforts on the areas above.</p>
      ${data.alreadyRankingQueries.map((q) => `
        <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:14px 16px;margin:6px 0;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#22c55e;">&#10003; &ldquo;${q.query}&rdquo; &mdash; ${q.location}</p>
        </div>`).join("\n")}
    </div>` : "";

  const content = `
    <h1>Your AI Visibility Baseline Report</h1>
    <p class="subtitle">Hi ${data.contactName}, here's exactly where ${data.businessName} stands in AI search right now — before we get to work.</p>

    <div class="score-card">
      <p class="score-label">Current AI Visibility</p>
      <p style="font-size:36px;font-weight:700;color:#ef4444;margin:8px 0;">${data.notRankingQueries.length > 0 ? "Not Ranking" : "Already Visible"}</p>
      <p style="font-size:14px;color:#94a3b8;margin:0;">${data.notRankingQueries.length} quer${data.notRankingQueries.length === 1 ? "y" : "ies"} where you're not yet appearing</p>
    </div>

    <p>We ran live scans on <strong>ChatGPT</strong> and <strong>Google AI</strong> for every query and location in your campaign. Click the videos below to see exactly what happens when someone searches for your services right now.</p>

    <p><strong>That's about to change.</strong> Watch these videos, then check your dashboard over the coming days as your name starts showing up.</p>

    <h2 style="font-size:16px;margin-top:24px;">Queries Where You're Not Yet Ranking</h2>
    ${queryRows || "<p style='color:#94a3b8;'>All queries are already ranking — great starting position!</p>"}

    ${alreadyRankingSection}

    ${data.dashboardUrl ? `
    <div style="text-align:center;margin-top:32px;">
      <a href="${data.dashboardUrl}" class="cta-button" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;margin:24px 0;">Track Your Progress Live &rarr;</a>
    </div>
    <p style="text-align:center;font-size:12px;color:#64748b;margin-top:0;">Bookmark this link — it's your real-time AI visibility dashboard.</p>
    ` : ""}

    <div class="divider"></div>
    <p style="font-size:13px;color:#64748b;">Every time your name appears in a new AI result, you'll get an email with a before-and-after video showing the change. Most clients start seeing results within 7–14 days.</p>
  `;

  return baseTemplate(content, `${data.businessName} AI Visibility Baseline — here's where you stand today.`, wl);
}

// ─── Package Upgrade Email ────────────────────────────────────────────────────

function buildPackageUpgradeEmailHtml(data: PackageUpgradeEmailData, wl: WhiteLabelSettings): string {
  const newQueryRows = data.newBaselineQueries.map((q) => {
    const beforeBtns: string[] = [];
    if (q.beforeVideoChatgpt) {
      beforeBtns.push(`<a href="${q.beforeVideoChatgpt}" style="display:inline-block;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.3);">&#9654; Watch ChatGPT Scan</a>`);
    }
    if (q.beforeVideoGoogleAi) {
      beforeBtns.push(`<a href="${q.beforeVideoGoogleAi}" style="display:inline-block;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.3);">&#9654; Watch Google AI Scan</a>`);
    }
    return `
      <div class="query-card" style="background:rgba(15,23,42,0.7);border:1px solid rgba(59,130,246,0.15);border-radius:12px;padding:20px;margin:10px 0;">
        <p class="query-card-title" style="font-size:16px;font-weight:700;color:#f1f5f9;margin:0 0 4px;">&ldquo;${q.query}&rdquo;</p>
        <p class="query-card-loc" style="font-size:12px;color:#64748b;margin:0 0 14px;">&#128205; ${q.location} &nbsp;&bull;&nbsp; Baseline scan complete</p>
        ${beforeBtns.length > 0
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">${beforeBtns.join("")}</div>`
          : `<p style="font-size:12px;color:#475569;margin:0;">Scan video processing…</p>`
        }
      </div>`;
  }).join("\n");

  const content = `
    <div style="background:linear-gradient(135deg,#0d2137 0%,#0f172a 100%);border:2px solid rgba(34,197,94,0.4);border-radius:14px;padding:28px 24px;margin:0 0 24px;text-align:center;">
      <div style="display:inline-block;background:rgba(34,197,94,0.15);color:#22c55e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;padding:4px 14px;border-radius:20px;margin-bottom:14px;">&#127942; Full Package Activated</div>
      <p style="font-size:26px;font-weight:800;color:#ffffff;line-height:1.3;margin:0 0 10px;letter-spacing:-0.02em;">${data.businessName} is now on the <span style="color:#22c55e;">${data.packageName}</span></p>
      <p style="font-size:14px;color:#94a3b8;margin:0;">${data.maxQueries} queries &times; ${data.maxLocations} locations — full coverage activated</p>
    </div>

    <h1>Your Full Package Has Started</h1>
    <p class="subtitle">Hi ${data.contactName}, your 14-day trial has converted to your full <strong>${data.packageName}</strong> package. We've expanded your campaign to cover all your queries and locations.</p>

    <p>We just ran baseline scans on all the <strong>new queries and locations</strong> added by your full package. The videos below show where you stand right now — before the expanded training begins.</p>

    ${data.newBaselineQueries.length > 0 ? `
    <h2 style="font-size:16px;margin-top:24px;">New Queries — Baseline Scans</h2>
    ${newQueryRows}
    ` : `<p style="color:#94a3b8;">All new queries are already being tracked — check your dashboard for the latest status.</p>`}

    ${data.dashboardUrl ? `
    <div style="text-align:center;margin-top:32px;">
      <a href="${data.dashboardUrl}" class="cta-button" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;margin:24px 0;">View Full Dashboard &rarr;</a>
    </div>
    ` : ""}

    <div class="divider"></div>
    <p style="font-size:13px;color:#64748b;">Your expanded training is now running across all ${data.maxQueries} queries and ${data.maxLocations} locations. You'll receive win notifications as each new query starts appearing in AI results.</p>
  `;

  return baseTemplate(content, `${data.businessName} — your full ${data.packageName} package is now active!`, wl);
}

// ─── Visibility Report Email ─────────────────────────────────────────────────

function buildVisibilityReportHtml(data: VisibilityReportEmailData, wl: WhiteLabelSettings): string {
  const scoreColor = getScoreColor(data.currentScore);
  const scoreLabel = getScoreLabel(data.currentScore);

  const baselineChange = data.baselineScore !== null
    ? data.currentScore - data.baselineScore
    : null;

  const previousChange = data.previousScore !== null
    ? data.currentScore - data.previousScore
    : null;

  const changeHtml = baselineChange !== null
    ? `<p class="score-change ${baselineChange > 0 ? "positive" : baselineChange < 0 ? "negative" : "neutral"}">
        ${baselineChange > 0 ? "&#9650;" : baselineChange < 0 ? "&#9660;" : "&#9654;"} ${baselineChange > 0 ? "+" : ""}${baselineChange} points since baseline
      </p>`
    : "";

  const platformHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0;">
      <tr>
        <td width="33%" style="padding: 0 4px 0 0;">
          <div class="platform-card">
            <p class="platform-name">ChatGPT</p>
            <p class="platform-score" style="color: ${getScoreColor(data.chatgptScore)};">${data.chatgptScore}</p>
          </div>
        </td>
        <td width="33%" style="padding: 0 4px;">
          <div class="platform-card">
            <p class="platform-name">Gemini</p>
            <p class="platform-score" style="color: ${getScoreColor(data.geminiScore)};">${data.geminiScore}</p>
          </div>
        </td>
        <td width="33%" style="padding: 0 0 0 4px;">
          <div class="platform-card">
            <p class="platform-name">AI Overview</p>
            <p class="platform-score" style="color: ${getScoreColor(data.aiOverviewScore)};">${data.aiOverviewScore}</p>
          </div>
        </td>
      </tr>
    </table>
  `;

  let comparisonHtml = "";
  if (data.baselineScore !== null) {
    const baselineColor = getScoreColor(data.baselineScore);
    comparisonHtml = `
      <h2>Before &amp; After</h2>
      <div class="comparison-row">
        <span class="comparison-label">Visibility Score</span>
        <span class="comparison-values">
          <span class="comparison-old" style="color: ${baselineColor};">${data.baselineScore}</span>
          <span class="comparison-arrow">&#8594;</span>
          <span class="comparison-new" style="color: ${scoreColor};">${data.currentScore}</span>
        </span>
      </div>
      <div class="comparison-row">
        <span class="comparison-label">Queries Mentioned</span>
        <span class="comparison-values">
          <span class="comparison-new" style="color: #3b82f6;">${data.mentionedQueries} / ${data.totalQueries}</span>
        </span>
      </div>
    `;
  }

  const topWinsHtml = data.topWins.length > 0
    ? `<h2>Top Performing Queries</h2>` + data.topWins.slice(0, 5).map((w) => `
        <div class="win-card">
          <p class="win-text" style="font-weight: 600;">"${w.query}"</p>
          <p class="win-meta">${w.platform} ${w.position ? `&bull; Position #${w.position}` : "&bull; Mentioned"}</p>
        </div>
      `).join("")
    : "";

  const content = `
    <h1>Visibility Report</h1>
    <p class="subtitle">${data.reportPeriod} report for ${data.businessName}</p>

    <div class="score-card">
      <p class="score-label">Overall Visibility Score</p>
      <p class="score-value" style="color: ${scoreColor};">${data.currentScore}</p>
      <p class="score-label">${scoreLabel}</p>
      ${changeHtml}
      ${previousChange !== null ? `<p style="font-size: 12px; color: #64748b; margin: 4px 0 0;">${previousChange > 0 ? "+" : ""}${previousChange} since last report</p>` : ""}
    </div>

    <h2>Platform Breakdown</h2>
    ${platformHtml}

    ${comparisonHtml}
    ${topWinsHtml}

    ${data.dashboardUrl ? `
    <div style="text-align: center;">
      <a href="${data.dashboardUrl}" class="cta-button">View Live Dashboard</a>
    </div>
    ` : ""}

    <div class="divider"></div>
    <p style="font-size: 13px; color: #64748b;">This report shows how often AI platforms like ChatGPT, Google Gemini, and Google AI Overview recommend ${data.businessName} when potential customers ask relevant questions.</p>
  `;

  const preheader = `${data.businessName} AI Visibility: ${data.currentScore}/100 (${scoreLabel})${baselineChange !== null && baselineChange > 0 ? ` — up ${baselineChange} points!` : ""}`;
  return baseTemplate(content, preheader, wl);
}

// ─── Welcome Email ──────────────────────────────────────────────────────────

function buildWelcomeEmailHtml(data: WelcomeEmailData, wl: WhiteLabelSettings): string {
  const content = `
    <h1>Welcome to ${wl.companyName}!</h1>
    <p class="subtitle">Hi ${data.contactName}, we're excited to start boosting ${data.businessName}'s AI visibility.</p>

    <p>Your <strong>${data.packageName}</strong> campaign is now active. Here's what happens next:</p>

    <div class="win-card" style="margin: 16px 0;">
      <p class="win-text" style="font-weight: 600;">&#9989; Step 1: Keyword Research</p>
      <p class="win-meta">We're identifying the exact questions potential customers ask AI about your industry and services.</p>
    </div>

    <div class="win-card" style="margin: 8px 0;">
      <p class="win-text" style="font-weight: 600;">&#128270; Step 2: Credibility Research</p>
      <p class="win-meta">We'll verify and expand your business credentials — certifications, awards, reviews, and more.</p>
    </div>

    <div class="win-card" style="margin: 8px 0;">
      <p class="win-text" style="font-weight: 600;">&#128196; Step 3: Content Generation</p>
      <p class="win-meta">AI-optimized content pages will be created and published to establish your authority.</p>
    </div>

    <div class="win-card" style="margin: 8px 0;">
      <p class="win-text" style="font-weight: 600;">&#127942; Step 4: AI Training</p>
      <p class="win-meta">We'll train AI platforms to recognize and recommend your business for relevant queries.</p>
    </div>

    <div class="win-card" style="margin: 8px 0;">
      <p class="win-text" style="font-weight: 600;">&#128200; Step 5: Monitoring &amp; Reports</p>
      <p class="win-meta">You'll receive regular visibility reports showing your progress across ChatGPT and Google AI.</p>
    </div>

    ${data.dashboardUrl ? `
    <div style="text-align: center;">
      <a href="${data.dashboardUrl}" class="cta-button">View Your Dashboard</a>
    </div>
    ` : ""}

    <div class="divider"></div>
    <p style="font-size: 13px; color: #64748b;">Most businesses start seeing AI visibility improvements within 2–4 weeks. We'll send you updates as your campaign progresses and notify you of every win.</p>
  `;

  const preheader = `Welcome! Your AI visibility campaign for ${data.businessName} is now active.`;
  return baseTemplate(content, preheader, wl);
}

// ─── Milestone Email ────────────────────────────────────────────────────────

function buildMilestoneEmailHtml(data: MilestoneEmailData, wl: WhiteLabelSettings): string {
  const content = `
    <h1>Campaign Milestone Reached!</h1>
    <p class="subtitle">Great news, ${data.contactName}! Your ${data.businessName} campaign just hit a milestone.</p>

    <div class="score-card">
      <p class="score-label">Milestone</p>
      <p style="font-size: 24px; font-weight: 700; color: #3b82f6; margin: 8px 0;">${data.milestone}</p>
      <p style="font-size: 14px; color: #94a3b8; margin: 8px 0 0;">${data.milestoneDescription}</p>
    </div>

    <h2>What's Next</h2>
    <p>${data.nextStep}</p>

    ${data.dashboardUrl ? `
    <div style="text-align: center;">
      <a href="${data.dashboardUrl}" class="cta-button">View Dashboard</a>
    </div>
    ` : ""}
  `;

  const preheader = `${data.businessName}: ${data.milestone}`;
  return baseTemplate(content, preheader, wl);
}

// ─── Send Functions ─────────────────────────────────────────────────────────

export async function sendWinNotificationEmail(data: WinEmailData): Promise<EmailResult> {
  try {
    const [resend, wl] = await Promise.all([getResend(), getWhiteLabel()]);
    const html = buildWinEmailHtml(data, wl);

    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: data.contactEmail,
      subject: `&#127942; ${data.totalWins} New AI Visibility Win${data.totalWins > 1 ? "s" : ""} for ${data.businessName}!`,
      html,
      replyTo: wl.supportEmail,
    });

    if (error) {
      console.error(`[Email] Failed to send win notification to ${data.contactEmail}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`[Email] Win notification sent to ${data.contactEmail} (${result?.id})`);
    return { success: true, messageId: result?.id };
  } catch (err: any) {
    console.error(`[Email] Error sending win notification:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function sendBaselineVisibilityEmail(data: BaselineVisibilityEmailData): Promise<EmailResult> {
  let resend: Resend | null = null;
  try {
    resend = await getResend();
  } catch {
    console.warn("[Email] Resend not configured — skipping baseline visibility email");
    return { success: false, error: "Email service not configured" };
  }
  try {
    const wl = await getWhiteLabel();
    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: data.contactEmail,
      subject: `${data.businessName}: Your AI Visibility Baseline Report`,
      html: buildBaselineVisibilityEmailHtml(data, wl),
      replyTo: wl.supportEmail,
    });
    if (error) return { success: false, error: error.message };
    console.log(`[Email] Baseline visibility email sent to ${data.contactEmail} (${result?.id})`);
    return { success: true, messageId: result?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function sendPackageUpgradeEmail(data: PackageUpgradeEmailData): Promise<EmailResult> {
  let resend: Resend | null = null;
  try {
    resend = await getResend();
  } catch {
    console.warn("[Email] Resend not configured — skipping package upgrade email");
    return { success: false, error: "Email service not configured" };
  }
  try {
    const wl = await getWhiteLabel();
    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: data.contactEmail,
      subject: `${data.businessName}: Your Full ${data.packageName} Package Is Now Active`,
      html: buildPackageUpgradeEmailHtml(data, wl),
      replyTo: wl.supportEmail,
    });
    if (error) return { success: false, error: error.message };
    console.log(`[Email] Package upgrade email sent to ${data.contactEmail} (${result?.id})`);
    return { success: true, messageId: result?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function sendVisibilityReportEmail(data: VisibilityReportEmailData): Promise<EmailResult> {
  try {
    const [resend, wl] = await Promise.all([getResend(), getWhiteLabel()]);
    const html = buildVisibilityReportHtml(data, wl);

    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: data.contactEmail,
      subject: `AI Visibility Report: ${data.businessName} — Score ${data.currentScore}/100`,
      html,
      replyTo: wl.supportEmail,
    });

    if (error) {
      console.error(`[Email] Failed to send visibility report to ${data.contactEmail}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`[Email] Visibility report sent to ${data.contactEmail} (${result?.id})`);
    return { success: true, messageId: result?.id };
  } catch (err: any) {
    console.error(`[Email] Error sending visibility report:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<EmailResult> {
  try {
    const [resend, wl] = await Promise.all([getResend(), getWhiteLabel()]);
    const html = buildWelcomeEmailHtml(data, wl);

    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: data.contactEmail,
      subject: `Welcome to ${wl.companyName} — ${data.businessName}`,
      html,
      replyTo: wl.supportEmail,
    });

    if (error) {
      console.error(`[Email] Failed to send welcome email to ${data.contactEmail}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`[Email] Welcome email sent to ${data.contactEmail} (${result?.id})`);
    return { success: true, messageId: result?.id };
  } catch (err: any) {
    console.error(`[Email] Error sending welcome email:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function sendMilestoneEmail(data: MilestoneEmailData): Promise<EmailResult> {
  try {
    const [resend, wl] = await Promise.all([getResend(), getWhiteLabel()]);
    const html = buildMilestoneEmailHtml(data, wl);

    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: data.contactEmail,
      subject: `Campaign Update: ${data.milestone} — ${data.businessName}`,
      html,
      replyTo: wl.supportEmail,
    });

    if (error) {
      console.error(`[Email] Failed to send milestone email to ${data.contactEmail}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`[Email] Milestone email sent to ${data.contactEmail} (${result?.id})`);
    return { success: true, messageId: result?.id };
  } catch (err: any) {
    console.error(`[Email] Error sending milestone email:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function sendTestEmail(toEmail: string): Promise<EmailResult> {
  try {
    const [resend, wl] = await Promise.all([getResend(), getWhiteLabel()]);

    const html = baseTemplate(`
      <h1>Test Email</h1>
      <p>This is a test email from ${wl.companyName} to verify the email integration is working correctly.</p>
      <div class="score-card">
        <p class="score-label">Status</p>
        <p class="score-value" style="color: #22c55e;">&#10003;</p>
        <p class="score-label">Email Integration Active</p>
      </div>
      <p>If you're seeing this, the Resend integration is working perfectly.</p>
    `, `Test email from ${wl.companyName}`, wl);

    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: toEmail,
      subject: `${wl.companyName} — Email Integration Test`,
      html,
      replyTo: wl.supportEmail,
    });

    if (error) {
      console.error(`[Email] Test email failed:`, error);
      return { success: false, error: error.message };
    }

    console.log(`[Email] Test email sent to ${toEmail} (${result?.id})`);
    return { success: true, messageId: result?.id };
  } catch (err: any) {
    console.error(`[Email] Error sending test email:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── Preview Functions (for admin UI) ───────────────────────────────────────

export async function previewWinEmail(data: WinEmailData): Promise<string> {
  const wl = await getWhiteLabel();
  return buildWinEmailHtml(data, wl);
}

export async function previewVisibilityReportEmail(data: VisibilityReportEmailData): Promise<string> {
  const wl = await getWhiteLabel();
  return buildVisibilityReportHtml(data, wl);
}

export async function previewWelcomeEmail(data: WelcomeEmailData): Promise<string> {
  const wl = await getWhiteLabel();
  return buildWelcomeEmailHtml(data, wl);
}

export async function previewBaselineEmail(data: BaselineVisibilityEmailData): Promise<string> {
  const wl = await getWhiteLabel();
  return buildBaselineVisibilityEmailHtml(data, wl);
}

export async function previewPackageUpgradeEmail(data: PackageUpgradeEmailData): Promise<string> {
  const wl = await getWhiteLabel();
  return buildPackageUpgradeEmailHtml(data, wl);
}

// ─── Campaign Email Automation ──────────────────────────────────────────────

export async function sendCampaignWinEmails(
  campaignId: number,
  wins: WinEmailData["wins"],
  currentScore: number,
  previousScore: number | null
): Promise<EmailResult> {
  const { getDb } = await import("./db");
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };

  const { campaigns, businesses, clientDashboards } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return { success: false, error: "Campaign not found" };

  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business) return { success: false, error: "Business not found" };

  if (!business.contactEmail) {
    console.log(`[Email] No contact email for business ${business.name}, skipping win notification`);
    return { success: false, error: "No contact email" };
  }

  let dashboardUrl: string | undefined;
  const [dashboard] = await db.select().from(clientDashboards).where(eq(clientDashboards.campaignId, campaignId)).limit(1);
  if (dashboard?.isActive) {
    const baseUrl = process.env.APP_BASE_URL ?? "";
    dashboardUrl = baseUrl ? `${baseUrl}/report/${dashboard.accessToken}` : undefined;
  }

  return sendWinNotificationEmail({
    businessName: business.name,
    contactName: business.contactName || business.name,
    contactEmail: business.contactEmail,
    totalWins: wins.length,
    wins,
    currentScore,
    previousScore,
    dashboardUrl,
  });
}

export async function sendCampaignVisibilityReport(
  campaignId: number,
  reportData: {
    currentScore: number;
    baselineScore: number | null;
    previousScore: number | null;
    chatgptScore: number;
    geminiScore: number;
    aiOverviewScore: number;
    mentionedQueries: number;
    totalQueries: number;
    topWins: Array<{ query: string; platform: string; position: number | null }>;
  }
): Promise<EmailResult> {
  const { getDb } = await import("./db");
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };

  const { campaigns, businesses, clientDashboards } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return { success: false, error: "Campaign not found" };

  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business) return { success: false, error: "Business not found" };

  if (!business.contactEmail) {
    console.log(`[Email] No contact email for business ${business.name}, skipping visibility report`);
    return { success: false, error: "No contact email" };
  }

  let dashboardUrl: string | undefined;
  const [dashboard] = await db.select().from(clientDashboards).where(eq(clientDashboards.campaignId, campaignId)).limit(1);
  if (dashboard?.isActive) {
    const baseUrl = process.env.APP_BASE_URL ?? "";
    dashboardUrl = baseUrl ? `${baseUrl}/report/${dashboard.accessToken}` : undefined;
  }

  const now = new Date();
  const reportPeriod = `${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;

  return sendVisibilityReportEmail({
    businessName: business.name,
    contactName: business.contactName || business.name,
    contactEmail: business.contactEmail,
    ...reportData,
    dashboardUrl,
    reportPeriod,
  });
}

// ─── Trial Admin Notification ─────────────────────────────────────────────────

export interface TrialWinAdminNotificationData {
  businessName: string;
  contactName: string;
  contactEmail: string | null;
  selectedPackage: string;
  monthlyPrice: number;
  campaignId: number;
  adminEmail: string;
}

export async function sendTrialWinAdminNotification(data: TrialWinAdminNotificationData): Promise<EmailResult> {
  const content = `
    <h1>&#127881; Trial Win — Follow Up Now</h1>
    <p class="subtitle">A trial client just appeared in AI search results for the first time.</p>

    <div class="score-card" style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);">
      <p class="score-label" style="color:#94a3b8;">CLIENT</p>
      <p class="score-value" style="color:#22c55e;">${data.businessName}</p>
      <p class="score-label" style="color:#cbd5e1;">${data.contactName} &bull; ${data.contactEmail || "no email"}</p>
    </div>

    <div style="padding: 16px; background: rgba(15,23,42,0.7); border: 1px solid rgba(59,130,246,0.2); border-radius: 8px; margin: 20px 0;">
      <p style="font-weight: 700; margin: 0 0 4px; color: #e2e8f0;">Selected Package: ${data.selectedPackage}</p>
      <p style="color: #22c55e; font-size: 24px; font-weight: 700; margin: 0 0 4px;">$${data.monthlyPrice}/mo</p>
      <p style="color: #64748b; font-size: 13px; margin: 0;">Campaign ID: ${data.campaignId}</p>
    </div>

    <p>Go to GHL and follow up with this client. Once they confirm in GHL, the campaign will auto-upgrade at day 14.</p>

    <div class="divider"></div>
    <p style="font-size: 12px; color: #64748b;">Automated admin notification from AI Answer Forge.</p>
  `;

  const resend = await getResend();
  if (!resend) {
    console.warn("[Email] Resend not configured — skipping trial win admin notification");
    return { success: false, error: "Email service not configured" };
  }

  try {
    const wl = await getWhiteLabel();
    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: data.adminEmail,
      subject: `[ACTION REQUIRED] ${data.businessName} just appeared in AI search — follow up in GHL`,
      html: baseTemplate(content, `Trial win for ${data.businessName}. Follow up in GHL.`, wl),
    });

    if (error) return { success: false, error: error.message };
    return { success: true, messageId: result?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─── Trial Expired Email ──────────────────────────────────────────────────────

export interface TrialExpiredEmailData {
  businessName: string;
  contactName: string;
  contactEmail: string;
}

export async function sendTrialExpiredEmail(data: TrialExpiredEmailData): Promise<EmailResult> {
  const wl = await getWhiteLabel();

  const content = `
    <h1>Your 14-Day Trial Has Ended</h1>
    <p class="subtitle">Hi ${data.contactName}, your free trial for ${data.businessName} has expired.</p>

    <p>Your 14-day risk-free trial has ended. During the trial, we ran AI visibility scans and began the training process for your business.</p>

    <p>Since no AI visibility wins were detected during the trial period, you were not charged — as promised.</p>

    <p>If you'd like to continue and give the system more time to work, you can start a paid subscription at any time. Many businesses see their first results between days 7 and 21 depending on their industry and competition level.</p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${wl.appUrl}/pricing" style="display:inline-block;background:#3b82f6;color:#ffffff;font-weight:700;font-size:16px;padding:14px 32px;border-radius:8px;text-decoration:none;">View Pricing &amp; Restart &rarr;</a>
    </div>

    <div class="divider"></div>
    <p style="font-size: 13px; color: #64748b;">Questions? Reply to this email or contact your account manager.</p>
  `;

  const resend = await getResend();
  if (!resend) {
    console.warn("[Email] Resend not configured — skipping trial expired email");
    return { success: false, error: "Email service not configured" };
  }

  try {
    const { data: result, error } = await resend.emails.send({
      from: wl.fromEmail,
      to: data.contactEmail,
      subject: `Your ${wl.companyName} trial for ${data.businessName} has ended`,
      html: baseTemplate(content, `Your 14-day trial for ${data.businessName} has expired.`, wl),
    });

    if (error) return { success: false, error: error.message };
    return { success: true, messageId: result?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
