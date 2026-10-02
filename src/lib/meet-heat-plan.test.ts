import {expect, it} from "vitest";
import {MeetHeatPlan} from "./meet-heat-plan";
import {emptyPerformance, MeetEvent, type MeetEventData} from "./meet-operations";
const a={...emptyPerformance("a"),group:1,order:1,trials:[{mark:"12.34",status:"valid" as const,wind:"0"}]};
const b={...emptyPerformance("b"),group:2,order:2};
const c=emptyPerformance("c");
const data:MeetEventData={participants:[a,b,c],confirmed:false};
const plan=(d=data)=>new MeetHeatPlan(d,new Set(["a","b","c"]));
it("moves several people atomically and keeps trials and original data",()=>{
 const next=plan().assign(["b","c"],1,3);
 expect(next.participants.map(p=>[p.group,p.order])).toEqual([[1,1],[1,2],[1,3]]);
 expect(next.participants[0].trials).toEqual(a.trials);expect(data.participants[1]).toBe(b);
 expect(()=>plan().assign(["b","c"],1,2)).toThrow("空き");expect(b.group).toBe(2);
});
it("swaps across groups without duplicates and releases displaced people to unassigned",()=>{
 const swapped=plan().place("a",2,2);
 expect(swapped.participants.slice(0,2).map(p=>[p.group,p.order])).toEqual([[2,2],[1,1]]);
 expect(new MeetEvent({name:"100m",discipline:"track",wind:true},swapped).validate()).toBeNull();
 expect(plan().place("c",1,1).participants[0]).toEqual({...a,group:null,order:null});
 expect(plan().place("a",1,1)).toBe(data);
});
it("keeps prior assignments while filling partial and new entries, excluding DNS and withdrawn",()=>{
 const dns={...emptyPerformance("dns"),status:"DNS" as const};
 const old={...emptyPerformance("old"),group:1,order:2};
 const next=plan({...data,participants:[a,b,{...c,group:5},dns,old]}).fill(2);
 expect(next.participants[2]).toEqual({...c,group:2,order:1});expect(next.participants[4]).toBe(old);
 expect(()=>plan({...data,participants:[a,b,c,dns,old]}).assign(["dns"],1,3)).toThrow();
 expect(()=>plan({...data,participants:[a,b,c,dns,old]}).place("c",1,2)).toThrow("取消");
});
it("unassigns without removing results and clears confirmation only when changed",()=>{
 const confirmed={...data,confirmed:true};
 expect(plan(confirmed).unassign(["a"]).participants[0]).toEqual({...a,group:null,order:null});
 expect(plan(confirmed).unassign(["a"]).confirmed).toBe(false);
 expect(plan(confirmed).unassign(["c"])).toBe(confirmed);
});
it("rejects invalid positions and duplicate selections",()=>{
 for(const n of [0,100,1.5,NaN])expect(()=>plan().assign(["c"],1,n)).toThrow();
 expect(()=>plan().assign(["c","c"],1,8)).toThrow();
 expect(()=>plan().place("missing",1,2)).toThrow();
});
