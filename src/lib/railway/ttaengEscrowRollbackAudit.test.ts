import {describe,expect,it} from "vitest";
import {reserveAuditTtaeng,resolveAuditTtaeng} from "./ttaengEscrowRollbackAudit.server";
describe("rollback-only ttaeng transfer boundaries",()=>{
  it("cannot be called without isolated staging one-shot flag",async()=>{
    const old=process.env["ANGEL_TTAENG_ROLLBACK_AUDIT"];
    delete process.env["ANGEL_TTAENG_ROLLBACK_AUDIT"];
    try{
      await expect(reserveAuditTtaeng(null as never,
        "00000000-0000-4000-8000-000000000001")).rejects.toThrow("AUDIT_ONLY");
      await expect(resolveAuditTtaeng(null as never,
        "00000000-0000-4000-8000-000000000001","SETTLED",null,2))
        .rejects.toThrow("AUDIT_ONLY");
    }finally{
      if(old===undefined)delete process.env["ANGEL_TTAENG_ROLLBACK_AUDIT"];
      else process.env["ANGEL_TTAENG_ROLLBACK_AUDIT"]=old;
    }
  });
});
