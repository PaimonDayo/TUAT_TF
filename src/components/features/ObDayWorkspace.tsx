"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ObOperations } from "./ObOperations";
import { ObDayRegistration } from "./ObDayRegistration";
import type { ObEntry } from "@/lib/ob-entries";
import type { EntryMember } from "@/lib/entry-identity";
import type { ObDuty,ObDutyRole } from "@/lib/ob-duty";
import type { ObEventOperation } from "@/lib/ob-operations";

export function ObDayWorkspace({entries,members,duties,roles,operations,canRegister}:{entries:ObEntry[];members:EntryMember[];duties:ObDuty[];roles:ObDutyRole[];operations:ObEventOperation[];canRegister:boolean}) {
  const [adding,setAdding]=useState<string|null>(null);
  const [savedOperations,setSavedOperations]=useState<ObEventOperation[]>([]);
  const router=useRouter();
  const latest=new Map(operations.map(operation=>[operation.event_name,operation]));
  for(const operation of savedOperations) if(operation.revision>(latest.get(operation.event_name)?.revision??-1)) latest.set(operation.event_name,operation);
  const current=[...latest.values()];
  return <><ObOperations entries={entries} members={members} duties={duties} roles={roles} initial={current} canEditDuties={canRegister} onAddEntry={canRegister?setAdding:undefined}/>{adding!==null&&<ObDayRegistration event={adding||undefined} entries={entries} operations={current} onSaved={(_,saved)=>{if(saved)setSavedOperations(values=>[...values.filter(value=>value.event_name!==saved.event_name),saved]);router.refresh();}} onClose={()=>setAdding(null)}/>}</>;
}
