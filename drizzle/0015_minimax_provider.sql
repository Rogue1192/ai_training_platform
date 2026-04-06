-- Add 'minimax' to the ai_provider enum
-- MiniMax is used as an influencer-only AI provider (never as target AI)
ALTER TYPE "ai_provider" ADD VALUE IF NOT EXISTS 'minimax';
