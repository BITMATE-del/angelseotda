import {describe,expect,it} from "vitest";
import {validateFinalChoice} from "./finalChoices.server";

describe("staging server final selections",()=>{
  it("accepts verified Sutda3 owned final pair",()=>{
    const r=validateFinalChoice("SUTDA3",
      ["01-gwang","03-gwang","05-a"],["01-gwang","03-gwang"]);
    expect(r.handCode).toBe("kwang13");
    expect(r.selected).toHaveLength(2);
  });
  it("rejects other member cards, duplicates and mismatched counts",()=>{
    expect(()=>validateFinalChoice("SUTDA3",
      ["01-gwang","03-gwang","05-a"],["01-gwang","02-a"])).toThrow("INVALID_FINAL_CHOICE");
    expect(()=>validateFinalChoice("SUTDA3",
      ["01-gwang","03-gwang","05-a"],["01-gwang","01-gwang"])).toThrow("INVALID_FINAL_CHOICE");
    expect(()=>validateFinalChoice("SUTDA3",
      ["01-gwang","03-gwang","05-a"],["01-gwang"])).toThrow("INVALID_FINAL_CHOICE");
  });
  it("enforces Dori make total 10/20/30 from own actual cards",()=>{
    const cards=["01-gwang","03-gwang","05-a","07-a","08-normal"];
    const r=validateFinalChoice("DORI",cards,["05-a","07-a","08-normal"]);
    expect(r.handCode).toBe("GWANG_13");
    expect(()=>validateFinalChoice("DORI",cards,["01-gwang","03-gwang","05-a"])).toThrow("INVALID_DORI_MAKE");
  });
});
