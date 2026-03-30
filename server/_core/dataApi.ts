/**
 * Data API helper — standalone
 * 
 * This module previously proxied through Manus Forge API.
 * The app uses DataForSEO directly (server/dataforseoService.ts),
 * so this module is kept only for interface compatibility.
 * 
 * If you need external data APIs, call them directly from your
 * server code using fetch/axios with your own API keys.
 */

export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

export async function callDataApi(
  apiId: string,
  _options: DataApiCallOptions = {}
): Promise<unknown> {
  throw new Error(
    `callDataApi("${apiId}") is not available. ` +
    `This app uses DataForSEO directly — see server/dataforseoService.ts. ` +
    `If you need a different data API, call it directly with fetch/axios.`
  );
}
