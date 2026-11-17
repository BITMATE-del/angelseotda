import {describe,expect,it} from "vitest";
import {applyRollbackOnlySettlement} from "./settlementRollbackAudit.server";

describe("rollback settlement cannot be called from ordinary app runtime",()=>{
  it("refuses any call without a short-lived audit opt-in, before DB use",async()=>{
    const old=process.env['ANGEL_SETTLEMENT_ROLLBACK_AUDIT'];
    delete process.env['ANGEL_SETTLEMENT_ROLLBACK_AUDIT'];
    try{
      await expect(applyRollbackOnlySettlement(
        null as never,"00000000-0000-4000-8000-000000000001"
      )).rejects.toThrow("AUDIT_ONLY");
    }finally{
      if(old===undefined)delete process.env['ANGEL_SETTLEMENT_ROLLBACK_AUDIT'];
      else process.env['ANGEL_SETTLEMENT_ROLLBACK_AUDIT']=old;
    }
  });
});
