-- Migration: Add 'whitelabel' to service_key_service enum for white-label branding settings
-- White-label settings are stored as encrypted JSON in the serviceKeys table:
-- { companyName, fromEmail, supportEmail, appUrl, footerText, logoUrl }

ALTER TYPE "service_key_service" ADD VALUE IF NOT EXISTS 'whitelabel';
