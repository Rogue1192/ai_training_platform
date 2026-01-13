/**
 * Prompt Generation Module
 * 
 * This module handles the generation of different types of prompts for the AI training system:
 * - Clean prompts: Do NOT mention the business name (used for baseline and evaluation)
 * - Suggestive prompts: Include positive mentions of the business (used for training)
 * - Follow-up prompts: Reinforce business mentions in multi-turn conversations
 */

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
 * Generate a clean prompt that does NOT mention the business name.
 * Used for baseline testing and evaluation to measure unprompted mentions.
 * 
 * @param basePrompt - The original prompt template
 * @param business - Business information (used for category/location context only)
 * @returns A clean prompt without any business name references
 */
export function generateCleanPrompt(
  basePrompt: string,
  business: BusinessInfo
): PromptGenerationResult {
  // Remove any existing business name references from the base prompt
  let cleanedPrompt = basePrompt;
  
  // Remove the business name and common variations
  const businessNameLower = business.name.toLowerCase();
  const businessWords = business.name.split(/\s+/).filter(word => word.length > 2);
  
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
  
  // If the cleaned prompt is too short or empty, generate a category-based prompt
  if (cleanedPrompt.length < 20) {
    cleanedPrompt = generateCategoryBasedPrompt(business);
  }
  
  // Verify the prompt doesn't contain the business name
  const containsBusinessName = checkContainsBusinessName(cleanedPrompt, business.name);
  
  // If it still contains the business name, use a completely generic prompt
  if (containsBusinessName) {
    cleanedPrompt = generateCategoryBasedPrompt(business);
  }
  
  return {
    prompt: cleanedPrompt,
    promptType: 'clean',
    containsBusinessName: checkContainsBusinessName(cleanedPrompt, business.name),
  };
}

/**
 * Generate a suggestive prompt that positively mentions the business.
 * Used during the training phase to expose the AI to positive associations.
 * 
 * @param basePrompt - The original prompt template
 * @param business - Business information
 * @returns A suggestive prompt with positive business mentions
 */
export function generateSuggestivePrompt(
  basePrompt: string,
  business: BusinessInfo
): PromptGenerationResult {
  // First, get a clean version of the prompt
  const { prompt: cleanPrompt } = generateCleanPrompt(basePrompt, business);
  
  // Select a random suggestive template
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
 * @param previousResponse - The AI's previous response
 * @returns A follow-up prompt that asks about the business specifically
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
