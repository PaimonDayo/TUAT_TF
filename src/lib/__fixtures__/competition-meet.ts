import {emptyPerformance} from "../meet-operations";
import type {CompetitionMeet} from "../competition-meet";
export function fixtureMeet(): CompetitionMeet {
  return { competitionId: "meet", meetKey: "meet", name: "合成対抗戦", backend: "pc", members: [], party: [{id:"private-party",participant_id:"one",name:"個人回答",group_label:"",status:"参加",needs_review:false,revision:0}], permissions:{manage:true,record:true,groups:true,configure:false},
    participants: ["one","two","three"].map((id,i)=>({id,competition_id:"meet",profile_id:`private-profile-${id}`,name:i===2?"交代候補":`同姓 同名`,grade:`B${i+1}`,absent:false,deleted:false,revision:0})),
    events: [{competition_id:"meet",name:"男子100m",family:"100m",division:"男子",starts_at:"10:00",sort_order:0,discipline:"track",wind:true,capacity:8,confirmed:false,revision:0},{competition_id:"meet",name:"女子走幅跳",family:"走幅跳",division:"女子",starts_at:"10:00",sort_order:1,discipline:"distance",wind:true,capacity:null,confirmed:false,revision:0}],
    appearances: ["a","b","c"].map((id,i)=>({id,competition_id:"meet",participant_id:i===2?"two":"one",event_name:i===2?"女子走幅跳":"男子100m",ordinal:i===1?3:1,operation_key:`private-key-${id}`,qualification_mark:"private qualification",state:"registered",revision:0,performance:{...emptyPerformance(id),group:1,order:i+1,trials:[{mark:i===0?"11.00":i===1?"12.00":"5.00",status:"valid",wind:"+1.0"}]}})),
    duties: [{id:"d",participant_id:"one",slot_time:"10:00",event_name:"走幅跳",assignment:"",role_ids:["r"],revision:0,source:"manual"},{id:"e",participant_id:"three",slot_time:"10:00",event_name:"走幅跳",assignment:"",role_ids:["r"],revision:0,source:"manual"}],
    roles:[{id:"r",slot_time:"10:00",event_name:"走幅跳",name:"計測",required_count:2,revision:0}], program:[{time:"11:00",label:"リレー",events:[],note:"当日確認"}],
  };
}