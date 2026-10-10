import { expect, it } from "vitest";
import { emptyPerformance, type MeetPerformance, type MeetTrial } from "./meet-operations";
import { obEventRule } from "./ob-operations";
import { obResultRanks } from "./ob-result-ranking";
const trial=(mark:string,status:MeetTrial["status"]="valid"):MeetTrial=>({mark,status,wind:""});
const p=(entryId:string,trials:MeetTrial[],status:MeetPerformance["status"]="entered")=>({...emptyPerformance(entryId),trials,status});
it("ranks times numerically across groups, shares ties, skips DNS/DNF/DQ and empty marks",()=>{
 const rows=[p("slow",[trial("1:02.00")]),p("a",[trial("12.34")]),p("b",[trial("12.34")]),p("dns",[trial("11.00")],"DNS"),p("dnf",[],"DNF"),p("dq",[trial("10.00")],"DQ"),p("empty",[])];
 expect([...obResultRanks(obEventRule("男子100m"),rows)]).toEqual([["a",1],["b",1],["slow",3]]);
});
it("breaks a distance tie by the second and following valid marks, then retains a complete tie",()=>{
 const rows=[p("a",[trial("6.00"),trial("5.50")]),p("b",[trial("6.00"),trial("5.60")]),p("c",[trial("6.00"),trial("5.60")]),p("foul",[trial("","foul")])];
 expect([...obResultRanks(obEventRule("男子走り幅跳び"),rows)]).toEqual([["b",1],["c",1],["a",3]]);
});
it("uses misses at the cleared height, then misses up to it, excluding later misses",()=>{
 const rows=[p("a",[trial("1.20","foul"),trial("1.20"),trial("1.30"),trial("1.40","foul")]),p("b",[trial("1.20"),trial("1.30","foul"),trial("1.30")]),p("c",[trial("1.20"),trial("1.30"),trial("1.40","foul")])];
 expect([...obResultRanks(obEventRule("女子走り高跳び"),rows)]).toEqual([["c",1],["a",2],["b",3]]);
});
