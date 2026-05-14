import { describe, expect, it } from "vitest";
import { parseDotEnv } from "@/lib/worker/env";

describe("parseDotEnv", () => {
  it("parses quoted and unquoted environment values", () => {
    expect(parseDotEnv('DATABASE_URL="file:./dev.db"\nPORT=3333\nEMPTY=\n# comment')).toEqual({
      DATABASE_URL: "file:./dev.db",
      PORT: "3333",
      EMPTY: ""
    });
  });
});
