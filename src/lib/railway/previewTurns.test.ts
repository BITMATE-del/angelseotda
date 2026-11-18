import {describe,expect,it} from "vitest";
import {derivePreviewTurnState} from "./previewTurns.server";

describe("staging server-only CHECK/FOLD turn state",()=>{
  it("completes two-player CHECK/CHECK in seat order",()=>{
    expect(derivePreviewTurnState([3,1],[{seat:1,action:"CHECK"}])).toEqual({
      complete:false,turnSeat:3,activeSeats:[1,3],foldedSeats:[],actedSeats:[1],
    });
    expect(derivePreviewTurnState([3,1],[
      {seat:1,action:"CHECK"},{seat:3,action:"CHECK"},
    ])).toEqual({
      complete:true,turnSeat:null,activeSeats:[1,3],foldedSeats:[],actedSeats:[1,3],
    });
  });
  it("ends immediately if the first player folds in a two-player round",()=>{
    expect(derivePreviewTurnState([1,2],[{seat:1,action:"FOLD"}])).toEqual({
      complete:true,turnSeat:null,activeSeats:[2],foldedSeats:[1],actedSeats:[1],
    });
  });
  it("skips folded seats when choosing the next actor",()=>{
    const result=derivePreviewTurnState([1,3,5,8],[
      {seat:1,action:"FOLD"},{seat:3,action:"CHECK"},
      {seat:5,action:"FOLD"},
    ]);
    expect(result).toEqual({
      complete:false,turnSeat:8,activeSeats:[3,8],foldedSeats:[1,5],
      actedSeats:[1,3,5],
    });
    expect(derivePreviewTurnState([1,3,5,8],[
      {seat:1,action:"FOLD"},{seat:3,action:"CHECK"},
      {seat:5,action:"FOLD"},{seat:8,action:"CHECK"},
    ]).complete).toBe(true);
  });
  it("refuses out-of-turn, repeated, post-complete, and missing seats",()=>{
    const seats=[1,2,3];
    expect(()=>derivePreviewTurnState(seats,[{seat:2,action:"CHECK"}])).toThrow();
    expect(()=>derivePreviewTurnState(seats,[
      {seat:1,action:"CHECK"},{seat:1,action:"FOLD"},
    ])).toThrow();
    expect(()=>derivePreviewTurnState([1,2],[
      {seat:1,action:"FOLD"},{seat:2,action:"CHECK"},
    ])).toThrow();
    expect(()=>derivePreviewTurnState(seats,[
      {seat:1,action:"FOLD"},{seat:2,action:"FOLD"},{seat:3,action:"CHECK"},
    ])).toThrow();
    expect(()=>derivePreviewTurnState([1,1],[])).toThrow();
    expect(()=>derivePreviewTurnState([0,1],[])).toThrow();
  });
});
