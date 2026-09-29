import { expect, it } from "vitest";
import { canModerateComments } from "./permissions";
import type { AppRole } from "@/types";
it("grants moderation only to the explicitly named administrator role",()=>{
 const role=(name:string)=>({name,can_manage_members:true,can_manage_system:true}) as AppRole;
 expect(canModerateComments([role("管理者")])).toBe(true);
 for(const name of ["システム","OB戦2026","副管理者"]) expect(canModerateComments([role(name)])).toBe(false);
 expect(canModerateComments([])).toBe(false);expect(canModerateComments(null)).toBe(false);
});
