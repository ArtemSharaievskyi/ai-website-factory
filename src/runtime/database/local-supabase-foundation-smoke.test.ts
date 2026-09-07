import { describe, expect, it } from "vitest";
import { isBehavioralSecurityFixture } from "./security-fixtures";
import { renderFoundationRequestsSecurityFixture } from "../../../scripts/local-supabase-foundation-smoke";

describe("local Supabase foundation smoke fixture", () => {
  it("emits the executable behavioral security matrix required by the production validator", () => {
    const fixture = renderFoundationRequestsSecurityFixture();

    expect(isBehavioralSecurityFixture(fixture)).toBe(true);
    expect(fixture).toContain("public.foundation_requests");
    expect(fixture).toContain("OWNER_ONLY");
    expect(fixture).toContain("ANONYMOUS_DENY");
    expect(fixture).toContain("SELF_ESCALATION_DENY");
  });
});
