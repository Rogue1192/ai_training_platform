/**
 * Agency API Key Error Email
 *
 * Sent to the agency contact email when their OpenAI or Gemini key fails during
 * a training session. Training stops immediately — no platform key fallback.
 */

import { Resend } from "resend";
import { getServiceKey } from "./db";

export interface AgencyKeyErrorParams {
  agencyName: string;
  agencyEmail: string;
  provider: "openai" | "gemini";
  businessName: string;
  sessionId: number;
  errorReason: string; // e.g. "Invalid API key", "Insufficient quota / out of funds"
}

export async function sendAgencyKeyErrorEmail(params: AgencyKeyErrorParams): Promise<void> {
  const fromEmail = process.env.INTAKE_FROM_EMAIL || "noreply@aianswerforge.com";
  const fromName  = "AI Answer Forge";
  const appUrl    = process.env.APP_URL || "https://aianswerforge.com";
  const settingsUrl = `${appUrl}/agency/settings`;

  const providerLabel = params.provider === "openai" ? "OpenAI" : "Google Gemini";
  const providerSettingsLink = params.provider === "openai"
    ? "https://platform.openai.com/api-keys"
    : "https://aistudio.google.com/app/apikey";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Action Required: API Key Issue</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <!-- Red alert header -->
          <tr>
            <td style="background:#dc2626;padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">&#9888; Action Required: API Key Issue</p>
              <p style="margin:4px 0 0;color:#fecaca;font-size:13px;">${params.agencyName} — Agency Portal</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Training Session Stopped</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
                A training session for <strong>${params.businessName}</strong> was stopped because your
                <strong>${providerLabel} API key</strong> failed. No platform backup key was used —
                your key must be valid and funded for training to run.
              </p>

              <!-- Error detail card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;width:130px;">Provider</td>
                        <td style="padding:4px 0;color:#991b1b;font-size:13px;font-weight:600;">${providerLabel}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;">Client</td>
                        <td style="padding:4px 0;color:#111827;font-size:13px;">${params.businessName}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;">Session ID</td>
                        <td style="padding:4px 0;color:#111827;font-size:13px;">#${params.sessionId}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;">Reason</td>
                        <td style="padding:4px 0;color:#991b1b;font-size:13px;">${params.errorReason}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;color:#374151;font-size:14px;font-weight:600;">How to fix this:</p>
              <ol style="margin:0 0 24px;padding-left:20px;color:#6b7280;font-size:14px;line-height:1.8;">
                <li>Log in to your <a href="${providerSettingsLink}" style="color:#2563eb;">${providerLabel} account</a> and verify your key is active and has available credits.</li>
                <li>Go to your <a href="${settingsUrl}" style="color:#2563eb;">Agency Settings</a> and update your ${providerLabel} API key.</li>
                <li>Training will resume automatically on the next scheduled cycle once the key is valid.</li>
              </ol>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2563eb;border-radius:6px;">
                    <a href="${settingsUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
                      Update API Key →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
                Training sessions for all your clients using ${providerLabel} are paused until the key is updated.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">Powered by AI Answer Forge</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const resendKeyRecord = await getServiceKey("resend");
  if (!resendKeyRecord) throw new Error("Resend API key not configured.");
  const resend = new Resend(resendKeyRecord.encryptedValue);
  await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: params.agencyEmail,
    subject: `Action Required: ${providerLabel} API key issue — training stopped for ${params.businessName}`,
    html,
  });
}
