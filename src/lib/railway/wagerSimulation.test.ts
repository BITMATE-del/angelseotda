import {describe,expect,it} from "vitest";
import {applySimAction,newSimState,simPublicView} from "./wagerSimulation.server";

describe("no-money server wager simulator",()=>{
  it("check/check closes an uncontested zero-pot phase",()=>{
    let s=newSimState([2,1],"100");
    expect(s.turnSeat).toBe(1);
    s=applySimAction(s,1,"check");
    expect(s.turnSeat).toBe(2);
    s=applySimAction(s,2,"check");
    expect(s.complete).toBe(true);
    expect(s.pot).toBe("0.000");
    expect(()=>applySimAction(s,2,"check")).toThrow("SIM_ROUND_COMPLETE");
  });
  it("a raise reopens an already checked player's action",()=>{
    let s=newSimState([1,2,3],"100");
    s=applySimAction(s,1,"check");
    s=applySimAction(s,2,"ping"); // 100P raise
    expect(s.currentBet).toBe("100.000");
    expect(s.pending).toEqual([1,3]);
    expect(s.turnSeat).toBe(3);
    s=applySimAction(s,3,"call");
    expect(s.turnSeat).toBe(1);
    s=applySimAction(s,1,"call");
    expect(s.complete).toBe(true);
    expect(s.pot).toBe("300.000");
    expect(s.players.map(p=>p.credit)).toEqual(["900.000","900.000","900.000"]);
    expect(s.players.map(p=>p.contributed)).toEqual(["100.000","100.000","100.000"]);
  });
  it("folded seats are skipped; no money is transferred to wallets",()=>{
    let s=newSimState([1,2,3],"100");
    s=applySimAction(s,1,"ping");
    s=applySimAction(s,2,"die");
    expect(s.turnSeat).toBe(3);
    s=applySimAction(s,3,"call");
    expect(s.complete).toBe(true);
    expect(simPublicView(s,1).foldedSeats).toEqual([2]);
    expect(s.pot).toBe("200.000");
  });
  it("disallows checking when call owed and blocks out of turn",()=>{
    let s=newSimState([1,2],"100");
    expect(()=>applySimAction(s,2,"check")).toThrow("NOT_YOUR_TURN");
    expect(()=>applySimAction(s,1,"call")).toThrow("CALL_NOT_ALLOWED");
    expect(()=>applySimAction(s,1,"all_in")).toThrow("ALL_IN_TOO_EARLY");
    s=applySimAction(s,1,"ping");
    expect(()=>applySimAction(s,2,"check")).toThrow("CHECK_NOT_ALLOWED");
    s=applySimAction(s,2,"call");
    expect(s.complete).toBe(true);
  });
  it("all-in requires two paid actions, enforces virtual credit ceiling and finishes phase",()=>{
    let s=newSimState([1,2,3],"10");
    s=applySimAction(s,1,"ping");
    s=applySimAction(s,2,"call");
    s=applySimAction(s,3,"all_in");
    expect(s.currentBet).toBe("100.000");
    expect(s.players[2]?.credit).toBe("0.000");
    s=applySimAction(s,1,"call");
    s=applySimAction(s,2,"call");
    expect(s.complete).toBe(true);
    expect(s.pot).toBe("300.000");
    expect(simPublicView(s,2).allInSeats).toEqual([1,2,3]);
  });
  it("hides other players credit and returns my allowable actions only",()=>{
    const s=newSimState([1,2],"10");
    const p=simPublicView(s,2);
    expect(p.availableActions).toEqual([]);
    expect(Object.keys(p)).not.toContain("players");
    expect(simPublicView(s,1).availableActions).toContain("ping");
  });
  it("rejects invalid setup",()=>{
    expect(()=>newSimState([1,1],"100")).toThrow();
    expect(()=>newSimState([1,2],"0")).toThrow();
    expect(()=>newSimState([1,2],"1.0009")).toThrow();
  });
});
