import {describe,expect,it} from "vitest";
import {
  calculateOriginalRake,calculateOriginalTtaengEscrow,
  originalTtaengSchedule,
} from "./originalGameFeePolicy.server";

const schedule={regular:500n,jang:1000n,gwang:1500n};
const reserved=(names:string[])=>Object.fromEntries(names.map(n=>[n,1500n]));
describe("original 2026-11-13 game-fee source parity (integer points)",()=>{
  it("takes 3% of actual winner payout and accrues 20% of rake to affiliate",()=>{
    const r=calculateOriginalRake([
      {accountId:"b",grossPayout:3000n,affiliateId:"agency"},
    ],"SUTDA2",true);
    expect(r).toMatchObject({
      grossTotal:3000n,feeTotal:90n,
      affiliateAccrualTotal:18n,companyRetainedTotal:72n,
      affiliatePaymentPosted:false,
    });
    expect(r.winners[0]).toMatchObject({
      netPayout:2910n,affiliateAccrual:18n,companyRetained:72n,
    });
  });
  it("uses cumulative winner rounding, not independent per-seat rounding",()=>{
    const r=calculateOriginalRake([
      {accountId:"b",grossPayout:17n,affiliateId:"agency"},
      {accountId:"a",grossPayout:17n,affiliateId:null},
    ],"DORI",true);
    expect(r.grossTotal).toBe(34n);
    expect(r.feeTotal).toBe(1n);
    expect(r.winners.map(x=>x.fee)).toEqual([1n,0n]);
    expect(r.affiliateAccrualTotal).toBe(0n);
    expect(r.affiliatePaymentPosted).toBe(false);
  });
  it("no affiliate means all rake remains company retained",()=>{
    const r=calculateOriginalRake([
      {accountId:"a",grossPayout:1000n,affiliateId:null},
    ],"SUTDA3",true);
    expect(r.feeTotal).toBe(30n);
    expect(r.affiliateAccrualTotal).toBe(0n);
    expect(r.companyRetainedTotal).toBe(30n);
  });
  it("refuses void/rematch, duplicate winners and negative payouts",()=>{
    const w=[{accountId:"a",grossPayout:1000n,affiliateId:null}];
    expect(()=>calculateOriginalRake(w,"SUTDA2",false)).toThrow("SETTLEMENT_NOT_FINAL");
    expect(()=>calculateOriginalRake([...w,...w],"SUTDA2",true)).toThrow("INVALID_WINNER_INPUT");
    expect(()=>calculateOriginalRake([{...w[0]!,grossPayout:-1n}],"DORI",true)).toThrow();
  });
});
describe("original Sutda ttaeng reservation and transfers",()=>{
  it("recognizes 1-9, jang, kwang and samttaeng and excludes normal hands",()=>{
    expect(originalTtaengSchedule("ttaeng1",schedule)).toBe(500n);
    expect(originalTtaengSchedule("ttaeng9",schedule)).toBe(500n);
    expect(originalTtaengSchedule("ttaeng10",schedule)).toBe(1000n);
    expect(originalTtaengSchedule("kwang38",schedule)).toBe(1500n);
    expect(originalTtaengSchedule("samttaeng10",schedule)).toBe(1500n);
    expect(originalTtaengSchedule("ali",schedule)).toBe(0n);
  });
  it("each loser pays 1500P to sole kwang winner out of escrow only",()=>{
    const players=["winner","loser1","loser2"];
    const r=calculateOriginalTtaengEscrow({
      mode:"SUTDA2",participants:players,
      reservations:reserved(players),status:"SETTLED",
      winnerId:"winner",winnerHandCode:"kwang38",nonFoldedCount:3,
      schedule,
    });
    expect(r.bonusPerLoser).toBe(1500n);
    expect(r.winnerBonus).toBe(3000n);
    expect(r.paidBy).toEqual({winner:0n,loser1:1500n,loser2:1500n});
    expect(r.refunds).toEqual({winner:1500n,loser1:0n,loser2:0n});
    expect(r.operatorFee).toBe(0n);
  });
  it("regular ttaeng returns unused escrow to each loser",()=>{
    const players=["a","b"];
    const r=calculateOriginalTtaengEscrow({
      mode:"SUTDA3",participants:players,
      reservations:reserved(players),status:"SETTLED",
      winnerId:"a",winnerHandCode:"ttaeng5",nonFoldedCount:2,schedule,
    });
    expect(r.winnerBonus).toBe(500n);
    expect(r.refunds).toEqual({a:1500n,b:1000n});
  });
  it.each(["REMATCH","VOID","REFUNDED"] as const)(
    "refunds full reservation for %s",status=>{
      const r=calculateOriginalTtaengEscrow({
        mode:"SUTDA2",participants:["a","b"],reservations:reserved(["a","b"]),
        status,winnerId:"a",winnerHandCode:"kwang38",nonFoldedCount:2,schedule,
      });
      expect(r.winnerBonus).toBe(0n);
      expect(r.refunds).toEqual({a:1500n,b:1500n});
    }
  );
  it("does not pay ttaeng when win results from everyone else folding",()=>{
    const r=calculateOriginalTtaengEscrow({
      mode:"SUTDA2",participants:["a","b"],reservations:reserved(["a","b"]),
      status:"SETTLED",winnerId:"a",winnerHandCode:"kwang38",
      nonFoldedCount:1,schedule,
    });
    expect(r.winnerBonus).toBe(0n);
    expect(r.refunds).toEqual({a:1500n,b:1500n});
  });
  it("rejects Dori and missing reserved money rather than charging after outcome",()=>{
    const i={
      participants:["a","b"],reservations:reserved(["a","b"]),
      status:"SETTLED" as const,winnerId:"a",winnerHandCode:"kwang38",
      nonFoldedCount:2,schedule,
    };
    expect(()=>calculateOriginalTtaengEscrow({...i,mode:"DORI"})).toThrow("TTAENG_NOT_FOR_DORI");
    expect(()=>calculateOriginalTtaengEscrow({
      ...i,mode:"SUTDA2",reservations:{a:1500n,b:1000n},
    })).toThrow("TTAENG_RESERVATION_MISMATCH");
  });
});
