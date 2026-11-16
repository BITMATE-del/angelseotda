/**
 * Railway-only non-monetary preview turn engine.
 *
 * Zero monetary actions: no wallet, POT, rake, ledger, stake or settlement.
 * CHECK/FOLD are a server-authenticated state-machine rehearsal, not betting.
 * Existing PREVIEW_PASS records are treated as a CHECK for compatibility.
 */
import postgres from "postgres";
import {isRoomUuid} from "./rooms.server";

export type PreviewAction="CHECK"|"FOLD";
export type PreviewTurnEvent={seat:number;action:PreviewAction};
export type PreviewTurnState={
  complete:boolean;turnSeat:number|null;activeSeats:number[];
  foldedSeats:number[];actedSeats:number[];
};

export function derivePreviewTurnState(
  seats:readonly number[],events:readonly PreviewTurnEvent[]
):PreviewTurnState {
  const ordered=[...seats].sort((a,b)=>a-b);
  if(ordered.length<2 || ordered.length>10 ||
     new Set(ordered).size!==ordered.length ||
     ordered.some(n=>!Number.isInteger(n)||n<1||n>10))
    throw new Error("INVALID_PREVIEW_TURN_STATE");
  const alive=new Set(ordered),acted=new Set<number>();
  let turn=ordered[0]!;
  let complete=false;
  for(const event of events){
    if(complete || event.seat!==turn || acted.has(event.seat) ||
       !alive.has(event.seat) ||
       (event.action!=="CHECK" && event.action!=="FOLD"))
      throw new Error("INVALID_PREVIEW_TURN_STATE");
    acted.add(event.seat);
    if(event.action==="FOLD")alive.delete(event.seat);
    if(alive.size<=1 || [...alive].every(s=>acted.has(s))){
      complete=true;
      break;
    }
    const from=ordered.indexOf(turn);
    const next=[...ordered.slice(from+1),...ordered.slice(0,from+1)]
      .find(s=>alive.has(s)&&!acted.has(s));
    if(next===undefined)throw new Error("INVALID_PREVIEW_TURN_STATE");
    turn=next;
  }
  return {
    complete,turnSeat:complete?null:turn,
    activeSeats:ordered.filter(x=>alive.has(x)),
    foldedSeats:ordered.filter(x=>!alive.has(x)),
    actedSeats:ordered.filter(x=>acted.has(x)),
  };
}

let pool:ReturnType<typeof postgres>|undefined;
function db(){
  if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
    process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
    !process.env['DATABASE_URL'])throw new Error("STAGING_ONLY");
  pool??=postgres(process.env['DATABASE_URL'],{max:5,prepare:false,connect_timeout:10});
  return pool;
}
const validRequest=/^[a-zA-Z0-9_-]{12,100}$/;
function normalizeEventAction(value:string):PreviewAction {
  if(value==="PREVIEW_CHECK"||value==="PREVIEW_PASS")return "CHECK";
  if(value==="PREVIEW_FOLD")return "FOLD";
  throw new Error("INVALID_PREVIEW_TURN_STATE");
}

/** Returns only public seat state, never any participant's cards. */
export async function getPreviewTurnStatus(accountId:string,roomId:string) {
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  const rows=await db()`
    select r.id,rt.turn_seat,p.seat_number as my_seat
    from public.angel_rounds r
    join public.angel_round_runtime rt on rt.round_id=r.id
    join public.angel_round_players p on p.round_id=r.id
      and p.account_id=${accountId}::uuid
    where r.room_id=${roomId}::uuid and r.phase='DEALT_PREVIEW'
      and r.settlement_status='PENDING' and rt.accepts_bets=false
    order by r.round_number desc limit 1
  `;
  if(!rows[0])return null;
  const roundId=String(rows[0]['id']);
  const [players,actions]=await Promise.all([
    db()`select seat_number,account_id from public.angel_round_players
      where round_id=${roundId}::uuid order by seat_number`,
    db()`select actor_id,action_type from public.angel_game_actions
      where round_id=${roundId}::uuid and action_type in
      ('PREVIEW_PASS','PREVIEW_CHECK','PREVIEW_FOLD')
      order by created_at,id`,
  ]);
  const ids=new Map(players.map(p=>[String(p['account_id']),Number(p['seat_number'])]));
  const events=actions.map(a=>({
    seat:ids.get(String(a['actor_id']))??-1,
    action:normalizeEventAction(String(a['action_type'])),
  }));
  const state=derivePreviewTurnState(players.map(p=>Number(p['seat_number'])),events);
  if(!state.complete && Number(rows[0]['turn_seat'])!==state.turnSeat)
    throw new Error("PREVIEW_TURN_STATE_MISMATCH");
  return {...state,mySeat:Number(rows[0]['my_seat']),previewOnly:true,realSettlement:false};
}

/**
 * Transaction serializes with join/leave and preview turn actions.
 * Idempotency is globally enforced by existing game_actions.request_id.
 * A completed turn cannot be re-opened, including by sending a new request ID.
 */
export async function actPreviewTurn(
  accountId:string,roomId:string,requestId:string,action:PreviewAction
){
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  if(!validRequest.test(requestId))throw new Error("INVALID_REQUEST_ID");
  if(action!=="CHECK"&&action!=="FOLD")throw new Error("INVALID_PREVIEW_ACTION");
  return db().begin(async tx=>{
    const room=await tx`select status from public.angel_rooms
      where id=${roomId}::uuid for update`;
    if(room[0]?.['status']!=="WAITING")throw new Error("ROOM_UNAVAILABLE");
    const rounds=await tx`
      select r.id,rt.turn_seat,rt.accepts_bets
      from public.angel_rounds r
      join public.angel_round_runtime rt on rt.round_id=r.id
      where r.room_id=${roomId}::uuid and r.phase='DEALT_PREVIEW'
        and r.settlement_status='PENDING'
      order by r.round_number desc limit 1 for update of r,rt
    `;
    const round=rounds[0];
    if(!round || round['accepts_bets']!==false)throw new Error("ROUND_NOT_DEALT");
    const roundId=String(round['id']);
    const players=await tx`
      select account_id,seat_number from public.angel_round_players
      where round_id=${roundId}::uuid order by seat_number`;
    const me=players.find(p=>String(p['account_id'])===accountId);
    if(!me)throw new Error("NOT_IN_ROUND");
    const prior=await tx`select round_id,actor_id,action_type
      from public.angel_game_actions where request_id=${requestId}`;
    if(prior[0]){
      if(String(prior[0]['round_id'])!==roundId ||
         String(prior[0]['actor_id'])!==accountId ||
         normalizeEventAction(String(prior[0]['action_type']))!==action)
        throw new Error("REQUEST_ID_CONFLICT");
      return {roundId,reused:true,previewOnly:true};
    }
    const actions=await tx`
      select actor_id,action_type from public.angel_game_actions
      where round_id=${roundId}::uuid and action_type in
        ('PREVIEW_PASS','PREVIEW_CHECK','PREVIEW_FOLD')
      order by created_at,id
    `;
    const seatById=new Map(players.map(p=>[String(p['account_id']),Number(p['seat_number'])]));
    const seats=players.map(p=>Number(p['seat_number']));
    const events=actions.map(a=>({
      seat:seatById.get(String(a['actor_id']))??-1,
      action:normalizeEventAction(String(a['action_type'])),
    }));
    const current=derivePreviewTurnState(seats,events);
    if(current.complete)throw new Error("PREVIEW_ROUND_FINISHED");
    if(current.turnSeat!==Number(me['seat_number']) ||
       Number(round['turn_seat'])!==current.turnSeat)
      throw new Error("NOT_YOUR_TURN");
    const next=derivePreviewTurnState(seats,[...events,{seat:current.turnSeat!,action}]);
    await tx`
      insert into public.angel_game_actions
      (round_id,actor_id,request_id,action_type,amount)
      values(${roundId}::uuid,${accountId}::uuid,${requestId},
        ${action==="FOLD"?"PREVIEW_FOLD":"PREVIEW_CHECK"},0)
    `;
    await tx`update public.angel_round_runtime
      set turn_seat=${next.turnSeat??current.turnSeat}
      where round_id=${roundId}::uuid and accepts_bets=false`;
    return {roundId,turnSeat:next.turnSeat,complete:next.complete,
      activeSeats:next.activeSeats,foldedSeats:next.foldedSeats,
      reused:false,previewOnly:true,realSettlement:false};
  });
}
