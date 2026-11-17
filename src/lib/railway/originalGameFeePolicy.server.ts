/**
 * Original ANGEL 2026-11-13 policy parity, pure functions ONLY.
 * Sources: src/lib/gameFeePolicy.ts and migration 20261113093100/93200.
 *
 * Legacy user points are bigint INTEGERS. Refuse fractional-point inputs
 * here rather than silently applying the staging 0.001P policy to legacy.
 * Never make a wallet transfer or use this to authorize settlement.
 */
export type GameMode="SUTDA2"|"SUTDA3"|"DORI";
export type OriginalFeeWinner={
  accountId:string;grossPayout:bigint;affiliateId:string|null;
};
export type OriginalFeeLine={
  accountId:string;grossPayout:bigint;
  fee:bigint;netPayout:bigint;affiliateId:string|null;
  affiliateAccrual:bigint;companyRetained:bigint;
};
export type OriginalFeeResult={
  grossTotal:bigint;feeTotal:bigint;
  affiliateAccrualTotal:bigint;companyRetainedTotal:bigint;
  winners:OriginalFeeLine[];
  /** Affiliate credit is scheduled only, NOT payable wallet balance. */
  affiliatePaymentPosted:false;
};
const sum=(numbers:readonly bigint[])=>numbers.reduce((a,b)=>a+b,0n);
const roundedPercent=(amount:bigint,numerator:bigint,denominator:bigint)=>{
  if(amount<0n)throw new Error("NEGATIVE_AMOUNT");
  return (amount*numerator+denominator/2n)/denominator;
};
/**
 * Reproduces legacy apply_game_rake's cumulative rounding on the
 * positive gross WIN payout, not the gross POT. The exact original logic
 * sorts by user ID, rounding each cumulative winner amount.
 */
export function calculateOriginalRake(
  winners:readonly OriginalFeeWinner[],mode:GameMode,
  finalSettlement:boolean,
):OriginalFeeResult {
  if(!["SUTDA2","SUTDA3","DORI"].includes(mode))throw new Error("INVALID_GAME_MODE");
  if(!finalSettlement)throw new Error("SETTLEMENT_NOT_FINAL");
  if(winners.length<1||winners.length>(mode==="DORI"?4:mode==="SUTDA3"?6:10))
    throw new Error("INVALID_WINNER_COUNT");
  const sorted=[...winners].sort((a,b)=>a.accountId.localeCompare(b.accountId,"en"));
  if(new Set(sorted.map(x=>x.accountId)).size!==sorted.length ||
     sorted.some(x=>!x.accountId || x.grossPayout<=0n || (
       x.affiliateId!==null && x.affiliateId.trim()===""
     ))) throw new Error("INVALID_WINNER_INPUT");
  let grossAccum=0n,feeAccum=0n;
  const lines=sorted.map(w=>{
    grossAccum+=w.grossPayout;
    const fee=roundedPercent(grossAccum,3n,100n)-feeAccum;
    feeAccum+=fee;
    const affiliateAccrual=w.affiliateId?
      roundedPercent(fee,20n,100n):0n;
    return {accountId:w.accountId,grossPayout:w.grossPayout,
      fee,netPayout:w.grossPayout-fee,affiliateId:w.affiliateId,
      affiliateAccrual,companyRetained:fee-affiliateAccrual};
  });
  const affiliateTotal=sum(lines.map(x=>x.affiliateAccrual));
  const companyTotal=sum(lines.map(x=>x.companyRetained));
  if(feeAccum!==affiliateTotal+companyTotal ||
     feeAccum!==roundedPercent(grossAccum,3n,100n) ||
     lines.some(x=>x.fee<0n || x.netPayout<0n))
    throw new Error("RAKE_ACCOUNTING_IMBALANCE");
  return {
    grossTotal:grossAccum,feeTotal:feeAccum,
    affiliateAccrualTotal:affiliateTotal,companyRetainedTotal:companyTotal,
    winners:lines,affiliatePaymentPosted:false,
  };
}

export type TtaengHandCode=string|null;
export type TtaengRoundInput={
  mode:GameMode;participants:readonly string[];
  /** Pre-reserved maximum liability from each participant's wallet. */
  reservations:Readonly<Record<string,bigint>>;
  status:"SETTLED"|"REMATCH"|"VOID"|"REFUNDED";
  winnerId:string|null;winnerHandCode:TtaengHandCode;
  nonFoldedCount:number;
  /** These amounts were snapshotted when reservations were made. */
  schedule:{regular:bigint; jang:bigint; gwang:bigint};
};
export type TtaengResult={
  bonusPerLoser:bigint;winnerBonus:bigint;
  /** Amount refunded to each original reserver. */
  refunds:Record<string,bigint>;
  /** Amount taken from the original escrow of each loser. */
  paidBy:Record<string,bigint>;
  /** Escrow is a transfer among players, no operator rake. */
  operatorFee:0n;
};
export function originalTtaengSchedule(handCode:TtaengHandCode,schedule:TtaengRoundInput["schedule"]):bigint {
  if(handCode?.startsWith("kwang")||handCode?.startsWith("samttaeng"))return schedule.gwang;
  if(handCode==="ttaeng10")return schedule.jang;
  if(/^ttaeng[1-9]$/.test(handCode??""))return schedule.regular;
  return 0n;
}
/**
 * Original reserve_game_ttaeng: entire round opted in only when all
 * participants could reserve the max schedule amount. Never collect
 * additional funds after settling.
 */
export function calculateOriginalTtaengEscrow(input:TtaengRoundInput):TtaengResult {
  const {mode,participants,reservations,status,winnerId,schedule}=input;
  if(!["SUTDA2","SUTDA3"].includes(mode))throw new Error("TTAENG_NOT_FOR_DORI");
  if(participants.length<2||participants.length>(mode==="SUTDA3"?6:10) ||
     new Set(participants).size!==participants.length ||
     participants.some(x=>!x))throw new Error("TTAENG_INVALID_PARTICIPANTS");
  if(Object.keys(reservations).length!==participants.length ||
     Object.keys(reservations).some(x=>!participants.includes(x)))
    throw new Error("TTAENG_RESERVATION_MISMATCH");
  for(const n of [schedule.regular,schedule.jang,schedule.gwang])
    if(n<0n||n>1000000n)throw new Error("TTAENG_INVALID_SCHEDULE");
  const max=[schedule.regular,schedule.jang,schedule.gwang].reduce(
    (a,b)=>a>b?a:b,0n
  );
  // The source's reservation function locks max for every player.
  if(participants.some(p=>reservations[p]!==max))
    throw new Error("TTAENG_RESERVATION_MISMATCH");
  if(winnerId!==null&&!participants.includes(winnerId))
    throw new Error("TTAENG_INVALID_WINNER");
  if(!Number.isInteger(input.nonFoldedCount) ||
     input.nonFoldedCount<0||input.nonFoldedCount>participants.length)
    throw new Error("TTAENG_INVALID_FOLD_COUNT");
  const qualified=status==="SETTLED" && winnerId!==null &&
    input.nonFoldedCount>1;
  const perLoser=qualified?
    originalTtaengSchedule(input.winnerHandCode,schedule):0n;
  const refunds:Record<string,bigint>={},paidBy:Record<string,bigint>={};
  for(const p of participants){
    const paid=p!==winnerId?perLoser:0n;
    paidBy[p]=paid;refunds[p]=max-paid;
  }
  const bonus=sum(Object.values(paidBy));
  if(sum(Object.values(refunds))+bonus!==max*BigInt(participants))
    throw new Error("TTAENG_ESCROW_UNBALANCED");
  return {bonusPerLoser:perLoser,winnerBonus:bonus,refunds,paidBy,operatorFee:0n};
}
