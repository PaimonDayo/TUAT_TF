import { MeetMark } from "./meet-operations";
import type { ManagedMeetEvent, RelayTeamResult } from "./competition-meet";
import type { ParsedProgramRow } from "./competition-program";
import type { XlsxSheet } from "./xlsx-writer";

export function emptyRelayResults(): RelayTeamResult[] {
  return Array.from({length:6},(_,index)=>({lane:index+1,name:"",time:"",members:["","","",""]}));
}

export function validateRelayResults(teams: RelayTeamResult[], confirmed=false): string | null {
  if(!Array.isArray(teams)||teams.length!==6||teams.some((team,index)=>!team||team.lane!==index+1||typeof team.name!=="string"||typeof team.time!=="string"))return "1〜6レーンのチーム情報を確認してください";
  for(const team of teams){
    if(team.name.length>100)return `${team.lane}レーンのチーム名は100文字以内で入力してください`;
    if(!Array.isArray(team.members)||team.members.length!==4||team.members.some(name=>typeof name!=="string"||name.length>100))return `${team.lane}レーンの1走〜4走の氏名を確認してください`;
    if(team.members.some(name=>name.trim())&&!team.name.trim())return `${team.lane}レーンのチーム名を入力してください`;
    if(team.time&&(!team.name.trim()||MeetMark.parse(team.time,"track")===null))return `${team.lane}レーンのチーム名とタイムを確認してください`;
    if(confirmed&&team.name.trim()&&!team.time)return `${team.lane}レーンのタイムを入力してから確定してください`;
  }
  if(confirmed&&!teams.some(team=>team.name.trim()))return "チームを入力してから確定してください";
  return null;
}

export function formatRelayTime(value:string) {
  const text=value.normalize("NFKC").trim();
  return /^\d{5,7}$/.test(text)?`${Number(text.slice(0,-4))}:${text.slice(-4,-2)}.${text.slice(-2)}`:text;
}

export type RelayConflict={key:string;lane:number;field:string;label:string;own:string;current:string};
export function reviewRelayResults(base:RelayTeamResult[],draft:RelayTeamResult[],latest:RelayTeamResult[],choices:Record<string,"own"|"current">={}) {
  const conflicts:RelayConflict[]=[];
  const teams=latest.map((team,index)=>{
    const next={...team,members:[...team.members] as RelayTeamResult["members"]};
    const fields=[{field:"name",label:"チーム名",own:draft[index].name,before:base[index].name,current:team.name},{field:"time",label:"タイム",own:draft[index].time,before:base[index].time,current:team.time},...team.members.map((current,runner)=>({field:`member${runner}`,label:`${runner+1}走`,own:draft[index].members[runner],before:base[index].members[runner],current}))];
    for(const {field,label,own,before,current} of fields){
      const key=`${team.lane}:${field}`;
      const assign=(value:string)=>{if(field==="name"||field==="time")next[field]=value;else next.members[Number(field.slice(6))]=value;};
      if(own===before)continue;
      if(current===before||current===own){assign(own);continue;}
      conflicts.push({key,lane:team.lane,field,label,own,current});
      assign(choices[key]==="own"?own:current);
    }
    return next;
  });
  return {teams,conflicts};
}

export function relayRanks(teams:RelayTeamResult[]) {
  const finished=teams.flatMap(team=>{
    const value=team.name.trim()?MeetMark.parse(team.time,"track"):null;
    return value===null?[]:[{lane:team.lane,value}];
  }).sort((a,b)=>a.value-b.value);
  const ranks=new Map<number,number>();let rank=0;
  finished.forEach((team,index)=>{if(!index||finished[index-1].value!==team.value)rank=index+1;ranks.set(team.lane,rank);});
  return ranks;
}

export function relayResultRow(event:ManagedMeetEvent,date:string):ParsedProgramRow {
  const teams=event.relay_results??[],ranks=relayRanks(teams);
  return {eventDate:date,block:"track",sortOrder:event.sort_order,timeLabel:event.starts_at,roundKey:event.name,
    eventLabel:`混合 ${event.name}`,status:event.confirmed?"確定":"速報",
    tuatEntries:teams.filter(team=>team.name.trim()).map(team=>({id:`${event.name}:${team.lane}`,name:team.name,grade:"",heat:1,lane:team.lane,bib:null,positionLabel:`${team.lane}レーン`,separateResult:true,details:team.members.flatMap((name,index)=>name.trim()?[`${index+1}走 ${name}`]:[]),
      ...(team.time?{result:{place:ranks.has(team.lane)?String(ranks.get(team.lane)):null,record:team.time}}:{})}))};
}

export function relayResultSheet(event:ManagedMeetEvent):XlsxSheet {
  const teams=event.relay_results??[],ranks=relayRanks(teams);
  return {name:event.name,widths:[8,24,14,8,20,20,20,20],rows:[["レーン","チーム名","タイム","順位","1走","2走","3走","4走"],...teams.map(team=>[team.lane,team.name,team.time,ranks.get(team.lane)??"",...team.members])]};
}
