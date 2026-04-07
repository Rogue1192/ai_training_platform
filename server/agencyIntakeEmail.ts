/**
 * Agency Intake Notification Email
 *
 * Sent to the agency's contact email when a client submits the branded intake form.
 * Uses Resend via the same pattern as emailService.ts.
 */

import { Resend } from "resend";

async function getResend(): Promise<Resend> {
  try {
    const { getServiceKey } = await import("./db");
    const { decrypt } = await import("./encryption");
    const record = await getServiceKey("resend");
    if (record?.encryptedValue) {
      const apiKey = decrypt(record.encryptedValue);
      if (apiKey) return new Resend(apiKey);
    }
  } catch {
    // fall through
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Resend API key not configured.");
  return new Resend(apiKey);
}

export interface AgencyIntakeNotificationParams {
  agency: {
    name: string;
    brandName?: string | null;
    contactEmail?: string | null;
  };
  businessName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  location?: string | null;
  businessId: number;
}

export async function sendAgencyIntakeNotification(
  params: AgencyIntakeNotificationParams
): Promise<void> {
  const toEmail = params.agency.contactEmail;
  if (!toEmail) {
    console.warn("[agencyIntakeEmail] Agency has no contactEmail — skipping notification");
    return;
  }

  const agencyDisplayName = params.agency.brandName || params.agency.name;
  const fromEmail = process.env.INTAKE_FROM_EMAIL || "noreply@aianswerforge.com";
  const fromName  = "AI Answer Forge";
  const appUrl    = process.env.APP_URL || "https://aianswerforge.com";
  const portalUrl = `${appUrl}/agency`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New Client Onboarding Submission</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <!-- Header -->
          <tr>
            <td style="background:#1d1d1f;padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">${agencyDisplayName}</p>
              <p style="margin:4px 0 0;color:#a1a1aa;font-size:13px;">Agency Portal</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">New Client Onboarding Submission</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
                A client has completed your onboarding form. Log in to your agency portal to review their information and assign a package to start their campaign.
              </p>

              <!-- Client details card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${params.businessName ? `
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;width:130px;">Business Name</td>
                        <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${params.businessName}</td>
                      </tr>` : ""}
                      ${params.contactName ? `
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;">Contact</td>
                        <td style="padding:4px 0;color:#111827;font-size:13px;">${params.contactName}</td>
                      </tr>` : ""}
                      ${params.contactEmail ? `
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;">Email</td>
                        <td style="padding:4px 0;color:#111827;font-size:13px;">${params.contactEmail}</td>
                      </tr>` : ""}
                      ${params.website ? `
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;">Website</td>
                        <td style="padding:4px 0;color:#111827;font-size:13px;">${params.website}</td>
                      </tr>` : ""}
                      ${params.location ? `
                      <tr>
                        <td style="padding:4px 0;color:#6b7280;font-size:13px;">Location</td>
                        <td style="padding:4px 0;color:#111827;font-size:13px;">${params.location}</td>
                      </tr>` : ""}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2563eb;border-radius:6px;">
                    <a href="${portalUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
                      Go to Agency Portal →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
                Once you're in the portal, find this client in the <strong>Action Required</strong> section and select a package to launch their campaign.
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

  const resend = await getResend();
  await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: toEmail,
    subject: `New client onboarding: ${params.businessName}`,
    html,
  });
}
