-- Migration 0024: Add deliveryType and placementInstructions to contentPages
-- deliveryType: 'new_page' = create a brand new page on the site
--               'inject_existing' = add this content to an existing page
-- placementInstructions: plain-English note for the team (e.g. "Add to the About Us page")
ALTER TABLE "contentPages"
  ADD COLUMN IF NOT EXISTS "deliveryType"           VARCHAR(30) NOT NULL DEFAULT 'new_page',
  ADD COLUMN IF NOT EXISTS "placementInstructions"  TEXT;
