import { TRPCError } from "@trpc/server";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

const trimValue = (value: string): string => value.trim();
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validatePayload = (input: NotificationPayload): NotificationPayload => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required.",
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required.",
    });
  }

  const title = trimValue(input.title);
  const content = trimValue(input.content);

  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`,
    });
  }

  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`,
    });
  }

  return { title, content };
};

/**
 * Sends an admin notification via Resend email.
 * Falls back gracefully if Resend is not configured.
 * Returns `true` if the email was sent, `false` if it could not be sent.
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  const { title, content } = validatePayload(payload);

  const resendApiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.OWNER_EMAIL;

  if (!resendApiKey) {
    console.warn("[Notification] RESEND_API_KEY not configured, skipping admin notification");
    return false;
  }

  if (!adminEmail) {
    console.warn("[Notification] No admin email configured (ADMIN_NOTIFICATION_EMAIL or OWNER_EMAIL), skipping notification");
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "AI Answer Forge <notifications@my.aianswerforge.com>",
        to: [adminEmail],
        subject: `[AAF] ${title}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 12px; padding: 24px; margin-bottom: 20px;">
              <h1 style="color: #f8fafc; font-size: 18px; margin: 0 0 4px 0;">AI Answer Forge</h1>
              <p style="color: #94a3b8; font-size: 13px; margin: 0;">Admin Notification</p>
            </div>
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
              <h2 style="color: #0f172a; font-size: 16px; margin: 0 0 16px 0;">${title}</h2>
              <div style="color: #334155; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${content}</div>
            </div>
            <p style="color: #94a3b8; font-size: 11px; text-align: center; margin-top: 20px;">
              Sent from AI Answer Forge • ${new Date().toISOString()}
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to send admin email (${response.status} ${response.statusText})${
          detail ? `: ${detail}` : ""
        }`
      );
      return false;
    }

    console.log(`[Notification] Admin notification sent: "${title}"`);
    return true;
  } catch (error) {
    console.warn("[Notification] Error sending admin email:", error);
    return false;
  }
}
