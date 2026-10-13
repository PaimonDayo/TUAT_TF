import {createElement,type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,expect,it,vi} from "vitest";
import {emptyPerformance} from "@/lib/meet-operations";
import type {CompetitionMeet,ManagedMeetEvent} from "@/lib/competition-meet";
import type {MeetMutation} from "./CompetitionMeetWorkspace";
const state=vi.hoisted(()=>({values:[] as unknown[],cursor:0}));
const capture=vi.hoisted(()=>({buttons:new Map<string,{disabled:boolean;onClick:()=>void}>(),inputs:[] as {value:string;onChange:(e:{target:{value:string}})=>void}[],selects:new Map<string,{onValueChange:(value:string)=>void;options:{value:string;label:string}[]}>(),run:vi.fn(),close:vi.fn(),add:vi.fn(),board:vi.fn()}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),useState(initial:unknown){const i=state.cursor++;if(!(i in state.values))state.values[i]=initial;return[state.values[i],(next:unknown)=>{state.values[i]=typeof next==="function"?next(state.values[i]):next;}];}}));
vi.mock("@/components/ui/form-modal",()=>({FormModal:({children}:{children:ReactNode})=>children,FormModalFooter:({children}:{children:ReactNode})=>children,FormDraftGuard:()=>null}));
vi.mock("@/components/ui/sheet",()=>({Sheet:({open,children}:{open:boolean;children:ReactNode})=>open?children:null,SheetContent:({children}:{children:ReactNode})=>children}));
vi.mock("@/components/ui/button",()=>({Button:(props:{children:ReactNode;disabled:boolean;onClick:()=>void})=>{if(typeof props.children==="string")capture.buttons.set(props.children,props);return createElement("button",{disabled:props.disabled},props.children);}}));
vi.mock("@/components/ui/input",()=>({Input:(props:{value:string;onChange:(e:{target:{value:string}})=>void})=>{capture.inputs.push(props);return createElement("input",{value:props.value,readOnly:true});}}));
vi.mock("@/components/ui/select",()=>({Select:(props:{ariaLabel:string;onValueChange:(value:string)=>void;options:{value:string;label:string}[]})=>{capture.selects.set(props.ariaLabel,props);return null;}}));
vi.mock("@/components/ui/segmented",()=>({SegmentedControl:()=>null}));
vi.mock("./MeetHeatBoard",()=>({MeetHeatBoard:(props:unknown)=>{capture.board(props);return null;}}));
vi.mock("./MeetFieldOrderBoard",()=>({MeetFieldOrderBoard:()=>null}));
import {CompetitionMeetEventEditor} from "./CompetitionMeetEventEditor";
const event:ManagedMeetEvent={competition_id:"test",name:"混合高跳び",family:"高跳び",division:"混合",starts_at:"10:00",sort_order:0,discipline:"height",wind:false,capacity:null,confirmed:false,revision:0};
const meet=():CompetitionMeet=>({competitionId:"test",meetKey:"test",name:"合成大会",backend:"pc",events:[event],participants:[{id:"person",competition_id:"test",profile_id:null,name:"合成",grade:"B1",absent:false,deleted:false,revision:0}],appearances:[{id:"appearance",competition_id:"test",participant_id:"person",event_name:event.name,ordinal:3,operation_key:"appearance",qualification_mark:null,state:"registered",performance:emptyPerformance("appearance"),revision:0}],duties:[],roles:[],party:[],members:[],permissions:{manage:true,groups:true,record:true,configure:true}});
const mutation=()=>({locked:false,busy:false,message:"",run:capture.run} as unknown as MeetMutation);
function render(data=meet()){state.cursor=0;capture.buttons.clear();capture.inputs=[];return renderToStaticMarkup(createElement(CompetitionMeetEventEditor,{event,meet:data,mutation:mutation(),onClose:capture.close,onAdd:capture.add}));}
beforeEach(()=>{state.values=[];capture.selects.clear();vi.clearAllMocks();capture.run.mockResolvedValue(true);});
it("adds a second height trial from the initial display slot and retains failed attempts while typing height",async()=>{
 render();capture.buttons.get("試技を追加")!.onClick();render();expect(capture.inputs).toHaveLength(2);
 capture.selects.get("1回目の結果")!.onValueChange("foul");render();capture.inputs[0].onChange({target:{value:"1.20"}});render();
 await capture.buttons.get("保存する")!.onClick();expect(capture.run).toHaveBeenCalledWith(expect.objectContaining({action:"event.save",changes:[expect.objectContaining({id:"appearance",performance:expect.objectContaining({trials:[{mark:"1.20",status:"foul",wind:""},{mark:"",status:"pending",wind:""}]})})]}));
});
it("keeps addition disabled with unsaved record inputs and enables it after clean refresh",()=>{
 render();expect(capture.buttons.get("この種目に出場を追加")!.disabled).toBe(false);capture.inputs[0].onChange({target:{value:"1.20"}});render();expect(capture.buttons.get("この種目に出場を追加")!.disabled).toBe(true);
});
it("requires explicit input discard when an appearance was cancelled during editing",()=>{
 const before=meet();render(before);capture.inputs[0].onChange({target:{value:"1.20"}});render(before);
 const current=structuredClone(before);current.appearances[0].state="cancelled";current.appearances[0].revision=1;render(current);capture.buttons.get("最新の情報と入力を確認")!.onClick();
 const html=render(current);expect(html).toContain("この出場の入力を破棄し、最新の情報を使う");expect(capture.buttons.get("確認した内容を使う")!.disabled).toBe(true);expect(capture.run).not.toHaveBeenCalled();
});
it("selects repeated appearances by trial order and edits only the chosen ID without ordinal labels",async()=>{
 const data=meet(),first=data.appearances[0];
 first.performance={...first.performance,group:1,order:1,trials:[{mark:"1.10",status:"valid",wind:""}]};
 const second={...structuredClone(first),id:"second",operation_key:"second",ordinal:8,performance:{...structuredClone(first.performance),entryId:"second",order:2,trials:[{mark:"1.20",status:"valid" as const,wind:""}]}};
 data.appearances.push(second);
 const html=render(data);expect(html).not.toContain("件目");
 expect(capture.selects.get("記録する出場")!.options).toEqual([{value:first.id,label:"合成・試技順 1番・1.10"},{value:second.id,label:"合成・試技順 2番・1.20"}]);
 capture.selects.get("記録する出場")!.onValueChange(second.id);render(data);
 capture.inputs[0].onChange({target:{value:"1.30"}});render(data);
 await capture.buttons.get("保存する")!.onClick();
 expect(capture.run).toHaveBeenCalledWith(expect.objectContaining({action:"event.save",changes:[expect.objectContaining({id:second.id,performance:expect.objectContaining({trials:[{mark:"1.30",status:"valid",wind:""}]})})]}));
 expect(first.performance.trials[0].mark).toBe("1.10");
});
