import {expect,it} from "vitest";
import {MeetHeatPlan} from "./meet-heat-plan";
import {emptyPerformance,MeetEvent,type MeetEventData} from "./meet-operations";
const a={...emptyPerformance("a"),group:1,order:1,trials:[{mark:"12.34",status:"valid" as const,wind:"0"}]};
const b={...emptyPerformance("b"),group:2,order:2};
const c=emptyPerformance("c");
const data:MeetEventData={participants:[a,b,c],confirmed:false};
const plan=(d=data)=>new MeetHeatPlan(d,new Set(d.participants.filter(p=>p.entryId!=="old").map(p=>p.entryId)));
it("moves several people to the end without an eight-person limit or lost results",()=>{
 const crowd=Array.from({length:25},(_,i)=>({...emptyPerformance("p"+i),group:1,order:i+1}));
 const next=plan({...data,participants:[...crowd,a,b,c]}).move(["b","c"],1);
 expect(next.participants.slice(-2).map(p=>[p.group,p.order])).toEqual([[1,26],[1,27]]);
 expect(next.participants[25]).toBe(a);expect(b.group).toBe(2);
});
it("swaps two people across groups or with an unassigned entrant",()=>{
 const next=plan().swap(["a","b"]);
 expect(next.participants.slice(0,2).map(p=>[p.group,p.order])).toEqual([[2,2],[1,1]]);
 expect(next.participants[0].trials).toEqual(a.trials);
 expect(new MeetEvent({name:"100m",discipline:"track",wind:true},next).validate()).toBeNull();
 expect(plan().swap(["a","c"]).participants[0]).toEqual({...a,group:null,order:null});
 expect(plan().move(["a"],1)).toBe(data);
});
it("reserves DNS and withdrawn numbers so reinstatement cannot collide",()=>{
 const dns={...emptyPerformance("dns"),status:"DNS" as const,group:1,order:3};
 const old={...emptyPerformance("old"),group:1,order:4};
 const next=plan({...data,participants:[a,b,c,dns,old]}).move(["c"],1);
 expect(next.participants[2]).toEqual({...c,group:1,order:5});
 expect(next.participants[3]).toBe(dns);expect(next.participants[4]).toBe(old);
 expect(()=>plan({...data,participants:[a,b,c,dns,old]}).move(["dns"],1)).toThrow();
});
it("places only explicitly selected entrants while the remaining people stay unassigned",()=>{
 const fresh:MeetEventData={participants:Array.from({length:30},(_,i)=>emptyPerformance("p"+i)),confirmed:false};
 const next=plan(fresh).move(["p0","p29"],2);
 expect(next.participants[0]).toMatchObject({group:2,order:1});
 expect(next.participants[29]).toMatchObject({group:2,order:2});
 expect(next.participants.slice(1,29)).toEqual(fresh.participants.slice(1,29));
 expect(fresh.participants.every(p=>p.group===null&&p.order===null)).toBe(true);
});
it("keeps trials when unassigning and refuses malformed changes atomically",()=>{
 const next=plan().move(["a"],null);
 expect(next.participants[0]).toEqual({...a,group:null,order:null});
 expect(()=>plan().move(["a","a"],1)).toThrow();
 expect(()=>plan().swap(["a"])).toThrow();
 const full={...data,participants:[{...a,order:300},b,c]};
 expect(()=>plan(full).move(["c"],1)).toThrow("番号");
 expect(full.participants[2]).toBe(c);
});
it("allows an explicit manual placement of all 300 non-lane entrants in one group",()=>{
 const fresh:MeetEventData={participants:Array.from({length:300},(_,i)=>emptyPerformance("p"+i)),confirmed:false};
 const next=plan(fresh).move(fresh.participants.map(p=>p.entryId),1);
 expect(new Set(next.participants.map(p=>p.group))).toEqual(new Set([1]));
 expect(next.participants.at(-1)?.order).toBe(300);
 expect(new MeetEvent({name:"1500m",discipline:"track",wind:false},next).validate()).toBeNull();
});
it("DNS and restoration keep every trial and number and reject a occupied return position",()=>{
 const dns=plan().setDns("a",true);
 expect(dns.participants[0]).toEqual({...a,status:"DNS"});
 expect(plan(dns).setDns("a",false).participants[0]).toEqual(a);
 const occupied={...dns,participants:[dns.participants[0],{...b,group:1,order:1},c]};
 expect(()=>plan(occupied).setDns("a",false)).toThrow("別の人");
 expect(occupied.participants[0].status).toBe("DNS");
 const absentPlan=new MeetHeatPlan(data,new Set(["b","c"]));
 expect(()=>absentPlan.setDns("a",true)).toThrow("欠席");
 expect(()=>absentPlan.move(["a"],2)).toThrow();
});

it.each([6,8])("fills only selected people into the lowest free slots of a %i-slot group",capacity=>{
 const dns={...emptyPerformance("dns"),status:"DNS" as const,group:1,order:2};
 const old={...emptyPerformance("old"),group:1,order:4};
 const existing={...data,participants:[a,b,c,dns,old],confirmed:true};
 const next=plan(existing).move(["b","c"],1,capacity);
 expect(next.participants[1]).toEqual({...b,group:1,order:3});
 expect(next.participants[2]).toEqual({...c,group:1,order:5});
 expect(next.participants[0]).toBe(a);expect(next.participants[3]).toBe(dns);expect(next.participants[4]).toBe(old);
 expect(next.confirmed).toBe(false);
});

it("refuses an overfull checklist move atomically without making another group",()=>{
 const crowd=Array.from({length:6},(_,i)=>({...emptyPerformance("p"+i),group:1,order:i+1}));
 const existing={participants:[...crowd,b,c],confirmed:true};
 const snapshot=JSON.stringify(existing);
 expect(()=>plan(existing).move(["b","c"],1,6)).toThrow("空き枠は0");
 expect(JSON.stringify(existing)).toBe(snapshot);
 expect(existing.participants.at(-1)).toBe(c);
 const seven={participants:[...crowd.slice(0,5),b,c],confirmed:true};
 expect(()=>plan(seven).move(["b","c"],1,6)).toThrow("空き枠は1");
 expect(seven.participants[5]).toBe(b);expect(seven.participants[6]).toBe(c);
});

it("moves a chosen legacy position into a proper slot in the same group without losing records",()=>{
 const legacy={...a,order:9};
 const other={...b,group:1,order:2};
 const existing={participants:[legacy,other,c],confirmed:true};
 const next=plan(existing).move(["a"],1,6);
 expect(next.participants[0]).toEqual({...legacy,order:1});
 expect(next.participants[0].trials).toBe(a.trials);
 expect(next.participants[1]).toBe(other);expect(next.participants[2]).toBe(c);
 expect(plan(next).move(["a"],1,6)).toBe(next);
});

it("lets the checklist resolve a duplicate active slot while keeping the reserved occupant",()=>{
 const dns={...emptyPerformance("dns"),status:"DNS" as const,group:1,order:1};
 const existing={...data,participants:[a,b,c,dns]};
 const next=plan(existing).move(["a"],1,6);
 expect(next.participants[0]).toEqual({...a,order:2});
 expect(next.participants[3]).toBe(dns);
 expect(plan(next).reorder(1,[2,3,4,5,6],6)).toBe(next);
});

it("slides an entrant into an empty lane and retains the gap, other groups and every trial",()=>{
 const second={...c,group:1,order:3};
 const existing={participants:[a,b,second],confirmed:true};
 const next=plan(existing).reorder(1,[2,1,3,4,5,6,7,8],8);
 expect(next.participants[0]).toEqual({...a,order:2});
 expect(next.participants[0].trials).toBe(a.trials);
 expect(next.participants[1]).toBe(b);expect(next.participants[2]).toBe(second);
 expect(next.participants.every(p=>p.group!==1||p.order!==1)).toBe(true);
 expect(next.confirmed).toBe(false);
});

it("slides editable rows around pinned DNS, cancelled and absent slots without moving legacy rows",()=>{
 const dns={...emptyPerformance("dns"),status:"DNS" as const,group:1,order:2};
 const cancelled={...emptyPerformance("old"),group:1,order:4};
 const absent={...emptyPerformance("absent"),group:1,order:5};
 const second={...c,group:1,order:3};
 const legacy={...emptyPerformance("legacy"),group:1,order:9,trials:a.trials};
 const existing={participants:[a,second,dns,cancelled,absent,legacy,b],confirmed:true};
 const model=new MeetHeatPlan(existing,new Set(["a","c","legacy","b"]));
 const next=model.reorder(1,[3,1,6],6);
 expect(next.participants[0]).toEqual({...a,order:3});
 expect(next.participants[1]).toEqual({...second,order:1});
 for(const index of [2,3,4,5,6]) expect(next.participants[index]).toBe(existing.participants[index]);
 expect(next.participants[0].trials).toBe(a.trials);
 expect(()=>model.reorder(1,[3,1,2,4,5,6],6)).toThrow("枠");
});

it("supports field slots and extra blanks without imposing an eight or six-slot limit",()=>{
 const second={...c,group:1,order:12};
 const existing={participants:[a,second,b],confirmed:false};
 const orders=[13,...Array.from({length:12},(_,i)=>i+1)];
 const next=plan(existing).reorder(1,orders);
 expect(next.participants[0]).toEqual({...a,order:2});
 expect(next.participants[1]).toEqual({...second,order:13});
 expect(next.participants[2]).toBe(b);
 expect(new MeetEvent({name:"走り幅跳び",discipline:"distance",wind:true},next).validate()).toBeNull();
});

it("rejects duplicated or incomplete slide slots instead of dropping an occupant",()=>{
 const duplicate={...b,group:1,order:1};
 const existing={participants:[a,duplicate,c],confirmed:true};
 const snapshot=JSON.stringify(existing);
 expect(()=>plan(existing).reorder(1,[1,2,3,4,5,6],6)).toThrow("重複");
 expect(JSON.stringify(existing)).toBe(snapshot);
 expect(()=>plan().reorder(1,[1,1,3,4,5,6],6)).toThrow("枠");
 expect(()=>plan().reorder(1,[1,2],6)).toThrow("枠");
 for(const capacity of [0,-1,301,1.5]) {
  expect(()=>plan().move(["c"],1,capacity)).toThrow("枠");
  expect(()=>plan().reorder(1,[],capacity)).toThrow("枠");
 }
 expect(plan().reorder(1,[1,2,3,4,5,6],6)).toBe(data);
});
