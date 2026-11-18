import { describe, expect, it } from "vitest";
import { checkSandboxDebit } from "./sandboxLedger.server";
const input={
  roomId:"00000000-0000-4000-8000-000000000001",
  roundId:"00000000-0000-4000-8000-000000000002",
  actorId:"00000000-0000-4000-8000-000000000003",
  requestId:"sandbox_valid_request_001",amount:"10.000"
};
describe("sandbox debit rejects invalid untrusted parameters",()=>{
  it("accepts only strictly valid request shapes",()=>{
    expect(()=>checkSandboxDebit(input)).not.toThrow();
    expect(()=>checkSandboxDebit({...input,amount:"0"})).toThrow("INVALID_SANDBOX_DEBIT");
    expect(()=>checkSandboxDebit({...input,amount:"-2"})).toThrow("INVALID_SANDBOX_DEBIT");
    expect(()=>checkSandboxDebit({...input,amount:"1.0004"})).toThrow("INVALID_SANDBOX_DEBIT");
    expect(()=>checkSandboxDebit({...input,requestId:"x"})).toThrow("INVALID_SANDBOX_DEBIT");
    expect(()=>checkSandboxDebit({...input,actorId:"oops"})).toThrow("INVALID_SANDBOX_DEBIT");
  });
});
