import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPerformance } from "@/lib/meet-operations";
import type { ObEntry } from "@/lib/ob-entries";
import type { useObOperationDraft } from "./useObOperationDraft";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
const mocks = vi.hoisted(() => ({ draft: {} as ReturnType<typeof useObOperationDraft>, buttons: new Map<string, {disabled?:boolean;onClick:()=>void}>(), day: vi.fn(), selects: new Map<string, {onChange:(e:{target:{value:string}})=>void}>(), saved: vi.fn(), close: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState(initial: unknown) { const i=state.cursor++; if(!(i in state.values)) state.values[i]=typeof initial==="function" ? initial() : initial; return [state.values[i],(value:unknown)=>{state.values[i]=typeof value==="function" ? value(state.values[i]) : value;}]; } }));
vi.mock("./useObOperationDraft", () => ({ useObOperationDraft: () => mocks.draft }));
vi.mock("@/components/ui/form-modal", () => ({ FormModal: ({children,open}:{children:ReactNode;open:boolean})=>{
  function capture(node:ReactNode){if(Array.isArray(node)){node.forEach(capture);return;}if(isValidElement<{children?:ReactNode;"aria-label"?:string;onChange:(e:{target:{value:string}})=>void}>(node)){if(node.type==="select")mocks.selects.set(node.props["aria-label"]!,node.props);capture(node.props.children);}}
  capture(children);return open?createElement("div",{},children):null;
 }, FormModalFooter:({children}:{children:ReactNode})=>children, FormDraftGuard:()=>null }));
vi.mock("@/components/ui/button", () => ({Button:(props:{children:ReactNode;disabled?:boolean;onClick:()=>void})=>{if(typeof props.children==="string")mocks.buttons.set(props.children,props);return createElement("button",{disabled:props.disabled},props.children);}}));
vi.mock("./ObDayRegistration",()=>({ObDayRegistration:(props:unknown)=>{mocks.day(props);return null;}}));
import { ObEventOperationsEditor } from "./ObEventOperationsEditor";
const event="男子100m";
const entries:ObEntry[]=["dns","next","recorded","absent"].map((id,i)=>({id,meet_key:"ob-2026",submitted_name:id,grade:"B1",events:[event],profile_id:null,revision:0,imported_at:"",qualification_marks:{},absent:i===3}));
function render(canRegister=true){state.cursor=0;mocks.buttons.clear();return renderToStaticMarkup(createElement(ObEventOperationsEditor,{event,entries,canRegister,onSaved:mocks.saved,onClose:mocks.close}));}
beforeEach(()=>{
 vi.clearAllMocks();state.values=[];
 mocks.draft={data:{confirmed:false,participants:[{...emptyPerformance("dns"),group:1,order:1,heatScope:"混合",status:"DNS",trials:[{mark:"12.34",wind:"",status:"valid"}]},emptyPerformance("next"),{...emptyPerformance("recorded"),group:2,order:1,trials:[{mark:"12.50",wind:"",status:"valid"}]},emptyPerformance("absent")]},dirty:false,locked:false,busy:false,unconfirmed:false,failed:false,message:"",revision:7,change:vi.fn(),save:vi.fn(),review:null,reviewing:false,blocked:[],choices:{},setChoices:vi.fn(),applyReview:vi.fn(),discardPerson:vi.fn(),latestData:undefined};
});
it("opens registration inside the record editor with its latest results, and returns after adding",()=>{
 render();mocks.buttons.get("出場者を追加")!.onClick();render();
 const props=mocks.day.mock.lastCall![0];expect(props.event).toBe(event);expect(props.operations[0].data).toBe(mocks.draft.data);
 props.onSaved("next",{meet_key:"ob-2026",event_name:event,data:mocks.draft.data,revision:8,updated_at:""});
 expect(mocks.saved).toHaveBeenCalledWith(expect.objectContaining({revision:8}));expect(render()).toContain("nextのタイム");expect(mocks.close).not.toHaveBeenCalled();
});
it("releases the placement from record input and preserves existing trials and other people",()=>{
 mocks.draft.data.participants[0].status="entered";render();
 mocks.selects.get("dnsの出場状況")!.onChange({target:{value:"DNS"}});
 const next=vi.mocked(mocks.draft.change).mock.lastCall![0];
 expect(next.participants[0]).toEqual({...mocks.draft.data.participants[0],status:"DNS",group:null,order:null,heatScope:undefined});
 expect(next.participants[0]).not.toHaveProperty("heatScope");
 expect(next.participants[0].trials).toBe(mocks.draft.data.participants[0].trials);
 expect(next.participants.slice(1)).toEqual(mocks.draft.data.participants.slice(1));
});
it("keeps registration hidden without management permission and locked until inputs save",()=>{
 expect(render(false)).not.toContain("出場者を追加");expect(mocks.buttons.has("この枠に別の人を入れる")).toBe(false);
 mocks.draft.dirty=true;render();expect(mocks.buttons.get("出場者を追加")?.disabled).toBe(true);
});
