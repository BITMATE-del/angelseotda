/**
 * Railway staging-only SIDE-POT SETTLEMENT CALCULATOR.
 * This is a pure, non-mutating model, NOT the legacy settlement RPC.
 * Rankings MUST be supplied by a trusted server evaluator, never user input.
 *
 * Provisional accounting policy pending parity audit:
 * - unmatched single-player excess is returned before POT fee
 * - gross contestable POT fee = floor(3%) to 0.001P, once per round
 * - tied wins share each side pot; remainder goes to lower seat
 * - the fee is allocated proportionally across winners' GROSS payouts
 * These rules are NOT activated for real wallets or settlement.
 */
import {fromMilli,toMilli} from "./bettingPreview.server";

export type SidePotParticipant={
  accountId:string;
  seat:number;
  contribution:string;
  folded:boolean;
  /** Server-evaluated hand rank. Null ONLY for folded players. */
  rank:number|null;
};
export type ComputedSidePot={
  amount:string;eligibleSeats:number[];
  winnerSeats:number[];
};
export type SidePotResult={
  grossPot:string;contestablePot:string;uncalledRefunds:Record<string,string>;
  fee:string;prizePool:string;
  payouts:Record<string,string>;
  pots:ComputedSidePot[];
  accountingBalanced:true;
};
const MAX_PLAYERS=10;
const MAX_RANK=1_000_000_000;
const numSort=(a:bigint,b:bigint)=>a<b?-1:a>b?1:0;
const sum=(xs:bigint[])=>xs.reduce((a,b)=>a+b,0n);

export function calculateSidePots(participants:readonly SidePotParticipant[],feeBps=300):SidePotResult {
  if (!Number.isInteger(feeBps) || feeBps!==300) throw new Error("UNVERIFIED_FEE_RULE");
  if (participants.length<2 || participants.length>MAX_PLAYERS) throw new Error("INVALID_PLAYER_COUNT");
  const ids=new Set<string>(),seats=new Set<number>();
  const players=participants.map(p=>{
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(p.accountId) || ids.has(p.accountId) ||
       !Number.isInteger(p.seat) || p.seat<1 || p.seat>10 || seats.has(p.seat) ||
       (p.folded ? p.rank!==null : !Number.isSafeInteger(p.rank) || (p.rank??-1)<0 || (p.rank??MAX_RANK)>MAX_RANK))
      throw new Error("INVALID_SETTLEMENT_PARTICIPANT");
    ids.add(p.accountId);seats.add(p.seat);
    const committed=toMilli(p.contribution);
    return {...p,committed};
  }).sort((a,b)=>a.seat-b.seat);
  const alive=players.filter(p=>!p.folded);
  if(alive.length===0) throw new Error("NO_ELIGIBLE_WINNER");
  const totals=new Map(players.map(p=>[p.accountId,0n]));
  const refunds=new Map(players.map(p=>[p.accountId,0n]));
  const levels=[...new Set(players.map(p=>p.committed).filter(n=>n>0n))].sort(numSort);
  const pots:ComputedSidePot[]=[];
  let previous=0n,contestable=0n;
  for(const ceiling of levels){
    const entrants=players.filter(p=>p.committed>=ceiling);
    const slice=(ceiling-previous)*BigInt(entrants.length);
    previous=ceiling;
    if(slice===0n)continue;
    // When only one player has uncalled excess, return it without fee.
    if(entrants.length===1){
      const target=entrants[0]!;
      refunds.set(target.accountId,refunds.get(target.accountId)!+slice);
      continue;
    }
    const eligible=entrants.filter(p=>!p.folded);
    if(eligible.length===0) throw new Error("UNRESOLVABLE_SIDE_POT");
    const highest=Math.max(...eligible.map(p=>p.rank!));
    const winners=eligible.filter(p=>p.rank===highest);
    const each=slice/BigInt(winners.length), remainder=slice%BigInt(winners.length);
    winners.forEach((p,i)=>totals.set(p.accountId,totals.get(p.accountId)!+each+(BigInt(i)<remainder?1n:0n)));
    contestable+=slice;
    pots.push({amount:fromMilli(slice),eligibleSeats:eligible.map(p=>p.seat),
      winnerSeats:winners.map(p=>p.seat)});
  }
  const grossPot=sum(players.map(p=>p.committed));
  const refundTotal=sum([...refunds.values()]);
  if(contestable+refundTotal!==grossPot)throw new Error("POT_ACCOUNTING_IMBALANCE");
  const fee=(contestable*BigInt(feeBps))/10000n;
  const payouts=new Map(totals);
  if(contestable>0n && fee>0n){
    // Largest-remainder allocation avoids losing 0.001P due to rounding.
    const shares=players.map(p=>{
      const gross=totals.get(p.accountId)!;
      const numerator=gross*fee;
      return {id:p.accountId,seat:p.seat,base:numerator/contestable,
        fractional:numerator%contestable};
    });
    let left=fee-sum(shares.map(s=>s.base));
    shares.sort((a,b)=>numSort(b.fractional,a.fractional)||a.seat-b.seat);
    for(const sh of shares){
      let cut=sh.base;
      if(left>0n){cut+=1n;left-=1n;}
      if(cut>payouts.get(sh.id)!)throw new Error("INVALID_FEE_DISTRIBUTION");
      payouts.set(sh.id,payouts.get(sh.id)!-cut);
    }
    if(left!==0n)throw new Error("INVALID_FEE_DISTRIBUTION");
  }
  for(const p of players)payouts.set(p.accountId,payouts.get(p.accountId)!+refunds.get(p.accountId)!);
  if(sum([...payouts.values()])+fee!==grossPot)
    throw new Error("FINAL_ACCOUNTING_IMBALANCE");
  return {
    grossPot:fromMilli(grossPot),contestablePot:fromMilli(contestable),
    fee:fromMilli(fee),prizePool:fromMilli(grossPot-fee),
    uncalledRefunds:Object.fromEntries([...refunds].map(([id,v])=>[id,fromMilli(v)])),
    payouts:Object.fromEntries([...payouts].map(([id,v])=>[id,fromMilli(v)])),
    pots,accountingBalanced:true
  };
}
