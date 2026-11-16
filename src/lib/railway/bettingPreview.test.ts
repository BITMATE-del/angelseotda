import { describe,expect,it } from "vitest";
import { fromMilli,previewAdditionalAmount,previewActionOptions,toMilli } from "./bettingPreview.server";

describe("Railway read-only betting preview matches legacy amount math",()=>{
  const sample={
    pot:toMilli("1000"),currentBet:toMilli("400"),
    baseBet:toMilli("100"),stageBet:toMilli("100"),
    balance:toMilli("2000"),previousPaidActions:0
  };
  it("uses exact integer milli-points for decimals",()=>{
    expect(fromMilli(toMilli("11.009"))).toBe("11.009");
    expect(()=>toMilli("1.0009")).toThrow();
    expect(()=>toMilli("-1")).toThrow();
    expect(()=>toMilli("NaN")).toThrow();
  });
  it("computes amounts with the legacy SQL semantics",()=>{
    expect(fromMilli(previewAdditionalAmount("call",sample)!)).toBe("300.000");
    expect(fromMilli(previewAdditionalAmount("ping",sample)!)).toBe("400.000");
    expect(fromMilli(previewAdditionalAmount("ttadang",sample)!)).toBe("700.000");
    expect(fromMilli(previewAdditionalAmount("quarter",sample)!)).toBe("550.000");
    expect(fromMilli(previewAdditionalAmount("half",sample)!)).toBe("800.000");
    expect(fromMilli(previewAdditionalAmount("die",sample)!)).toBe("0.000");
    expect(fromMilli(previewAdditionalAmount("all_in",sample)!)).toBe("2000.000");
  });
  it("caps hypothetical debit to sample balance, never a wallet debit",()=>{
    expect(fromMilli(previewAdditionalAmount("half",{...sample,balance:toMilli("3")})!)).toBe("3.000");
    expect(fromMilli(previewAdditionalAmount("quarter",{
      ...sample,pot:toMilli("5.003"),currentBet:0n,stageBet:0n,baseBet:0n,
    })!)).toBe("1.250");
  });
  it("restricts unavailable actions in the same situation as the legacy UI",()=>{
    const options=previewActionOptions(sample);
    const enabled=(name:string)=>options.find(o=>o.action===name)?.enabled;
    expect(enabled("die")).toBe(true);
    expect(enabled("check")).toBe(false);
    expect(enabled("call")).toBe(true);
    expect(enabled("ping")).toBe(false);
    expect(enabled("all_in")).toBe(false);
    expect(previewActionOptions({...sample,previousPaidActions:2}).find(o=>o.action==="all_in")?.enabled).toBe(true);
  });
  it("rejects invalid state rather than producing negative credits",()=>{
    expect(()=>previewActionOptions({...sample,pot:-1n})).toThrow("INVALID_BET_STATE");
  });
});
