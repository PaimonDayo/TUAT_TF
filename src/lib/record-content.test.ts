import { describe, expect, it } from "vitest";
import { RECORD_NONEMPTY_OR } from "@/lib/record-content";

describe("RECORD_NONEMPTY_OR", () => {
  it("keeps records whose only content is a custom field", () => {
    expect(RECORD_NONEMPTY_OR.split(",")).toContain("custom.neq.{}");
  });
});
