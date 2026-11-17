import {describe,expect,it} from "vitest";
import {calculateSimulationShowdown} from "./simulatedShowdown.server";
import {applySimAction,newSimState} from "./wagerSimulation.server";

const hands=[
  {seat:1,accountId:"alice",cards:["03-gwang","08-gwang"]},
  {seat:2,accountId:"bob",cards:["02-a","05-a"]},
] as const;
describe("server-only simulated showdown integrates betting and cards",()=>{
  it("requires completed simulation",()=>{
    expect(calculateSimulationShowdown("SUTDA2",newSimState([1,2],"10"),hands))
      .toEqual({status:"WAITING_FOR_BETS",realSettlement:false});
  });
  it("derives 3% fee and payout from matched simulated wagers",()=>{
    let s=newSimState([1,2],"10");
    s=applySimAction(s,1,"ping");
    s=applySimAction(s,2,"call");
    const result=calculateSimulationShowdown("SUTDA2",s,hands);
    expect(result).toEqual({
      status:"CALCULATED",pot:"20.000",fee:"0.600",
      payouts:[{seat:1,amount:"19.400"},{seat:2,amount:"0.000"}],
      winnerSeats:[1],realSettlement:false,
    });
  });
  it("fold victory omits opponent hand ranking",()=>{
    let s=newSimState([1,2],"10");
    s=applySimAction(s,1,"ping");
    s=applySimAction(s,2,"die");
    const result=calculateSimulationShowdown("SUTDA2",s,hands);
    expect(result.status).toBe("CALCULATED");
    if(result.status==="CALCULATED"){
      expect(result.winnerSeats).toEqual([1]);
      expect(result.pot).toBe("10.000");
      expect(result.fee).toBe("0.300");
      expect(result.payouts).toEqual([
        {seat:1,amount:"9.700"},{seat:2,amount:"0.000"},
      ]);
    }
  });
  it("refuses mismatched or duplicate private hand mapping",()=>{
    let s=newSimState([1,2],"10");
    s=applySimAction(s,1,"ping");s=applySimAction(s,2,"call");
    expect(()=>calculateSimulationShowdown("SUTDA2",s,[hands[0]!]))
      .toThrow("SIM_SHOWDOWN_PLAYER_MISMATCH");
    expect(()=>calculateSimulationShowdown("SUTDA2",s,[hands[0]!,hands[0]!]))
      .toThrow("SIM_SHOWDOWN_DUPLICATE_SEAT");
    expect(()=>calculateSimulationShowdown("SUTDA2",{...s,pot:"1.000"},hands))
      .toThrow("SIM_SHOWDOWN_POT_MISMATCH");
  });
  it("blocks final pair not selected instead of calculating money",()=>{
    let s=newSimState([1,2],"10");
    s=applySimAction(s,1,"ping");s=applySimAction(s,2,"call");
    const three=[
      {seat:1,accountId:"alice",cards:["03-gwang","08-gwang","01-gwang"]},
      {seat:2,accountId:"bob",cards:["02-a","05-a","06-a"]},
    ];
    expect(calculateSimulationShowdown("SUTDA3",s,three))
      .toMatchObject({status:"BLOCKED",reason:"SELECTION_REQUIRED",realSettlement:false});
  });
});
