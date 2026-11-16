/**
 * Server-side, PURE preview showdown bridge. Does not query the DB, accept
 * browser winner/rank claims, write money, reveal cards, or post settlement.
 *
 * The caller must fetch server-owned private cards and selections. Because
 * the legacy settlement/rematch RPC is not fully ported, ties, GUSA special
 * cases and unavailable final selections are always BLOCKED, never paid.
 */
import { SUTDA_CARDS } from "@/data/sutdaCards";
import { contextualScores, evaluateSutda2 } from "@/lib/game/sutda2Rules";
import { evaluateSutda3 } from "@/lib/game/sutda3Rules";
import { doriBestMake, doriEffectiveRanks, validateDoriMake } from "@/lib/game/dori/doriRules";
import { calculateSidePots, type SidePotParticipant, type SidePotResult } from "./sidePotsPreview.server";

export type PreviewMode="SUTDA2"|"SUTDA3"|"DORI";
export type PreviewShowdownPlayer={
  accountId:string;seat:number;cards:readonly string[];
  contribution:string;folded:boolean;
  /** The selection must have been authenticated and saved by the SERVER. */
  selectedPair?:readonly string[];
  selectedMake?:readonly string[];
};
type HandPreview={accountId:string;seat:number;handName:string;handCode:string;rank:number};
export type ShowdownPreview=
  | {status:"READY_FOR_REVIEW";reason:"PROVISIONAL_RESULT";hands:HandPreview[];financialPreview:SidePotResult;realSettlement:false}
  | {status:"BLOCKED";reason:"SELECTION_REQUIRED"|"REMATCH_REQUIRED"|"SPECIAL_RULE_REVIEW"|"INVALID_CONTEST"|"POT_RULE_REVIEW";hands:HandPreview[];realSettlement:false};

const cardIds=new Set(SUTDA_CARDS.map(c=>c.id));
const idOk=/^[a-zA-Z0-9_-]{1,100}$/;
function blocked(reason:Extract<ShowdownPreview,{status:"BLOCKED"}>["reason"],hands:HandPreview[]):ShowdownPreview {
  return {status:"BLOCKED",reason,hands,realSettlement:false};
}
function selectionMatches(cards:readonly string[],selection:readonly string[],size:number):boolean{
  return selection.length===size && new Set(selection).size===size &&
    selection.every(id=>cards.includes(id));
}
export function evaluatePreviewShowdown(
  mode:PreviewMode,players:readonly PreviewShowdownPlayer[]
):ShowdownPreview {
  if(!["SUTDA2","SUTDA3","DORI"].includes(mode) ||
    players.length<2 || players.length>(mode==="DORI"?4:mode==="SUTDA3"?6:10))
    throw new Error("INVALID_SHOWDOWN_INPUT");
  const ids=new Set<string>(),seats=new Set<number>(),dealt=new Set<string>();
  const expected=mode==="DORI"?5:mode==="SUTDA3"?3:2;
  for(const p of players){
    if(!idOk.test(p.accountId)||ids.has(p.accountId)||
      !Number.isInteger(p.seat)||p.seat<1||p.seat>(mode==="DORI"?4:10)||seats.has(p.seat)||
      p.cards.length!==expected || new Set(p.cards).size!==expected)
      throw new Error("INVALID_SHOWDOWN_INPUT");
    ids.add(p.accountId);seats.add(p.seat);
    for(const id of p.cards){
      if(!cardIds.has(id)||dealt.has(id)) throw new Error("INVALID_OR_DUPLICATE_CARD");
      dealt.add(id);
    }
  }
  const active=players.filter(p=>!p.folded);
  if(!active.length) return blocked("INVALID_CONTEST",[]);
  // A single survivor wins by fold; no need to reveal anyone's cards.
  const raw: HandPreview[]=[];
  if(active.length===1){
    raw.push({accountId:active[0]!.accountId,seat:active[0]!.seat,
      handName:"상대 전원 다이",handCode:"FOLD_WIN",rank:1});
  } else if(mode==="SUTDA2" || mode==="SUTDA3"){
    const hands=[];
    for(const p of active){
      if(mode==="SUTDA3" && !selectionMatches(p.cards,p.selectedPair??[],2))
        return blocked("SELECTION_REQUIRED",[]);
      const hand=mode==="SUTDA2" ? evaluateSutda2(p.cards) :
        evaluateSutda3(p.selectedPair!);
      hands.push(hand);
    }
    if(hands.some(h=>h.category==="gusa"))
      return blocked("SPECIAL_RULE_REVIEW",[]);
    const scores=contextualScores(hands);
    active.forEach((p,i)=>raw.push({accountId:p.accountId,seat:p.seat,
      handName:hands[i]!.name,handCode:hands[i]!.code,rank:scores[i]!}));
  } else {
    const hands=[];
    for(const p of active){
      const possible=doriBestMake(p.cards);
      if(!possible.made) {
        // HWANG is an actual legacy Dori outcome, not an invalid selection.
        hands.push({hand:possible.hand,makeTotal:null});
        continue;
      }
      if(!p.selectedMake) return blocked("SELECTION_REQUIRED",[]);
      const validated=validateDoriMake(p.cards,p.selectedMake);
      if(!validated.ok || !validated.hand)
        return blocked("SELECTION_REQUIRED",[]);
      hands.push({hand:validated.hand,makeTotal:validated.makeTotal ?? null});
    }
    if(hands.some(x=>x.hand.code==="GUSA"||x.hand.code==="MUNG_GUSA"))
      return blocked("SPECIAL_RULE_REVIEW",[]);
    const scores=doriEffectiveRanks(hands.map(x=>({...x.hand,makeTotal:x.makeTotal})));
    active.forEach((p,i)=>raw.push({accountId:p.accountId,seat:p.seat,
      handName:hands[i]!.hand.label,handCode:hands[i]!.hand.code,rank:scores[i]!}));
  }
  // Rematches in the original game can carry the POT; never split a
  // tied main pot using the generic side-pot helper.
  const high=Math.max(...raw.map(h=>h.rank));
  if(raw.filter(h=>h.rank===high).length>1)
    return blocked("REMATCH_REQUIRED",raw);
  const ranking=new Map(raw.map(h=>[h.accountId,h.rank]));
  const participants:SidePotParticipant[]=players.map(p=>({
    accountId:p.accountId,seat:p.seat,contribution:p.contribution,
    folded:p.folded,rank:p.folded?null:ranking.get(p.accountId)??null
  }));
  try {
    const financialPreview=calculateSidePots(participants);
    // Reject ties in ANY side-pot layer, even if the overall high rank won.
    if(financialPreview.pots.some(p=>p.winnerSeats.length>1))
      return blocked("REMATCH_REQUIRED",raw);
    return {status:"READY_FOR_REVIEW",reason:"PROVISIONAL_RESULT",
      hands:raw,financialPreview,realSettlement:false};
  } catch{
    // No fallback payouts for unsupported folded-only or other edge cases.
    return blocked("POT_RULE_REVIEW",raw);
  }
}
