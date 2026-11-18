import { describe,expect,it } from "vitest";
import { calculateSidePots, type SidePotParticipant } from "./sidePotsPreview.server";

const p=(id:string,seat:number,contribution:string,rank:number|null,folded=false):SidePotParticipant=>
  ({accountId:id,seat,contribution,rank,folded});
const amount=(o:Record<string,string>)=>Object.values(o).reduce((sum,v)=>sum+BigInt(v.replace(".","")),0n);

describe("staging side-pot and fee preview (never settles money)",()=>{
  it("splits unequal all-ins into main and side pot and returns the uncalled excess",()=>{
    const r=calculateSidePots([p("alice",1,"100",3),p("bob",2,"200",2),p("carol",3,"300",1)]);
    expect(r.grossPot).toBe("600.000");
    expect(r.contestablePot).toBe("500.000");
    expect(r.uncalledRefunds).toEqual({alice:"0.000",bob:"0.000",carol:"100.000"});
    expect(r.pots).toEqual([
      {amount:"300.000",eligibleSeats:[1,2,3],winnerSeats:[1]},
      {amount:"200.000",eligibleSeats:[2,3],winnerSeats:[2]},
    ]);
    expect(r.fee).toBe("15.000");
    expect(r.payouts).toEqual({alice:"291.000",bob:"194.000",carol:"100.000"});
  });
  it("folded contributions remain in the pot, but folded players never win",()=>{
    const r=calculateSidePots([p("alice",1,"100",5),p("bob",2,"100",null,true),p("carol",3,"100",2)]);
    expect(r.fee).toBe("9.000");
    expect(r.payouts).toEqual({alice:"291.000",bob:"0.000",carol:"0.000"});
  });
  it("splits tied ranks and distributes an odd milli-point to the lowest seat",()=>{
    const r=calculateSidePots([p("bob",2,"0.001",4),p("alice",1,"0.001",4),p("carol",3,"0.001",2)]);
    expect(r.pots[0]?.winnerSeats).toEqual([1,2]);
    expect(r.payouts).toEqual({alice:"0.002",bob:"0.001",carol:"0.000"});
    expect(r.fee).toBe("0.000");
  });
  it("uses exactly 3% of contestable pot, rounded down to 0.001P once",()=>{
    const r=calculateSidePots([p("one",1,"1.111",8),p("two",2,"1.111",7)]);
    expect(r.contestablePot).toBe("2.222");
    expect(r.fee).toBe("0.066");
    expect(r.payouts["one"]).toBe("2.156");
    expect(r.accountingBalanced).toBe(true);
  });
  it("rejects missing winners, duplicate users and unresolvable folded-only side pots",()=>{
    expect(()=>calculateSidePots([p("a",1,"1",null,true),p("b",2,"1",null,true)])).toThrow("NO_ELIGIBLE_WINNER");
    expect(()=>calculateSidePots([p("a",1,"1",2),p("a",2,"2",3)])).toThrow("INVALID_SETTLEMENT_PARTICIPANT");
    expect(()=>calculateSidePots([p("a",1,"1",2),p("b",1,"2",3)])).toThrow("INVALID_SETTLEMENT_PARTICIPANT");
    expect(()=>calculateSidePots([p("a",1,"1",2),p("b",2,"2",null,true),p("c",3,"2",null,true)])).toThrow("UNRESOLVABLE_SIDE_POT");
  });
  it("rejects unsupported rake and unauthorized rank shapes",()=>{
    const players=[p("a",1,"1",2),p("b",2,"1",1)];
    expect(()=>calculateSidePots(players,0)).toThrow("UNVERIFIED_FEE_RULE");
    expect(()=>calculateSidePots([p("a",1,"1",2.5),p("b",2,"1",1)])).toThrow("INVALID_SETTLEMENT_PARTICIPANT");
    expect(amount(calculateSidePots(players).payouts)).toBe(1940n);
  });
});
