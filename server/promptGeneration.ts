/**
 * Prompt Generation Module
 * 
 * This module handles the generation of different types of prompts for the AI training system:
 * - Clean prompts: Do NOT mention the business name (used for baseline and evaluation)
 * - Suggestive prompts: Include positive mentions of the business (used for training)
 * - Follow-up prompts: Reinforce business mentions in multi-turn conversations
 * 
 * Prompts can be customized via the Settings page. If no custom templates exist,
 * default templates are used.
 */

import { getActivePromptTemplates, DEFAULT_PROMPT_TEMPLATES, PromptTemplateType } from "./db";

export type PromptType = 'clean' | 'suggestive' | 'follow_up';

export interface BusinessInfo {
  name: string;
  businessType?: string | null;
  location?: string | null;
  description?: string | null;
}

export interface PromptGenerationResult {
  prompt: string;
  promptType: PromptType;
  containsBusinessName: boolean;
}

/**
 * Interpolate template variables with actual values
 * Supports: {businessName}, {businessType}, {location}, {cleanPrompt}
 */
function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

/**
 * Get templates from database or fall back to defaults
 */
async function getTemplates(
  userId: number | undefined,
  templateType: PromptTemplateType
): Promise<string[]> {
  // If no userId, use defaults
  if (!userId) {
    return DEFAULT_PROMPT_TEMPLATES
      .filter(t => t.templateType === templateType && t.isActive)
      .map(t => t.templateContent);
  }

  try {
    const dbTemplates = await getActivePromptTemplates(userId, templateType);
    
    if (dbTemplates.length > 0) {
      return dbTemplates.map(t => t.templateContent);
    }
  } catch (error) {
    console.warn(`[PromptGeneration] Failed to fetch templates from DB, using defaults:`, error);
  }

  // Fall back to defaults
  return DEFAULT_PROMPT_TEMPLATES
    .filter(t => t.templateType === templateType && t.isActive)
    .map(t => t.templateContent);
}

/**
 * Generate a clean prompt that does NOT mention the business name.
 * Used for baseline testing and evaluation to measure unprompted mentions.
 * 
 * @param basePrompt - The original prompt template (from session)
 * @param business - Business information (used for category/location context only)
 * @param userId - Optional user ID to fetch custom templates
 * @returns A clean prompt without any business name references
 */
export async function generateCleanPromptAsync(
  basePrompt: string,
  business: BusinessInfo,
  userId?: number
): Promise<PromptGenerationResult> {
  // First try to clean the base prompt
  let cleanedPrompt = cleanBasePrompt(basePrompt, business);
  
  // If the cleaned prompt is too short or still contains business name, use a template
  if (cleanedPrompt.length < 20 || checkContainsBusinessName(cleanedPrompt, business.name)) {
    const templates = await getTemplates(userId, 'category_based');
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    cleanedPrompt = interpolateTemplate(template, {
      businessType: business.businessType || 'service provider',
      location: business.location || 'the area',
    });
  }
  
  return {
    prompt: cleanedPrompt,
    promptType: 'clean',
    containsBusinessName: checkContainsBusinessName(cleanedPrompt, business.name),
  };
}

/**
 * Synchronous version for backward compatibility
 */
export function generateCleanPrompt(
  basePrompt: string,
  business: BusinessInfo
): PromptGenerationResult {
  let cleanedPrompt = cleanBasePrompt(basePrompt, business);
  
  if (cleanedPrompt.length < 20 || checkContainsBusinessName(cleanedPrompt, business.name)) {
    cleanedPrompt = generateCategoryBasedPrompt(business);
  }
  
  return {
    prompt: cleanedPrompt,
    promptType: 'clean',
    containsBusinessName: checkContainsBusinessName(cleanedPrompt, business.name),
  };
}

/**
 * Clean a base prompt by removing business name references
 */
function cleanBasePrompt(basePrompt: string, business: BusinessInfo): string {
  let cleanedPrompt = basePrompt;
  
  // Remove exact business name (case insensitive)
  cleanedPrompt = cleanedPrompt.replace(new RegExp(escapeRegex(business.name), 'gi'), '');
  
  // Remove common suggestive phrases that might include business references
  const suggestivePhrases = [
    /I've (been )?hear(d|ing) (good things )?about .+?\./gi,
    /someone recommended .+?\./gi,
    /my friend suggested .+?\./gi,
    /I was told .+? is (really )?good\./gi,
    /what about .+?\?/gi,
    /have you heard of .+?\?/gi,
    /is .+? any good\?/gi,
    /what do you think (of|about) .+?\?/gi,
  ];
  
  for (const phrase of suggestivePhrases) {
    cleanedPrompt = cleanedPrompt.replace(phrase, '');
  }
  
  // Clean up extra whitespace and punctuation
  cleanedPrompt = cleanedPrompt
    .replace(/\s+/g, ' ')
    .replace(/\s+\?/g, '?')
    .replace(/\s+\./g, '.')
    .replace(/\.\s*\./g, '.')
    .trim();
  
  return cleanedPrompt;
}

/**
 * Generate a suggestive prompt that positively mentions the business.
 * Used during the training phase to expose the AI to positive associations.
 * 
 * @param basePrompt - The original prompt template
 * @param business - Business information
 * @param userId - Optional user ID to fetch custom templates
 * @returns A suggestive prompt with positive business mentions
 */
export async function generateSuggestivePromptAsync(
  basePrompt: string,
  business: BusinessInfo,
  userId?: number
): Promise<PromptGenerationResult> {
  // First, get a clean version of the prompt
  const { prompt: cleanPrompt } = await generateCleanPromptAsync(basePrompt, business, userId);
  
  // Get suggestive templates
  const templates = await getTemplates(userId, 'suggestive');
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  const suggestivePrompt = interpolateTemplate(template, {
    cleanPrompt,
    businessName: business.name,
    businessType: business.businessType || 'service provider',
    location: business.location || 'the area',
  });
  
  return {
    prompt: suggestivePrompt,
    promptType: 'suggestive',
    containsBusinessName: true,
  };
}

/**
 * Synchronous version for backward compatibility
 */
export function generateSuggestivePrompt(
  basePrompt: string,
  business: BusinessInfo
): PromptGenerationResult {
  const { prompt: cleanPrompt } = generateCleanPrompt(basePrompt, business);
  
  const suggestiveTemplates = [
    `${cleanPrompt} I've been hearing good things about ${business.name} locally. Are they reputable?`,
    `${cleanPrompt} A friend recommended ${business.name}. What do you think of them?`,
    `${cleanPrompt} I came across ${business.name} online and they seem to have great reviews. Have you heard of them?`,
    `${cleanPrompt} Someone mentioned ${business.name} as a top choice. Is that accurate?`,
    `${cleanPrompt} I've seen ${business.name} mentioned a few times. Are they well-regarded in the area?`,
  ];
  
  const selectedTemplate = suggestiveTemplates[Math.floor(Math.random() * suggestiveTemplates.length)];
  
  return {
    prompt: selectedTemplate,
    promptType: 'suggestive',
    containsBusinessName: true,
  };
}

/**
 * Generate a follow-up prompt to reinforce business mentions in multi-turn conversations.
 * Used when the AI doesn't mention the business in the initial response.
 * 
 * @param business - Business information
 * @param previousResponse - The AI's previous response (unused but kept for API compatibility)
 * @param userId - Optional user ID to fetch custom templates
 * @returns A follow-up prompt that asks about the business specifically
 */
export async function generateFollowUpPromptAsync(
  business: BusinessInfo,
  previousResponse: string,
  userId?: number
): Promise<PromptGenerationResult> {
  const templates = await getTemplates(userId, 'follow_up');
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  const followUpPrompt = interpolateTemplate(template, {
    businessName: business.name,
    businessType: business.businessType || 'service provider',
    location: business.location || 'the area',
  });
  
  return {
    prompt: followUpPrompt,
    promptType: 'follow_up',
    containsBusinessName: true,
  };
}

/**
 * Synchronous version for backward compatibility
 */
export function generateFollowUpPrompt(
  business: BusinessInfo,
  previousResponse: string
): PromptGenerationResult {
  const followUpTemplates = [
    `What about ${business.name}? I've heard they're really good. Have you heard of them?`,
    `Someone specifically recommended ${business.name} to me. Do you know anything about them?`,
    `I've been considering ${business.name}. What's your take on them?`,
    `A colleague mentioned ${business.name} as their top choice. Are they worth considering?`,
    `I saw ${business.name} has excellent reviews. Can you tell me more about them?`,
  ];
  
  const selectedTemplate = followUpTemplates[Math.floor(Math.random() * followUpTemplates.length)];
  
  return {
    prompt: selectedTemplate,
    promptType: 'follow_up',
    containsBusinessName: true,
  };
}

/**
 * Generate a category-based prompt when the original prompt can't be cleaned.
 * This creates a natural question based on the business type and location.
 */
function generateCategoryBasedPrompt(business: BusinessInfo): string {
  const businessType = business.businessType || 'service provider';
  const location = business.location || 'the area';
  
  const templates = [
    `What are the best ${businessType} services in ${location}?`,
    `Can you recommend a good ${businessType} in ${location}?`,
    `I'm looking for ${businessType} services near ${location}. Any suggestions?`,
    `Who are the top-rated ${businessType} providers in ${location}?`,
    `What should I look for when choosing a ${businessType} in ${location}?`,
    `Are there any highly recommended ${businessType} companies in ${location}?`,
  ];
  
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Check if a text contains the business name or significant parts of it.
 */
function checkContainsBusinessName(text: string, businessName: string): boolean {
  const textLower = text.toLowerCase();
  const nameLower = businessName.toLowerCase();
  
  // Check exact match
  if (textLower.includes(nameLower)) {
    return true;
  }
  
  // Check significant words (more than 3 characters, excluding common words)
  const commonWords = ['the', 'and', 'inc', 'llc', 'corp', 'company', 'services', 'group'];
  const significantWords = nameLower
    .split(/\s+/)
    .filter(word => word.length > 3 && !commonWords.includes(word));
  
  // If more than half of significant words are found, consider it a match
  const matchedWords = significantWords.filter(word => textLower.includes(word));
  if (significantWords.length > 0 && matchedWords.length >= Math.ceil(significantWords.length * 0.6)) {
    return true;
  }
  
  return false;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Select a random prompt from the training prompts array.
 */
export function selectRandomPrompt(prompts: string[]): string {
  if (!prompts || prompts.length === 0) {
    throw new Error('No prompts available');
  }
  return prompts[Math.floor(Math.random() * prompts.length)];
}
