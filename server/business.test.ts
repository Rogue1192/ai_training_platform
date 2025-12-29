import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("Business Management", () => {
  it("should create a new business", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.business.create({
      name: "Test HVAC Company",
      businessType: "HVAC",
      location: "Phoenix, AZ",
      description: "Leading HVAC services in Phoenix",
      website: "https://testhvac.com",
    });

    expect(result.success).toBe(true);
    expect(result.businessId).toBeGreaterThan(0);
  });

  it("should list businesses for authenticated user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a business first
    await caller.business.create({
      name: "Test Business",
      businessType: "Technology",
      location: "San Francisco, CA",
    });

    const businesses = await caller.business.list();

    expect(Array.isArray(businesses)).toBe(true);
    expect(businesses.length).toBeGreaterThan(0);
    expect(businesses[0]).toHaveProperty("name");
    expect(businesses[0]).toHaveProperty("businessType");
  });

  it("should update an existing business", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a business
    const createResult = await caller.business.create({
      name: "Original Name",
      businessType: "Retail",
      location: "New York, NY",
    });

    // Update the business
    const updateResult = await caller.business.update({
      id: createResult.businessId!,
      name: "Updated Name",
      businessType: "E-commerce",
    });

    expect(updateResult.success).toBe(true);

    // Verify the update
    const businesses = await caller.business.list();
    const updatedBusiness = businesses.find((b) => b.id === createResult.businessId);
    expect(updatedBusiness?.name).toBe("Updated Name");
    expect(updatedBusiness?.businessType).toBe("E-commerce");
  });

  it("should delete a business", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a business
    const createResult = await caller.business.create({
      name: "To Be Deleted",
      businessType: "Test",
      location: "Test City",
    });

    // Delete the business
    const deleteResult = await caller.business.delete({
      id: createResult.businessId!,
    });

    expect(deleteResult.success).toBe(true);

    // Verify deletion
    const businesses = await caller.business.list();
    const deletedBusiness = businesses.find((b) => b.id === createResult.businessId);
    expect(deletedBusiness).toBeUndefined();
  });
});
