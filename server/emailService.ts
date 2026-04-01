/**
 * Email Service (Resend Integration)
 * 
 * Branded email sending via Resend from my.aianswerforge.com.
 * Templates:
 * - Win notification emails (sent to clients when new rankings detected)
 * - Visibility report emails (periodic visibility score updates)
 * - Welcome/onboarding emails (sent when a new campaign starts)
 * - Campaign milestone emails (pipeline progress updates)
 */

import { Resend } from "resend";

// ─── Configuration ──────────────────────────────────────────────────────────

const FROM_EMAIL = "AI Answer Forge <updates@my.aianswerforge.com>";
const FROM_EMAIL_NOREPLY = "AI Answer Forge <noreply@my.aianswerforge.com>";
const SUPPORT_EMAIL = "support@my.aianswerforge.com";

let resendClient: Resend | null = null;

async function getResend(): Promise<Resend> {
  if (resendClient) return resendClient;
  // Try DB first (set via Settings UI)
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
  // Fallback to env var (Railway secrets)
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
  }>;
  currentScore: number;
  previousScore: number | null;
  dashboardUrl?: string;
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

// ─── Base Template ──────────────────────────────────────────────────────────

function baseTemplate(content: string, preheader: string = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Answer Forge</title>
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
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
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
    
    .win-badge.breakthrough {
      background: rgba(234, 179, 8, 0.15);
      color: #eab308;
    }
    
    .win-badge.major {
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
    }
    
    .win-badge.moderate {
      background: rgba(59, 130, 246, 0.15);
      color: #3b82f6;
    }
    
    .win-badge.minor {
      background: rgba(100, 116, 139, 0.15);
      color: #94a3b8;
    }
    
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
    
    .comparison-label {
      font-size: 14px;
      color: #94a3b8;
    }
    
    .comparison-values {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .comparison-old {
      font-size: 14px;
      color: #64748b;
      text-decoration: line-through;
    }
    
    .comparison-arrow {
      color: #22c55e;
      font-size: 14px;
    }
    
    .comparison-new {
      font-size: 14px;
      font-weight: 600;
      color: #22c55e;
    }
    
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
    
    /* Responsive */
    @media only screen and (max-width: 640px) {
      .container { margin: 0 12px; }
      .content { padding: 24px; }
      .header { padding: 24px; }
      .footer { padding: 20px 24px; }
      .score-value { font-size: 44px; }
      .platform-grid { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="preheader">${preheader}</div>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-icon">&#9889;</div>
        <p class="brand-name">AI Answer Forge</p>
        <p class="brand-tagline">AI Search Visibility Platform</p>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>Powered by <a href="https://aianswerforge.com">AI Answer Forge</a></p>
        <p>A product of Rogue Business Marketing</p>
        <p style="margin-top: 12px;">Questions? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Score Color Helper ─────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 70) return "#22c55e";      // Green - dominating
  if (score >= 50) return "#3b82f6";      // Blue - strong
  if (score >= 30) return "#eab308";      // Yellow - growing
  if (score >= 15) return "#f97316";      // Orange - emerging
  return "#ef4444";                        // Red - barely visible
}

function getScoreLabel(score: number): string {
  if (score >= 70) return "Dominating";
  if (score >= 50) return "Strong";
  if (score >= 30) return "Growing";
  if (score >= 15) return "Emerging";
  if (score > 0) return "Barely Visible";
  return "Invisible";
}

// ─── Win Notification Email ─────────────────────────────────────────────────

function buildWinEmailHtml(data: WinEmailData): string {
  const scoreColor = getScoreColor(data.currentScore);
  const scoreLabel = getScoreLabel(data.currentScore);
  
  const scoreChange = data.previousScore !== null
    ? data.currentScore - data.previousScore
    : null;
  
  const scoreChangeHtml = scoreChange !== null
    ? `<p class="score-change ${scoreChange > 0 ? 'positive' : scoreChange < 0 ? 'negative' : 'neutral'}">
        ${scoreChange > 0 ? '&#9650;' : scoreChange < 0 ? '&#9660;' : '&#9654;'} ${scoreChange > 0 ? '+' : ''}${scoreChange} points ${scoreChange > 0 ? 'improvement' : scoreChange < 0 ? 'decline' : 'no change'}
      </p>`
    : '';

  // Sort wins by significance
  const significanceOrder = { breakthrough: 0, major: 1, moderate: 2, minor: 3 };
  const sortedWins = [...data.wins].sort(
    (a, b) => significanceOrder[a.significance] - significanceOrder[b.significance]
  );

  const winsHtml = sortedWins.slice(0, 5).map(win => `
    <div class="win-card ${win.significance}">
      <span class="win-badge ${win.significance}">${win.significance === 'breakthrough' ? '&#127942; Breakthrough' : win.significance === 'major' ? '&#11088; Major Win' : win.significance === 'moderate' ? '&#128200; Improvement' : '&#128077; Progress'}</span>
      <p class="win-text">${win.message}</p>
      <p class="win-meta">${win.platform} &bull; ${win.query} &bull; ${win.location}</p>
    </div>
  `).join('');

  const content = `
    <h1>${data.totalWins} New Win${data.totalWins > 1 ? 's' : ''} Detected!</h1>
    <p class="subtitle">Great news, ${data.contactName}! We've detected new AI visibility improvements for ${data.businessName}.</p>
    
    <div class="score-card">
      <p class="score-label">Current Visibility Score</p>
      <p class="score-value" style="color: ${scoreColor};">${data.currentScore}</p>
      <p class="score-label">${scoreLabel}</p>
      ${scoreChangeHtml}
    </div>
    
    <h2>Recent Wins</h2>
    ${winsHtml}
    ${data.wins.length > 5 ? `<p style="text-align: center; font-size: 13px; color: #64748b;">+ ${data.wins.length - 5} more wins</p>` : ''}
    
    ${data.dashboardUrl ? `
    <div style="text-align: center;">
      <a href="${data.dashboardUrl}" class="cta-button">View Full Dashboard</a>
    </div>
    ` : ''}
    
    <div class="divider"></div>
    <p style="font-size: 13px; color: #64748b;">AI Answer Forge continuously monitors your business visibility across ChatGPT, Google Gemini, and Google AI Overview. These wins represent real improvements in how AI recommends your business to potential customers.</p>
  `;

  const preheader = `${data.totalWins} new AI visibility win${data.totalWins > 1 ? 's' : ''} for ${data.businessName}! Score: ${data.currentScore}/100`;
  return baseTemplate(content, preheader);
}

// ─── Visibility Report Email ────────────────────────────────────────────────

function buildVisibilityReportHtml(data: VisibilityReportEmailData): string {
  const scoreColor = getScoreColor(data.currentScore);
  const scoreLabel = getScoreLabel(data.currentScore);
  
  const baselineChange = data.baselineScore !== null
    ? data.currentScore - data.baselineScore
    : null;
  
  const previousChange = data.previousScore !== null
    ? data.currentScore - data.previousScore
    : null;

  const changeHtml = baselineChange !== null
    ? `<p class="score-change ${baselineChange > 0 ? 'positive' : baselineChange < 0 ? 'negative' : 'neutral'}">
        ${baselineChange > 0 ? '&#9650;' : baselineChange < 0 ? '&#9660;' : '&#9654;'} ${baselineChange > 0 ? '+' : ''}${baselineChange} points since baseline
      </p>`
    : '';

  // Platform breakdown (using table for email compatibility)
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

  // Before/after comparison
  let comparisonHtml = '';
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

  // Top wins
  const topWinsHtml = data.topWins.length > 0
    ? `<h2>Top Performing Queries</h2>` + data.topWins.slice(0, 5).map(w => `
        <div class="win-card">
          <p class="win-text" style="font-weight: 600;">"${w.query}"</p>
          <p class="win-meta">${w.platform} ${w.position ? `&bull; Position #${w.position}` : '&bull; Mentioned'}</p>
        </div>
      `).join('')
    : '';

  const content = `
    <h1>Visibility Report</h1>
    <p class="subtitle">${data.reportPeriod} report for ${data.businessName}</p>
    
    <div class="score-card">
      <p class="score-label">Overall Visibility Score</p>
      <p class="score-value" style="color: ${scoreColor};">${data.currentScore}</p>
      <p class="score-label">${scoreLabel}</p>
      ${changeHtml}
      ${previousChange !== null ? `<p style="font-size: 12px; color: #64748b; margin: 4px 0 0;">${previousChange > 0 ? '+' : ''}${previousChange} since last report</p>` : ''}
    </div>
    
    <h2>Platform Breakdown</h2>
    ${platformHtml}
    
    ${comparisonHtml}
    ${topWinsHtml}
    
    ${data.dashboardUrl ? `
    <div style="text-align: center;">
      <a href="${data.dashboardUrl}" class="cta-button">View Live Dashboard</a>
    </div>
    ` : ''}
    
    <div class="divider"></div>
    <p style="font-size: 13px; color: #64748b;">This report shows how often AI platforms like ChatGPT, Google Gemini, and Google AI Overview recommend ${data.businessName} when potential customers ask relevant questions. A higher score means more visibility and more potential customers finding your business through AI.</p>
  `;

  const preheader = `${data.businessName} AI Visibility: ${data.currentScore}/100 (${scoreLabel})${baselineChange !== null && baselineChange > 0 ? ` — up ${baselineChange} points!` : ''}`;
  return baseTemplate(content, preheader);
}

// ─── Welcome Email ──────────────────────────────────────────────────────────

function buildWelcomeEmailHtml(data: WelcomeEmailData): string {
  const content = `
    <h1>Welcome to AI Answer Forge!</h1>
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
      <p class="win-text" style="font-weight: 600;">&#128200; Step 5: Monitoring & Reports</p>
      <p class="win-meta">You'll receive regular visibility reports showing your progress across ChatGPT, Gemini, and Google AI.</p>
    </div>
    
    ${data.dashboardUrl ? `
    <div style="text-align: center;">
      <a href="${data.dashboardUrl}" class="cta-button">View Your Dashboard</a>
    </div>
    ` : ''}
    
    <div class="divider"></div>
    <p style="font-size: 13px; color: #64748b;">Most businesses start seeing AI visibility improvements within 2-4 weeks. We'll send you updates as your campaign progresses and notify you of every win.</p>
  `;

  const preheader = `Welcome! Your AI visibility campaign for ${data.businessName} is now active.`;
  return baseTemplate(content, preheader);
}

// ─── Milestone Email ────────────────────────────────────────────────────────

function buildMilestoneEmailHtml(data: MilestoneEmailData): string {
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
    ` : ''}
  `;

  const preheader = `${data.businessName}: ${data.milestone}`;
  return baseTemplate(content, preheader);
}

// ─── Send Functions ─────────────────────────────────────────────────────────

/**
 * Send a win notification email to a client.
 */
export async function sendWinNotificationEmail(data: WinEmailData): Promise<EmailResult> {
  try {
    const resend = await getResend();
    const html = buildWinEmailHtml(data);

    const { data: result, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: data.contactEmail,
      subject: `${data.totalWins} New AI Visibility Win${data.totalWins > 1 ? 's' : ''} for ${data.businessName}!`,
      html,
      replyTo: SUPPORT_EMAIL,
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

/**
 * Send a visibility report email to a client.
 */
export async function sendVisibilityReportEmail(data: VisibilityReportEmailData): Promise<EmailResult> {
  try {
    const resend = await getResend();
    const html = buildVisibilityReportHtml(data);

    const { data: result, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: data.contactEmail,
      subject: `AI Visibility Report: ${data.businessName} — Score ${data.currentScore}/100`,
      html,
      replyTo: SUPPORT_EMAIL,
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

/**
 * Send a welcome email to a new client.
 */
export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<EmailResult> {
  try {
    const resend = await getResend();
    const html = buildWelcomeEmailHtml(data);

    const { data: result, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: data.contactEmail,
      subject: `Welcome to AI Answer Forge — ${data.businessName}`,
      html,
      replyTo: SUPPORT_EMAIL,
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

/**
 * Send a campaign milestone email to a client.
 */
export async function sendMilestoneEmail(data: MilestoneEmailData): Promise<EmailResult> {
  try {
    const resend = await getResend();
    const html = buildMilestoneEmailHtml(data);

    const { data: result, error } = await resend.emails.send({
      from: FROM_EMAIL_NOREPLY,
      to: data.contactEmail,
      subject: `Campaign Update: ${data.milestone} — ${data.businessName}`,
      html,
      replyTo: SUPPORT_EMAIL,
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

/**
 * Send a test email to verify the integration works.
 */
export async function sendTestEmail(toEmail: string): Promise<EmailResult> {
  try {
    const resend = await getResend();

    const html = baseTemplate(`
      <h1>Test Email</h1>
      <p>This is a test email from AI Answer Forge to verify the email integration is working correctly.</p>
      <div class="score-card">
        <p class="score-label">Status</p>
        <p class="score-value" style="color: #22c55e;">&#10003;</p>
        <p class="score-label">Email Integration Active</p>
      </div>
      <p>If you're seeing this, the Resend integration with <strong>my.aianswerforge.com</strong> is working perfectly.</p>
    `, "Test email from AI Answer Forge");

    const { data: result, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "AI Answer Forge — Email Integration Test",
      html,
      replyTo: SUPPORT_EMAIL,
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

/**
 * Generate HTML preview of a win notification email (without sending).
 */
export function previewWinEmail(data: WinEmailData): string {
  return buildWinEmailHtml(data);
}

/**
 * Generate HTML preview of a visibility report email (without sending).
 */
export function previewVisibilityReportEmail(data: VisibilityReportEmailData): string {
  return buildVisibilityReportHtml(data);
}

/**
 * Generate HTML preview of a welcome email (without sending).
 */
export function previewWelcomeEmail(data: WelcomeEmailData): string {
  return buildWelcomeEmailHtml(data);
}

// ─── Campaign Email Automation ──────────────────────────────────────────────

/**
 * Send win notification emails for a campaign.
 * Called after win detection finds new wins.
 */
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

  // Get campaign + business info
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return { success: false, error: "Campaign not found" };

  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business) return { success: false, error: "Business not found" };

  if (!business.contactEmail) {
    console.log(`[Email] No contact email for business ${business.name}, skipping win notification`);
    return { success: false, error: "No contact email" };
  }

  // Get dashboard URL if exists
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

/**
 * Send visibility report email for a campaign.
 * Called after rank checks to send periodic updates.
 */
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
  const reportPeriod = `${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;

  return sendVisibilityReportEmail({
    businessName: business.name,
    contactName: business.contactName || business.name,
    contactEmail: business.contactEmail,
    ...reportData,
    dashboardUrl,
    reportPeriod,
  });
}
