/**
 * Strictly read-only, simulation-backed showdown. Use the original server
 * hand evaluators with REAL server-dealt cards, but ONLY simulated wager
 * contributions. No balance, real POT, ledger or settlement writes.
 *
 * Unlike the old zero-pot preview, this model can display hypothetical
 * stake, fee and payouts following a completed simulated wagering phase.
 * Do not claim this reproduces the unported rematch/deung-gap rules.
 */
import postgres from "postgres";
import {isRoomUuid} from "./rooms.server";
import {toMilli,fromMilli} from "./bettingPreview.server";
import {evaluatePreviewShowdown,type PreviewShowdownPlayer,type PreviewMode} from "./showdownPreview.server";
import type {SimState} from "./wagerSimulation.server";

type HandRow={
 accountId:string;seat:number;cards:readonly string[];
 selectedPair?:readonly string[];selectedMake?:readonly string[];
};
type PreviewStatus=
 | {status:"WAITING_FOR_SIMULATION";realSettlement:false}
 | {status:"WAITING_FOR_BETS";realSettlement:false}
 | {status:"BLOCKED";reason:string;realSettlement:false}
 | {status:"CALCULATED";pot:string;fee:string;payouts:Array<{seat:number;amount:string}>;
    winnerSeats:number[];realSettlement:false};

export function calculateSimulationShowdown(
  mode:PreviewMode,state:SimState,hands:readonly HandRow[]
):PreviewStatus {
  if(!["SUTDA2","SUTDA3","DORI"].includes(mode))
    throw new Error("SIM_SHOWDOWN_INVALID_MODE");
  if(state.players.length<2 || hands.length!==state.players.length)
    throw new Error("SIM_SHOWDOWN_PLAYER_MISMATCH");
  if(!state.complete)return {status:"WAITING_FOR_BETS",realSettlement:false};
  const seenSeats=new Set<number>(),seenIds=new Set<string>();
  const players:PreviewShowdownPlayer[]=state.players.map(p=>{
    if(seenSeats.has(p.seat))throw new Error("SIM_SHOWDOWN_DUPLICATE_SEAT");
    seenSeats.add(p.seat);
    const hand=hands.find(h=>h.seat===p.seat);
    if(!hand || seenIds.has(hand.accountId))throw new Error("SIM_SHOWDOWN_PLAYER_MISMATCH");
    seenIds.add(hand.accountId);
    if(toMilli(p.contributed)<0n||toMilli(p.credit)<0n)
      throw new Error("SIM_SHOWDOWN_NEGATIVE_CREDIT");
    return {accountId:hand.accountId,seat:p.seat,cards:hand.cards,
      contribution:p.contributed,folded:p.folded,
      ...(hand.selectedPair?{selectedPair:hand.selectedPair}:{}),
      ...(hand.selectedMake?{selectedMake:hand.selectedMake}:{})};
  });
  const contributions=players.reduce((sum,p)=>sum+toMilli(p.contribution),0n);
  if(contributions!==toMilli(state.pot))
    throw new Error("SIM_SHOWDOWN_POT_MISMATCH");
  const outcome=evaluatePreviewShowdown(mode,players);
  if(outcome.status==="BLOCKED")
    return {status:"BLOCKED",reason:outcome.reason,realSettlement:false};
  const payoutEntries=outcome.financialPreview.payouts;
  const payouts=players.map(p=>({
    seat:p.seat,amount:payoutEntries[p.accountId]??"0.000",
  }));
  const payoutSum=payouts.reduce((s,p)=>s+toMilli(p.amount),0n);
  const fee=toMilli(outcome.financialPreview.fee);
  if(payoutSum+fee!==contributions)
    throw new Error("SIM_SHOWDOWN_ACCOUNTING_IMBALANCE");
  const high=Math.max(...outcome.hands.map(h=>h.rank));
  return {status:"CALCULATED",pot:fromMilli(contributions),fee:fromMilli(fee),
    payouts,winnerSeats:outcome.hands.filter(h=>h.rank===high).map(h=>h.seat),
    realSettlement:false};
}

let pool:ReturnType<typeof postgres>|undefined;
function db(){
  if(process.env['BACKEND_MODE']!=="railway_postgres_staging"||
     process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging"||
     !process.env['DATABASE_URL'])throw new Error("STAGING_ONLY");
  pool??=postgres(process.env['DATABASE_URL'],{max:4,prepare:false,connect_timeout:10});
  return pool;
}
/** Strictly participant-authenticated result, no opponent card IDs returned. */
export async function readOwnSimulationShowdown(accountId:string,roomId:string):Promise<PreviewStatus> {
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  const rounds=await db()`
    select s.state,r.id,rm.mode
    from public.angel_wager_simulations s
    join public.angel_rounds r on r.id=s.round_id
      and r.phase='DEALT_PREVIEW' and r.settlement_status='PENDING'
    join public.angel_round_runtime rt on rt.round_id=r.id and rt.accepts_bets=false
    join public.angel_rooms rm on rm.id=r.room_id and rm.status='WAITING'
    join public.angel_round_players member on member.round_id=r.id
      and member.account_id=${accountId}::uuid
    where r.room_id=${roomId}::uuid order by r.round_number desc limit 1
  `;
  const row=rounds[0];
  if(!row)return {status:"WAITING_FOR_SIMULATION",realSettlement:false};
  const state=row['state'] as SimState;
  if(!state || !Array.isArray(state.players))throw new Error("SIM_STATE_CORRUPT");
  if(!state.complete)return {status:"WAITING_FOR_BETS",realSettlement:false};
  const hands=await db()`
    select p.account_id,p.seat_number,h.card_ids,s.selected_card_ids
    from public.angel_round_players p
    join public.angel_round_private_hands h
      on h.round_id=p.round_id and h.account_id=p.account_id
    left join public.angel_round_final_selections s
      on s.round_id=p.round_id and s.account_id=p.account_id
    where p.round_id=${String(row['id'])}::uuid order by p.seat_number
  `;
  const verified:HandRow[]=hands.map(h=>{
    if(!Array.isArray(h['card_ids']) ||
       !h['card_ids'].every((id:unknown)=>typeof id==="string"))
      throw new Error("PRIVATE_HAND_CORRUPT");
    const selection=h['selected_card_ids'];
    if(selection!==null && !Array.isArray(selection))
      throw new Error("FINAL_CHOICE_CORRUPT");
    return {accountId:String(h['account_id']),seat:Number(h['seat_number']),
      cards:h['card_ids'] as string[],
      ...(String(row['mode'])==="SUTDA3"&&Array.isArray(selection)
        ?{selectedPair:selection as string[]}:{}),
      ...(String(row['mode'])==="DORI"&&Array.isArray(selection)
        ?{selectedMake:selection as string[]}:{}),
    };
  });
  return calculateSimulationShowdown(String(row['mode']) as PreviewMode,state,verified);
}
