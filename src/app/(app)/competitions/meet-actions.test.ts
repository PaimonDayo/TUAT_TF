import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({user:vi.fn(),preview:vi.fn(),rpc:vi.fn(),refresh:vi.fn(),publish:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:mocks.user},rpc:mocks.rpc})}));
vi.mock("@/lib/supabase/auth",()=>({isMemberPreviewActive:mocks.preview}));
vi.mock("next/cache",()=>({revalidatePath:mocks.refresh}));
vi.mock("@/lib/ob-results-notify",()=>({scheduleObResultsPublish:mocks.publish}));
import {mutateCompetitionMeet,checkCompetitionMeetMutation,readCompetitionMeetHistory} from "./meet-actions";
import {OB_MEET} from "@/lib/ob-meet";
const request="10000000-0000-4000-8000-000000000001",command={action:"appearance.add" as const,participantId:request,event:"男子100m",backend:"pc" as const};
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({data:{user:{id:request}},error:null});mocks.preview.mockResolvedValue(false);mocks.rpc.mockResolvedValue({data:{requestId:request,id:request},error:null});});
it("sends one atomic request with the unchanged ID and backend and schedules verified OB exports",async()=>{
 const before=structuredClone(command);expect(await mutateCompetitionMeet(OB_MEET.competitionId,request,command)).toEqual({ok:true,requestId:request,id:request});
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("mutate_competition_meet",{p_competition_id:OB_MEET.competitionId,p_request_id:request,p_command:command});expect(command).toEqual(before);expect(mocks.publish).toHaveBeenCalledOnce();
});
it("reuses the actions for another competition without invoking the OB publisher",async()=>{expect((await mutateCompetitionMeet("another-meet",request,command)).ok).toBe(true);expect(mocks.publish).not.toHaveBeenCalled();});
it.each(["unauthenticated","preview"])("rejects %s operations before the RPC",async scenario=>{if(scenario==="preview")mocks.preview.mockResolvedValue(true);else mocks.user.mockResolvedValue({data:{user:null},error:null});expect((await mutateCompetitionMeet("another-meet",request,command)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
it("keeps transport failures uncertain and never resends automatically",async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{message:"gateway timeout",code:"504"}});expect(await mutateCompetitionMeet("another-meet",request,command)).toMatchObject({ok:false,uncertain:true});expect(mocks.rpc).toHaveBeenCalledOnce();expect(mocks.refresh).not.toHaveBeenCalled();
});
it("treats empty or mismatched successful replies as uncertain",async()=>{for(const data of [null,{requestId:"another request"}]){mocks.rpc.mockResolvedValue({data,error:null});expect(await mutateCompetitionMeet("another-meet",request,command)).toMatchObject({ok:false,uncertain:true});}expect(mocks.refresh).not.toHaveBeenCalled();});
it("keeps an authentication transport failure distinct from a permission denial",async()=>{mocks.user.mockResolvedValue({data:{user:null},error:{message:"temporarily unavailable"}});const result=await mutateCompetitionMeet("another-meet",request,command);expect(result.ok).toBe(false);expect(result.message).toContain("本人情報を確認できませんでした");expect(result.message).not.toContain("権限");expect(mocks.rpc).not.toHaveBeenCalled();});
it("distinguishes confirmed conflicts from uncertain saves",async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:"meet_conflict",code:"P0001"}});expect(await mutateCompetitionMeet("another-meet",request,command)).toMatchObject({ok:false,stale:true});expect(mocks.refresh).not.toHaveBeenCalled();});
it("checks the ledger without a mutation and only allows explicit retry after a definite absence",async()=>{
 mocks.rpc.mockResolvedValueOnce({data:{notSaved:true},error:null});expect(await checkCompetitionMeetMutation("another-meet",request,command)).toMatchObject({ok:false,uncertain:true,notSaved:true});expect(mocks.rpc).toHaveBeenLastCalledWith("check_competition_meet_mutation",expect.objectContaining({p_request_id:request,p_command:command}));expect(mocks.refresh).not.toHaveBeenCalled();
 mocks.rpc.mockResolvedValueOnce({data:null,error:null});expect(await checkCompetitionMeetMutation("another-meet",request,command)).toMatchObject({ok:false,uncertain:true});
 mocks.rpc.mockResolvedValueOnce({data:{requestId:request,id:request},error:null});expect(await checkCompetitionMeetMutation("another-meet",request,command)).toEqual({ok:true,requestId:request,id:request});
});
it("does not interpret a failed history read as an empty history",async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:"failed"}});await expect(readCompetitionMeetHistory("another-meet",null)).rejects.toThrow();});
it("rejects malformed request identity before authentication",async()=>{expect((await mutateCompetitionMeet("another-meet","invalid",command)).ok).toBe(false);expect(mocks.user).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();});
