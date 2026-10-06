import { expect, it } from "vitest";
import { emptyPerformance, MeetEvent, MeetMark, type MeetPerformance } from "./meet-operations";
import { ObMeetRoster, obEventRule, reconcileObEvent } from "./ob-operations";
import { OB_DUTY_SLOTS } from "./ob-meet";
import type { ObEntry } from "./ob-entries";
const person=(id="a"):MeetPerformance=>({...emptyPerformance(id),trials:[{mark:"12.34",status:"valid",wind:"-0.5"}]});
const event=(participants=[person()],name="男子100m",confirmed=false)=>new MeetEvent(obEventRule(name),{participants,confirmed});
it.each([['12.34',1234],['4:12.34',25234],['1:02:03.45',372345],['0:60',null],['-1',null],['0',null],['12.345',null],['NaN',null]])('parses time %s without confusing seconds and decimals',(input,expected)=>expect(MeetMark.parse(input as string,'track')).toBe(expected));
it('chooses best valid distance and retains negative/zero wind',()=>{
  const p={...person(),trials:[{mark:'6.10',status:'valid' as const,wind:'0'},{mark:'6.20',status:'valid' as const,wind:'-0.5'},{mark:'',status:'foul' as const,wind:''}]};
  expect(event([p],'男子走り幅跳び').validate()).toBeNull();expect(event([p],'男子走り幅跳び').best(p)).toBe('6.20');
});
it('seeds only unassigned rows and preserves records, partial choices and DNS',()=>{
  const a={...person(),group:1,order:2},b=emptyPerformance('b'),c={...emptyPerformance('c'),group:3},d={...emptyPerformance('d'),status:'DNS' as const};
  const seeded=event([a,b,c,d]).seed(2);
  expect(seeded.participants).toEqual([a,{...b,group:1,order:1},c,d]);expect(a.trials[0].mark).toBe('12.34');
});
it('rejects duplicate athletes, occupied lanes and bad capacities',()=>{
  expect(event([person(),person()]).validate()).toContain('重複');
  expect(event([{...person(),group:1,order:1},{...person('b'),group:1,order:1}]).validate()).toContain('重複');
  expect(()=>event().seed(0)).toThrow();expect(()=>event().seed(1.5)).toThrow();
});
it('allows unfinished drafts but refuses premature confirmation',()=>{
  expect(event([emptyPerformance('a')]).validate()).toBeNull();expect(event([emptyPerformance('a')],'男子100m',true).validate()).toContain('未記録');
  expect(event([{...emptyPerformance('a'),status:'DNS'}],'男子100m',true).validate()).toBeNull();
});
it('validates high jump height even for failed and passed attempts',()=>{
  const p={...person(),trials:[{status:'foul' as const,mark:'1.50',wind:''},{status:'valid' as const,mark:'1.50',wind:''},{status:'pass' as const,mark:'1.55',wind:''}]};
  expect(event([p],'男子走り高跳び').validate()).toBeNull();expect(event([p],'男子走り高跳び').best(p)).toBe('1.50');
  p.trials[0].mark='';expect(event([p],'男子走り高跳び').validate()).toContain('高さ');
});
it('does not allow unsupported wind, excess attempts or pending values',()=>{
  expect(event([person()],'男子300m').validate()).toContain('風速');
  expect(event([{...person(),trials:[...person().trials,...person().trials]}]).validate()).toContain('試技数');
  expect(event([{...person(),trials:[{mark:'12',wind:'',status:'pending'}]}]).validate()).toContain('結果');
});
it('distinguishes own event, simultaneous other event, empty and relay',()=>{
  const slot=OB_DUTY_SLOTS.find(s=>s.label==='100m')!;
  expect(ObMeetRoster.cell({events:['男子100m']},slot).kind).toBe('competing');
  expect(ObMeetRoster.cell({events:['女子砲丸投げ']},slot).kind).toBe('concurrent');
  expect(ObMeetRoster.cell({events:['男子1500m']},slot).kind).toBe('empty');
  expect(ObMeetRoster.cell(undefined,OB_DUTY_SLOTS.at(-1)!).kind).toBe('on-day');
});
const entry=(id:string,grade='B1'):ObEntry=>({id,meet_key:'ob-2026',submitted_name:id,grade,events:['男子100m'],qualification_marks:{},revision:0,profile_id:id,imported_at:''});
it('includes alumni but never exposes them as linked duty candidates',()=>{
  const roster=new ObMeetRoster([entry('a'),entry('b','OB・OG')],[{id:'a',grade:'B1',display_name:'a'},{id:'b',grade:'B4',display_name:'b'}]);
  expect(roster.rows).toHaveLength(2);expect(roster.rows[1]).toMatchObject({alumni:true,linked:false});
});
it('retains withdrawn entrants records when reconciling new registrations',()=>{
  const old=person('old');const data=reconcileObEvent('男子100m',[entry('new')],{confirmed:false,participants:[old]});
  expect(data.participants).toEqual([old,emptyPerformance('new')]);
});
it("keeps generic order and participant limits while allowing OB order600 and separate physical scopes", () => {
  const a = { ...emptyPerformance("a"), group: 1, order: 600 };
  const rule = { name: "男子1500m", discipline: "track" as const, wind: false };
  expect(new MeetEvent(rule, { participants: [a], confirmed: false }).validate()).toContain("300");
  expect(new MeetEvent(rule, { participants: [a], confirmed: false }, { maxOrder: 600 }).validate()).toBeNull();
  const b = { ...a, entryId: "b", heatScope: "女子" as const };
  expect(new MeetEvent(rule, { participants: [a, b], confirmed: false }, { maxOrder: 600 }).validate()).toBeNull();
  expect(new MeetEvent(rule, { participants: [a, { ...b, heatScope: "男子" }], confirmed: false }, { maxOrder: 600 }).validate()).toContain("重複");
  expect(new MeetEvent(rule, { participants: Array.from({ length: 301 }, (_, i) => emptyPerformance(String(i))), confirmed: false }, { maxOrder: 600 }).validate()).toContain("出場者");
});
