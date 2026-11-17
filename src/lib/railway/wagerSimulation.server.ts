/**
 * Non-monetary server betting-phase simulator. A self-contained round state
 * machine, separate from real angel_rounds.pot / angel_wallets.
 * No real fund, rake or ledger effects. Integer milli-points throughout.
 */
import {toMilli,fromMilli,previewAdditionalAmount,type PreviewBetAction} from "./bettingPreview.server";

export type SimAction=PreviewBetAction;
export interface SimPlayer {
  seat:number;credit:string;contributed:string;folded:boolean;allIn:boolean;
}
export interface SimState {
  pot:string;currentBet:string;baseBet:string;
  turnSeat:number|null;pending:number[];players:SimPlayer[];
  paidActions:number;complete:boolean;
}
const eligible=(p:SimPlayer)=>!p.folded && !p.allIn;
const money=(v:string)=>toMilli(v);
export function newSimState(seats:readonly number[],baseBet:string):SimState {
  const base=money(baseBet);
  if(base<=0n||base>1000000000000n||seats.length<2||seats.length>10||
    new Set(seats).size!==seats.length||seats.some(s=>!Number.isInteger(s)||s<1||s>10))
    throw new Error("INVALID_SIM_SETUP");
  const ordered=[...seats].sort((a,b)=>a-b);
  return {
    pot:"0.000",currentBet:"0.000",baseBet:fromMilli(base),
    turnSeat:ordered[0]!,pending:ordered,paidActions:0,complete:false,
    players:ordered.map(seat=>({
      seat,credit:fromMilli(base*10n),contributed:"0.000",
      folded:false,allIn:false,
    })),
  };
}
function nextSeat(order:number[],pending:number[],current:number):number|null {
  const from=order.indexOf(current);
  for(let i=1;i<=order.length;i++){
    const seat=order[(from+i)%order.length]!;
    if(pending.includes(seat))return seat;
  }
  return null;
}
export function applySimAction(state:SimState,seat:number,action:SimAction):SimState {
  if(state.complete||state.turnSeat===null)throw new Error("SIM_ROUND_COMPLETE");
  if(seat!==state.turnSeat)throw new Error("NOT_YOUR_TURN");
  const players=state.players.map(p=>({...p}));
  const me=players.find(p=>p.seat===seat);
  if(!me||!eligible(me))throw new Error("NOT_ACTIVE_PLAYER");
  const base=money(state.baseBet),current=money(state.currentBet),
    personal=money(me.contributed),pot=money(state.pot),balance=money(me.credit);
  const owed=current>personal?current-personal:0n;
  if(action==="check"&&owed>0n)throw new Error("CHECK_NOT_ALLOWED");
  if(action==="call"&&owed===0n)throw new Error("CALL_NOT_ALLOWED");
  if(action==="ping"&&current>base)throw new Error("PING_NOT_ALLOWED");
  if(action==="all_in"&&state.paidActions<2)throw new Error("ALL_IN_TOO_EARLY");
  const amount=previewAdditionalAmount(action,{
    pot,currentBet:current,baseBet:base,stageBet:personal,balance,
    previousPaidActions:state.paidActions,
  });
  if(amount===null || (action!=="die"&&action!=="check"&&amount<=0n))
    throw new Error("SIM_ACTION_NOT_ALLOWED");
  if((action==="ping"||action==="ttadang"||action==="half"||action==="quarter") &&
      amount<=owed && amount<balance)throw new Error("SIM_RAISE_NOT_ALLOWED");
  if(action==="die")me.folded=true;
  else{
    me.credit=fromMilli(balance-amount);
    me.contributed=fromMilli(personal+amount);
    if(balance===amount && amount>0n)me.allIn=true;
  }
  const newPersonal=personal+amount;
  const raised=action!=="die"&&action!=="check"&&newPersonal>current;
  const nextBet=raised?newPersonal:current;
  const active=players.filter(p=>!p.folded);
  let pending=raised
    ? players.filter(p=>eligible(p)&&p.seat!==seat).map(p=>p.seat)
    : state.pending.filter(s=>s!==seat);
  pending=pending.filter(s=>players.some(p=>p.seat===s&&eligible(p)));
  const complete=active.length<=1 || pending.length===0;
  const next=complete?null:nextSeat(players.map(p=>p.seat),pending,seat);
  if(!complete&&next===null)throw new Error("SIM_TURN_STATE_INVALID");
  return {
    pot:fromMilli(pot+amount),currentBet:fromMilli(nextBet),
    baseBet:state.baseBet,players,turnSeat:next,pending,
    paidActions:state.paidActions+(amount>0n?1:0),complete,
  };
}
export function simPublicView(state:SimState,mySeat:number) {
  const p=state.players.find(x=>x.seat===mySeat);
  if(!p)throw new Error("NOT_IN_ROUND");
  return {
    previewOnly:true,realSettlement:false,
    mySeat,turnSeat:state.turnSeat,complete:state.complete,
    samplePot:state.pot,sampleCurrentBet:state.currentBet,
    sampleCredit:p.credit,sampleContributed:p.contributed,
    foldedSeats:state.players.filter(x=>x.folded).map(x=>x.seat),
    allInSeats:state.players.filter(x=>x.allIn).map(x=>x.seat),
    availableActions:state.complete||state.turnSeat!==mySeat?[]:
      (["die","check","call","ping","ttadang","half","quarter","all_in"] as const).filter(action=>{
        try{applySimAction(state,mySeat,action);return true;}catch{return false;}
      }),
  };
}
