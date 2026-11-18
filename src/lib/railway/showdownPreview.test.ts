import {describe,expect,it} from "vitest";
import {evaluatePreviewShowdown,type PreviewShowdownPlayer} from "./showdownPreview.server";

const player=(accountId:string,seat:number,cards:string[],contribution="100.000",
  extra:Partial<PreviewShowdownPlayer>={}):PreviewShowdownPlayer=>
  ({accountId,seat,cards,contribution,folded:false,...extra});

describe("original game hand rules -> side pot preview (no wallet effects)",()=>{
  it("2-card: respects original 38 gwang ranking and calculates 3% only as a preview",()=>{
    const result=evaluatePreviewShowdown("SUTDA2",[
      player("a",1,["03-gwang","08-gwang"]),
      player("b",2,["02-a","05-a"]),
    ]);
    expect(result.status).toBe("READY_FOR_REVIEW");
    if(result.status==="READY_FOR_REVIEW"){
      expect(result.hands[0]?.handCode).toBe("kwang38");
      expect(result.financialPreview.fee).toBe("6.000");
      expect(result.financialPreview.payouts).toEqual({a:"194.000",b:"0.000"});
      expect(result.realSettlement).toBe(false);
    }
  });
  it("blocks SUTDA3 until both players' server-backed final-pair selections exist",()=>{
    const a=player("a",1,["01-gwang","03-gwang","04-a"]);
    const b=player("b",2,["02-a","02-b","05-a"]);
    expect(evaluatePreviewShowdown("SUTDA3",[a,b])).toMatchObject({
      status:"BLOCKED",reason:"SELECTION_REQUIRED"
    });
    const result=evaluatePreviewShowdown("SUTDA3",[
      {...a,selectedPair:["01-gwang","03-gwang"]},
      {...b,selectedPair:["02-a","02-b"]},
    ]);
    expect(result.status).toBe("READY_FOR_REVIEW");
    if(result.status==="READY_FOR_REVIEW")expect(result.hands[0]?.handCode).toBe("kwang13");
  });
  it("Dori: never picks a clientless make; validates the chosen three cards",()=>{
    const a=player("a",1,["01-gwang","03-gwang","05-a","07-a","08-normal"]);
    const b=player("b",2,["02-a","04-a","06-a","08-gwang","10-a"]);
    expect(evaluatePreviewShowdown("DORI",[a,b])).toMatchObject({
      status:"BLOCKED",reason:"SELECTION_REQUIRED"
    });
    const result=evaluatePreviewShowdown("DORI",[
      {...a,selectedMake:["05-a","07-a","08-normal"]},
      {...b,selectedMake:["02-a","08-gwang","10-a"]},
    ]);
    expect(result.status).toBe("READY_FOR_REVIEW");
    if(result.status==="READY_FOR_REVIEW"){
      expect(result.hands[0]?.handCode).toBe("GWANG_13");
      expect(result.financialPreview.accountingBalanced).toBe(true);
    }
  });
  it("blocks tied hands instead of paying a generic split",()=>{
    const result=evaluatePreviewShowdown("SUTDA2",[
      player("a",1,["02-a","05-a"]),
      player("b",2,["03-normal","04-a"]),
    ]);
    expect(result).toMatchObject({status:"BLOCKED",reason:"REMATCH_REQUIRED",realSettlement:false});
    expect("financialPreview" in result).toBe(false);
  });
  it("blocks special GUSA cases pending the legacy rematch policy audit",()=>{
    const result=evaluatePreviewShowdown("SUTDA2",[
      player("a",1,["04-a","09-a"]),
      player("b",2,["02-a","06-a"]),
    ]);
    expect(result).toMatchObject({status:"BLOCKED",reason:"SPECIAL_RULE_REVIEW"});
  });
  it("fold-only win needs no reveal; ignores folded hand ranks",()=>{
    const result=evaluatePreviewShowdown("SUTDA2",[
      player("a",1,["01-gwang","02-a"]),
      player("b",2,["03-gwang","08-gwang"],"100.000",{folded:true}),
    ]);
    expect(result.status).toBe("READY_FOR_REVIEW");
    if(result.status==="READY_FOR_REVIEW"){
      expect(result.hands).toHaveLength(1);
      expect(result.hands[0]?.handCode).toBe("FOLD_WIN");
      expect(result.financialPreview.payouts["a"]).toBe("194.000");
    }
  });
  it("rejects duplicated card IDs and user IDs before any winner calculation",()=>{
    expect(()=>evaluatePreviewShowdown("SUTDA2",[
      player("a",1,["01-gwang","02-a"]),
      player("b",2,["01-gwang","05-a"])
    ])).toThrow("INVALID_OR_DUPLICATE_CARD");
    expect(()=>evaluatePreviewShowdown("SUTDA2",[
      player("a",1,["01-gwang","02-a"]),
      player("a",2,["03-normal","05-a"])
    ])).toThrow("INVALID_SHOWDOWN_INPUT");
  });
});
