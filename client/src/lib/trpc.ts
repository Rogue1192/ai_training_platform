import { createTRPCReact } from "@trpc/react-query";
import type { CombinedRouter } from "../../../server/_core/index";

export const trpc = createTRPCReact<CombinedRouter>();
