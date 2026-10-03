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
it("creates one initial group for 30 non-separate entrants and never reseeds saved performances",()=>{
 const fresh:MeetEventData={participants:Array.from({length:30},(_,i)=>emptyPerformance("p"+i)),confirmed:false};
 expect(new Set(plan(fresh).initial(false).participants.map(p=>p.group))).toEqual(new Set([1]));
 expect(plan(fresh).initial(true).participants.at(-1)).toMatchObject({group:4,order:6});
 expect(plan().initial(false)).toBe(data);
});
it("keeps trials when unassigning and refuses malformed changes atomically",()=>{
 const next=plan().move(["a"],null);
 expect(next.participants[0]).toEqual({...a,group:null,order:null});
 expect(()=>plan().move(["a","a"],1)).toThrow();
 expect(()=>plan().swap(["a"])).toThrow();
 const full={...data,participants:[{...a,order:99},b,c]};
 expect(()=>plan(full).move(["c"],1)).toThrow("番号");
 expect(full.participants[2]).toBe(c);
});
