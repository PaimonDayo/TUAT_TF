import { expect, it } from "vitest";
import { formatObRecordInput } from "./ob-record-input";
it.each([["1234","100m","12.34"],["41234","1500m","4:12.34"],["91234","3000m","9:12.34"],["536","走り幅跳び","5.36"],["１２３４","100m","12.34"],["12.34","100m","12.34"],["4:12.34","1500m","4:12.34"],["12","100m","12"],["","100m",""]])("formats %s for %s only when enough digits are present",(value,family,result)=>expect(formatObRecordInput(value,family)).toBe(result));
