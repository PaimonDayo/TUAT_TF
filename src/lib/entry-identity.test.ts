import { expect, it } from "vitest";
import { matchEntryMember } from "./entry-identity";

it("reuses a confirmed identity across meets after display name and grade changes", () => {
  const member = { id: "one", display_name: "変更後の表示名", grade: "3" };
  const result = matchEntryMember({ submitted_name: "試験 太郎", grade: "B3" }, [member], [{ submitted_name: "試験　太郎", profile_id: "one" }]);
  expect(result.status).toBe("previous");
  expect(result.candidates).toEqual([member]);
});

it("requires review when old mappings conflict with a current matching display name", () => {
  const result = matchEntryMember({ submitted_name: "試験太郎", grade: "B2" }, [
    { id: "one", display_name: "別名", grade: "2" }, { id: "two", display_name: "試験太郎", grade: "1" },
  ], [{ submitted_name: "試験太郎", profile_id: "one" }]);
  expect(result.status).toBe("ambiguous");
  expect(result.candidates).toHaveLength(2);
});

it("ignores historical identities absent from the eligible member list and deduplicates repeated history", () => {
  const entry = { submitted_name: "試験太郎", grade: "B2" };
  const history = [{ submitted_name: "試験太郎", profile_id: "one" }, { submitted_name: "試験太郎", profile_id: "one" }];
  expect(matchEntryMember(entry, [], history).status).toBe("none");
  expect(matchEntryMember(entry, [{ id: "one", display_name: "試験太郎", grade: "2" }], history).candidates).toHaveLength(1);
});
