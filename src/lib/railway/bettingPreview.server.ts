/**
 * Read-only Railway betting preflight.
 * Ported from legacy public.bet_additional_amount SQL (20260903104448):
 * this does NOT place a bet or mutate wallet, pot, rounds, or actions.
 *
 * Integer milli-points avoid floating-point rounding. The sample scenario
 * intentionally has hypothetical credits, NOT the account's actual balance.
 */
import postgres from "postgres";
import { isRoomUuid } from "./rooms.server";

export const PREVIEW_ACTIONS = ["die","check","call","ping","ttadang","half","quarter","all_in"] as const;
export type PreviewBetAction = typeof PREVIEW_ACTIONS[number];
const MAX_UNITS = 999_999_999_999_999_999n; // < numeric(20,3) and avoids huge payloads
const VALID = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,3})?$/;

export function toMilli(value:string):bigint {
  if (!VALID.test(value)) throw new Error("INVALID_BET_AMOUNT");
  const [whole,frac=""] = value.split(".");
  const v=BigInt(whole!)*1000n+BigInt(frac.padEnd(3,"0"));
  if (v>MAX_UNITS) throw new Error("INVALID_BET_AMOUNT");
  return v;
}
export function fromMilli(value:bigint):string {
  if (value<0n) throw new Error("INVALID_BET_AMOUNT");
  const whole=value/1000n, fraction=(value%1000n).toString().padStart(3,"0");
  return whole.toString()+"."+fraction;
}
const max=(a:bigint,b:bigint)=>a>b?a:b;
const min=(a:bigint,b:bigint)=>a<b?a:b;

export interface BetSample {
  pot:bigint; currentBet:bigint; baseBet:bigint;
  stageBet:bigint; balance:bigint; previousPaidActions:number;
}
export function previewAdditionalAmount(action:PreviewBetAction,s:BetSample):bigint|null {
  if ([s.pot,s.currentBet,s.baseBet,s.stageBet,s.balance].some(n=>n<0n) ||
      !Number.isInteger(s.previousPaidActions) || s.previousPaidActions<0)
    throw new Error("INVALID_BET_STATE");
  const owed=max(s.currentBet-s.stageBet,0n);
  let amount:bigint;
  switch(action) {
    case "die":
    case "check": amount=0n;break;
    case "call": amount=owed;break;
    case "ping": amount=owed+s.baseBet;break;
    case "ttadang": {
      const target=max(s.currentBet,s.baseBet)*2n;
      amount=max(target-s.stageBet,owed+s.baseBet);
      break;
    }
    case "half": amount=owed+max(s.pot/2n,s.baseBet);break;
    case "quarter": amount=owed+max(s.pot/4n,s.baseBet);break;
    case "all_in": amount=s.balance;break;
    default:return null;
  }
  return min(max(amount,0n),s.balance);
}
export function previewActionOptions(s:BetSample) {
  const owed=max(s.currentBet-s.stageBet,0n);
  return PREVIEW_ACTIONS.map(action=>{
    const amount=previewAdditionalAmount(action,s);
    const allowed=action==="die" ||
      (action==="check" ? owed===0n :
      action==="call" ? owed>0n :
      action==="ping" ? s.currentBet<=s.baseBet && amount!==null && amount>0n :
      action==="all_in" ? s.previousPaidActions>=2 && s.balance>0n :
      amount!==null && amount>0n);
    return { action, enabled:allowed, sampleAdditionalAmount:fromMilli(amount??0n) };
  });
}

let pool:ReturnType<typeof postgres>|undefined;
function db(){
  if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
     process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
     !process.env['DATABASE_URL']) throw new Error("STAGING_ONLY");
  pool??=postgres(process.env['DATABASE_URL'],{max:3,prepare:false,connect_timeout:10});
  return pool;
}

/** Server determines context; the browser cannot supply amounts or choose another actor. */
export async function getBettingDryRun(accountId:string,roomId:string) {
  if(!isRoomUuid(roomId)) throw new Error("INVALID_ROOM");
  const rows=await db()`
    select room.mode,room.base_bet,round.id as round_id,
      runtime.turn_seat,p.seat_number
    from public.angel_rooms room
    join public.angel_rounds round on round.room_id=room.id
      and round.phase='DEALT_PREVIEW' and round.settlement_status='PENDING'
    join public.angel_round_runtime runtime on runtime.round_id=round.id
      and runtime.accepts_bets=false
    join public.angel_round_players p on p.round_id=round.id
      and p.account_id=${accountId}::uuid
    where room.id=${roomId}::uuid and room.status='WAITING'
    order by round.round_number desc limit 1
  `;
  const row=rows[0];
  if(!row) throw new Error("NOT_IN_DEALT_ROUND");
  const base=toMilli(String(row['base_bet']));
  const sampleBalance=base*10n;
  // This example deliberately does not use real wallet balances or contributions.
  const sample:BetSample={
    pot:base*2n,currentBet:base,baseBet:base,
    stageBet:0n,balance:sampleBalance,previousPaidActions:0,
  };
  return {
    previewOnly:true,canExecute:false,monetaryEffects:false,
    isMyTurn:Number(row['turn_seat'])===Number(row['seat_number']),
    sample:{
      pot:fromMilli(sample.pot),currentBet:fromMilli(sample.currentBet),
      stageBet:"0.000",hypotheticalBalance:fromMilli(sampleBalance),
    },
    actions:previewActionOptions(sample),
  };
}
