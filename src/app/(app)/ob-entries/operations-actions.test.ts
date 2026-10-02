import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({user:vi.fn(),roles:vi.fn(),preview:vi.fn(),rpc:vi.fn(),refresh:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.user},rpc:mocks.rpc})}));
vi.mock('@/lib/supabase/auth',()=>({fetchRolesByProfileIds:mocks.roles,isMemberPreviewActive:mocks.preview}));
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}));
import { saveObEventOperation } from './operations-actions';
const input={event:'男子100m',revision:null,data:{confirmed:false,participants:[]}};
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({data:{user:{id:'u'}}});mocks.preview.mockResolvedValue(false);mocks.roles.mockResolvedValue(new Map([['u',[{can_manage_system:true}]]]));mocks.rpc.mockResolvedValue({data:{event_name:'男子100m',revision:0,data:input.data},error:null});});
it('rejects anonymous, ordinary, OB staff, and suppressed/preview permissions',async()=>{
  mocks.user.mockResolvedValueOnce({data:{user:null}});expect((await saveObEventOperation(input)).ok).toBe(false);
  for(const roles of [[],[{name:'OB戦2026',can_manage_system:false}],[{can_manage_system:true,permissions_suppressed:true}]]){mocks.roles.mockResolvedValueOnce(new Map([['u',roles]]));expect((await saveObEventOperation(input)).ok).toBe(false);}
  mocks.preview.mockResolvedValueOnce(true);expect((await saveObEventOperation(input)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
});
it('saves atomically with expected revision and invalidates only on success',async()=>{
  const result=await saveObEventOperation(input);expect(result.ok).toBe(true);expect(mocks.rpc).toHaveBeenCalledWith('save_ob_event_operation',{p_event:input.event,p_revision:null,p_data:input.data});expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
it('keeps conflicts and absent responses distinct from success',async()=>{
  mocks.rpc.mockResolvedValueOnce({error:{message:'operation_conflict'}});expect((await saveObEventOperation(input)).message).toContain('上書き');
  mocks.rpc.mockResolvedValueOnce({data:null,error:null});expect((await saveObEventOperation(input)).ok).toBe(false);expect(mocks.refresh).not.toHaveBeenCalled();
});
it('rejects malformed payloads before authentication/database',async()=>{
  for(const malformed of [null,{...input,event:'other'},{...input,revision:-1},{...input,data:{}},{...input,data:{confirmed:false,participants:[null]}}]) expect((await saveObEventOperation(malformed as unknown as typeof input)).ok).toBe(false);
  expect(mocks.user).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
});
