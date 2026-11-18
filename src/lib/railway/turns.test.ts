import { describe,expect,it } from "vitest";
import { nextPreviewSeat } from "./rounds.server";

describe("non-monetary preview turn progression",()=>{
  it("advances exactly one seat and skips actors who passed",()=>{
    expect(nextPreviewSeat([1,3,7],1,[])).toEqual({nextSeat:3,complete:false,actedCount:1});
    expect(nextPreviewSeat([1,3,7],3,[1])).toEqual({nextSeat:7,complete:false,actedCount:2});
    expect(nextPreviewSeat([1,3,7],7,[1,3])).toEqual({nextSeat:7,complete:true,actedCount:3});
  });
  it("rejects repeated action and invalid seat lists",()=>{
    expect(()=>nextPreviewSeat([1,3],1,[1])).toThrow("INVALID_PREVIEW_TURN_STATE");
    expect(()=>nextPreviewSeat([1,1],1,[])).toThrow("INVALID_PREVIEW_TURN_STATE");
    expect(()=>nextPreviewSeat([1,3],2,[])).toThrow("INVALID_PREVIEW_TURN_STATE");
    expect(()=>nextPreviewSeat([1,3],1,[9])).toThrow("INVALID_PREVIEW_TURN_STATE");
    expect(()=>nextPreviewSeat([1],1,[])).toThrow("INVALID_PREVIEW_TURN_STATE");
  });
});
