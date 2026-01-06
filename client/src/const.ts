export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL - now redirects to our local Supabase auth login page
export const getLoginUrl = () => {
  // Simply redirect to our login page
  return "/login";
};
