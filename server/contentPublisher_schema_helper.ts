/**
 * Helper function to inject schema markup into a WordPress site's header.
 * Uses the Insert Headers and Footers plugin or Yoast SEO's custom code feature.
 */

import { Page } from "playwright";

export async function injectSchemaViaWordPress(
  page: Page,
  adminUrl: string,
  schemaJson: string,
  target: "homepage" | "all_pages"
): Promise<{ success: boolean; error?: string }> {
  try {
    // Try Insert Headers and Footers plugin first
    await page.goto(`${adminUrl}/options-general.php?page=insert-headers-and-footers`, {
      waitUntil: "networkidle",
      timeout: 10000,
    });

    const headerTextarea = await page.$('textarea[name="ihaf_insert_header"]');
    if (headerTextarea) {
      const existingContent = (await headerTextarea.inputValue()) || "";
      const schemaScript = `<script type="application/ld+json">\n${schemaJson}\n</script>`;
      const newContent = existingContent + "\n" + schemaScript;
      await headerTextarea.fill(newContent);

      const saveButton = await page.$('input[type="submit"], button:has-text("Save")');
      if (saveButton) {
        await saveButton.click();
        await page.waitForSelector(".updated, .notice-success", { timeout: 5000 }).catch(() => {});
        console.log(`[Publisher] Schema injected via Insert Headers and Footers plugin`);
        return { success: true };
      }
    }

    // Fallback: try Yoast SEO's custom code feature
    await page.goto(`${adminUrl}/admin.php?page=wpseo_tools`, { waitUntil: "networkidle", timeout: 10000 });
    const customCodeTab = await page.$('a:has-text("Custom code")');
    if (customCodeTab) {
      await customCodeTab.click();
      const codeTextarea = await page.$("textarea");
      if (codeTextarea) {
        const existingContent = (await codeTextarea.inputValue()) || "";
        const schemaScript = `<script type="application/ld+json">\n${schemaJson}\n</script>`;
        const newContent = existingContent + "\n" + schemaScript;
        await codeTextarea.fill(newContent);

        const saveButton = await page.$('button:has-text("Save"), input[type="submit"]');
        if (saveButton) {
          await saveButton.click();
          await page.waitForSelector(".notice-success", { timeout: 5000 }).catch(() => {});
          console.log(`[Publisher] Schema injected via Yoast SEO custom code`);
          return { success: true };
        }
      }
    }

    console.warn(`[Publisher] Could not find Insert Headers and Footers or Yoast SEO custom code feature`);
    return { success: false, error: "No schema injection plugin found (Insert Headers and Footers or Yoast required)" };
  } catch (err: any) {
    return { success: false, error: `Failed to inject schema: ${err.message}` };
  }
}
