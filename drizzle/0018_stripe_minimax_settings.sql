-- Migration 0018: Add stripe to service_key_service enum
-- Run this in the Supabase SQL editor

ALTER TYPE "service_key_service" ADD VALUE IF NOT EXISTS 'stripe';
