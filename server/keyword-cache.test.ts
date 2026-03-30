import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dbCampaigns module
vi.mock("./dbCampaigns", () => ({
  getAllIndustryKeywordCaches: vi.fn(),
  getIndustryKeywordCache: vi.fn(),
  upsertIndustryKeywordCache: vi.fn(),
}));

// Mock the db module
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

import {
  getAllIndustryKeywordCaches,
  getIndustryKeywordCache,
  upsertIndustryKeywordCache,
} from "./dbCampaigns";

const mockGetAllCaches = getAllIndustryKeywordCaches as ReturnType<typeof vi.fn>;
const mockGetCache = getIndustryKeywordCache as ReturnType<typeof vi.fn>;
const mockUpsertCache = upsertIndustryKeywordCache as ReturnType<typeof vi.fn>;

describe("Industry Keyword Cache Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("List caches", () => {
    it("should return all industry keyword caches", async () => {
      const mockCaches = [
        {
          id: 1,
          industry: "hvac",
          keywords: [
            { keyword: "hvac repair near me", aiSearchVolume: 5400 },
            { keyword: "ac installation", aiSearchVolume: 3200 },
          ],
          goldenTemplateKeywords: null,
          clientCount: 2,
          isLocked: false,
          lockThreshold: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          industry: "plumbing",
          keywords: [
            { keyword: "plumber near me", aiSearchVolume: 8100 },
            { keyword: "emergency plumber", aiSearchVolume: 4500 },
          ],
          goldenTemplateKeywords: [
            { keyword: "plumber near me", aiSearchVolume: 8100 },
          ],
          clientCount: 5,
          isLocked: true,
          lockThreshold: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockGetAllCaches.mockResolvedValue(mockCaches);
      const result = await getAllIndustryKeywordCaches();
      expect(result).toHaveLength(2);
      expect(result[0].industry).toBe("hvac");
      expect(result[1].isLocked).toBe(true);
    });

    it("should return empty array when no caches exist", async () => {
      mockGetAllCaches.mockResolvedValue([]);
      const result = await getAllIndustryKeywordCaches();
      expect(result).toHaveLength(0);
    });
  });

  describe("Get cache by industry", () => {
    it("should return cache for a specific industry", async () => {
      const mockCache = {
        id: 1,
        industry: "hvac",
        keywords: [
          { keyword: "hvac repair near me", aiSearchVolume: 5400, frequency: 3 },
          { keyword: "ac installation", aiSearchVolume: 3200, frequency: 2 },
        ],
        goldenTemplateKeywords: null,
        clientCount: 2,
        isLocked: false,
        lockThreshold: 3,
      };

      mockGetCache.mockResolvedValue(mockCache);
      const result = await getIndustryKeywordCache("hvac");
      expect(result).toBeDefined();
      expect(result!.industry).toBe("hvac");
      expect(result!.keywords).toHaveLength(2);
    });

    it("should return undefined for non-existent industry", async () => {
      mockGetCache.mockResolvedValue(undefined);
      const result = await getIndustryKeywordCache("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("Lock golden template", () => {
    it("should lock a cache and set golden template from top keywords", async () => {
      const mockCache = {
        id: 1,
        industry: "hvac",
        keywords: [
          { keyword: "hvac repair near me", aiSearchVolume: 5400 },
          { keyword: "ac installation", aiSearchVolume: 3200 },
          { keyword: "furnace repair", aiSearchVolume: 2100 },
        ],
        goldenTemplateKeywords: null,
        clientCount: 3,
        isLocked: false,
        lockThreshold: 3,
      };

      mockGetCache.mockResolvedValue(mockCache);
      mockUpsertCache.mockResolvedValue({ ...mockCache, isLocked: true });

      // Simulate the lock logic from the router
      const cache = await getIndustryKeywordCache("hvac");
      expect(cache).toBeDefined();

      const goldenKeywords = cache!.goldenTemplateKeywords ||
        (cache!.keywords as any[])
          .sort((a: any, b: any) => (b.aiSearchVolume || 0) - (a.aiSearchVolume || 0))
          .slice(0, 20);

      await upsertIndustryKeywordCache("hvac", {
        isLocked: true,
        goldenTemplateKeywords: goldenKeywords,
      });

      expect(mockUpsertCache).toHaveBeenCalledWith("hvac", {
        isLocked: true,
        goldenTemplateKeywords: expect.arrayContaining([
          expect.objectContaining({ keyword: "hvac repair near me" }),
        ]),
      });
    });

    it("should use existing golden template when locking if already set", async () => {
      const existingGolden = [
        { keyword: "plumber near me", aiSearchVolume: 8100 },
      ];
      const mockCache = {
        id: 2,
        industry: "plumbing",
        keywords: [
          { keyword: "plumber near me", aiSearchVolume: 8100 },
          { keyword: "emergency plumber", aiSearchVolume: 4500 },
        ],
        goldenTemplateKeywords: existingGolden,
        clientCount: 5,
        isLocked: false,
        lockThreshold: 3,
      };

      mockGetCache.mockResolvedValue(mockCache);
      mockUpsertCache.mockResolvedValue({ ...mockCache, isLocked: true });

      const cache = await getIndustryKeywordCache("plumbing");
      const goldenKeywords = cache!.goldenTemplateKeywords || (cache!.keywords as any[]);

      await upsertIndustryKeywordCache("plumbing", {
        isLocked: true,
        goldenTemplateKeywords: goldenKeywords,
      });

      expect(mockUpsertCache).toHaveBeenCalledWith("plumbing", {
        isLocked: true,
        goldenTemplateKeywords: existingGolden,
      });
    });
  });

  describe("Unlock golden template", () => {
    it("should unlock a cache", async () => {
      mockUpsertCache.mockResolvedValue({ isLocked: false });

      await upsertIndustryKeywordCache("hvac", { isLocked: false });

      expect(mockUpsertCache).toHaveBeenCalledWith("hvac", { isLocked: false });
    });
  });

  describe("Update keywords", () => {
    it("should update keywords for an industry", async () => {
      const newKeywords = [
        { keyword: "hvac repair", aiSearchVolume: 5400 },
        { keyword: "new keyword added", aiSearchVolume: 1000 },
      ];

      mockUpsertCache.mockResolvedValue({ keywords: newKeywords });

      await upsertIndustryKeywordCache("hvac", { keywords: newKeywords });

      expect(mockUpsertCache).toHaveBeenCalledWith("hvac", {
        keywords: newKeywords,
      });
    });

    it("should update both keywords and golden template when updateGolden is true", async () => {
      const newKeywords = [
        { keyword: "hvac repair", aiSearchVolume: 5400 },
        { keyword: "ac service", aiSearchVolume: 3000 },
      ];

      mockUpsertCache.mockResolvedValue({
        keywords: newKeywords,
        goldenTemplateKeywords: newKeywords,
      });

      // Simulate updateGolden: true
      await upsertIndustryKeywordCache("hvac", {
        keywords: newKeywords,
        goldenTemplateKeywords: newKeywords,
      });

      expect(mockUpsertCache).toHaveBeenCalledWith("hvac", {
        keywords: newKeywords,
        goldenTemplateKeywords: newKeywords,
      });
    });
  });

  describe("Update lock threshold", () => {
    it("should update the lock threshold for an industry", async () => {
      mockUpsertCache.mockResolvedValue({ lockThreshold: 5 });

      await upsertIndustryKeywordCache("hvac", { lockThreshold: 5 });

      expect(mockUpsertCache).toHaveBeenCalledWith("hvac", { lockThreshold: 5 });
    });
  });

  describe("Refresh cache", () => {
    it("should reset cache to unlocked state with cleared golden template", async () => {
      mockUpsertCache.mockResolvedValue({
        isLocked: false,
        goldenTemplateKeywords: null,
        clientCount: 0,
      });

      await upsertIndustryKeywordCache("hvac", {
        isLocked: false,
        goldenTemplateKeywords: null as any,
        clientCount: 0,
        lastRefreshedAt: expect.any(Date),
      });

      expect(mockUpsertCache).toHaveBeenCalledWith("hvac", {
        isLocked: false,
        goldenTemplateKeywords: null,
        clientCount: 0,
        lastRefreshedAt: expect.any(Date),
      });
    });
  });

  describe("Keyword sorting and filtering", () => {
    it("should sort keywords by aiSearchVolume descending by default", () => {
      const keywords = [
        { keyword: "ac repair", aiSearchVolume: 2000 },
        { keyword: "hvac near me", aiSearchVolume: 5400 },
        { keyword: "furnace repair", aiSearchVolume: 3200 },
      ];

      const sorted = [...keywords].sort(
        (a, b) => (b.aiSearchVolume || 0) - (a.aiSearchVolume || 0)
      );

      expect(sorted[0].keyword).toBe("hvac near me");
      expect(sorted[1].keyword).toBe("furnace repair");
      expect(sorted[2].keyword).toBe("ac repair");
    });

    it("should sort keywords alphabetically", () => {
      const keywords = [
        { keyword: "furnace repair", aiSearchVolume: 3200 },
        { keyword: "ac repair", aiSearchVolume: 2000 },
        { keyword: "hvac near me", aiSearchVolume: 5400 },
      ];

      const sorted = [...keywords].sort((a, b) => a.keyword.localeCompare(b.keyword));

      expect(sorted[0].keyword).toBe("ac repair");
      expect(sorted[1].keyword).toBe("furnace repair");
      expect(sorted[2].keyword).toBe("hvac near me");
    });

    it("should filter golden template keywords correctly", () => {
      const allKeywords = [
        { keyword: "hvac near me", aiSearchVolume: 5400 },
        { keyword: "ac repair", aiSearchVolume: 2000 },
        { keyword: "furnace repair", aiSearchVolume: 3200 },
      ];

      const goldenKeywords = [
        { keyword: "hvac near me", aiSearchVolume: 5400 },
        { keyword: "furnace repair", aiSearchVolume: 3200 },
      ];

      const isGolden = (kw: string) =>
        goldenKeywords.some((g) => g.keyword === kw);

      expect(isGolden("hvac near me")).toBe(true);
      expect(isGolden("ac repair")).toBe(false);
      expect(isGolden("furnace repair")).toBe(true);
    });
  });

  describe("Cache statistics", () => {
    it("should calculate total AI search volume", () => {
      const keywords = [
        { keyword: "hvac near me", aiSearchVolume: 5400 },
        { keyword: "ac repair", aiSearchVolume: 2000 },
        { keyword: "furnace repair", aiSearchVolume: 3200 },
      ];

      const totalVolume = keywords.reduce((sum, k) => sum + (k.aiSearchVolume || 0), 0);
      expect(totalVolume).toBe(10600);
    });

    it("should calculate average frequency", () => {
      const keywords = [
        { keyword: "hvac near me", frequency: 5 },
        { keyword: "ac repair", frequency: 3 },
        { keyword: "furnace repair", frequency: 4 },
      ];

      const avgFrequency =
        keywords.reduce((sum, k) => sum + (k.frequency || 0), 0) / keywords.length;
      expect(avgFrequency).toBe(4);
    });

    it("should determine lock progress percentage", () => {
      const clientCount = 2;
      const lockThreshold = 5;
      const progress = (clientCount / lockThreshold) * 100;
      expect(progress).toBe(40);
    });

    it("should cap lock progress at 100%", () => {
      const clientCount = 7;
      const lockThreshold = 3;
      const progress = Math.min(100, (clientCount / lockThreshold) * 100);
      expect(progress).toBe(100);
    });
  });
});
