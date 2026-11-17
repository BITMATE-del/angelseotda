/**
 * Authenticated server-only persistence for non-monetary wagering rehearsal.
 * Uses its own JSON state/event tables. NEVER touches angel_wallets,
 * angel_rounds.pot, angel_round_players.committed_amount, or any ledger.
 */
import postgres from "postgres";
import {isRoomUuid} from "./rooms.server";
import {
  applySimAction,newSimState,simPublicView,type SimAction,type SimState,
} from "./wagerSimulation.server";

const ACTIONS=new Set<string>(["die","check","call","ping","ttadang","half","quarter","all_in"]);
const requestPattern=/^[A-Za-z0-9_-]{12,100}$/;
let pool:ReturnType<typeof postgres>|undefined;
function db(){
  if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
     process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
     !process.env['DATABASE_URL'])throw new Error("STAGING_ONLY");
  pool??=postgres(process.env['DATABASE_URL'],{max:5,prepare:false,connect_timeout:10});
  return pool;
}
function stateFromDB(row:unknown):SimState {
  if(!row||typeof row!=="object"||Array.isArray(row))throw new Error("SIM_STATE_CORRUPT");
  const s=row as SimState;
  if(!Array.isArray(s.players)||!Array.isArray(s.pending) ||
     typeof s.pot!=="string"||typeof s.currentBet!=="string"||
     typeof s.baseBet!=="string"||typeof s.complete!=="boolean"||
     !Number.isInteger(s.paidActions))
    throw new Error("SIM_STATE_CORRUPT");
  return s;
}
async function lockedRound(tx:postgres.TransactionSql,roomId:string){
  const rooms=await tx`
    select id,owner_id,status,base_bet,mode from public.angel_rooms
    where id=${roomId}::uuid for update
  `;
  const room=rooms[0];
  if(!room||room['status']!=="WAITING")throw new Error("ROOM_UNAVAILABLE");
  const rounds=await tx`
    select r.id,rt.accepts_bets
    from public.angel_rounds r
    join public.angel_round_runtime rt on rt.round_id=r.id
    where r.room_id=${roomId}::uuid and r.phase='DEALT_PREVIEW'
      and r.settlement_status='PENDING'
    order by r.round_number desc limit 1 for update of r,rt
  `;
  const round=rounds[0];
  if(!round||round['accepts_bets']!==false)throw new Error("ROUND_NOT_DEALT");
  return {roundId:String(round['id']),ownerId:String(room['owner_id']),
    baseBet:String(room['base_bet']),mode:String(room['mode'])};
}
async function members(tx:postgres.TransactionSql,roundId:string){
  const players=await tx`
    select p.account_id,p.seat_number,a.status
    from public.angel_round_players p
    join public.angel_accounts a on a.id=p.account_id
    where p.round_id=${roundId}::uuid order by p.seat_number
  `;
  if(players.some(p=>p['status']!=="ACTIVE"))throw new Error("INACTIVE_PLAYER");
  return players.map(p=>({accountId:String(p['account_id']),seat:Number(p['seat_number'])}));
}
export async function startWagerSimulation(accountId:string,roomId:string){
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  return db().begin(tx=>initializeWagerSimulation(tx,accountId,roomId));
}
export async function initializeWagerSimulation(
  tx:postgres.TransactionSql,accountId:string,roomId:string
){
    const round=await lockedRound(tx,roomId);
    if(round.ownerId!==accountId)throw new Error("OWNER_ONLY");
    const players=await members(tx,round.roundId);
    if(!players.some(p=>p.accountId===accountId))throw new Error("NOT_IN_ROUND");
    const previous=await tx`
      select state from public.angel_wager_simulations
      where round_id=${round.roundId}::uuid for update
    `;
    if(previous[0])return {
      ...simPublicView(stateFromDB(previous[0]['state']),
        players.find(p=>p.accountId===accountId)!.seat),reused:true,
    };
    const state=newSimState(players.map(p=>p.seat),round.baseBet);
    await tx`
      insert into public.angel_wager_simulations(round_id,state,revision)
      values(${round.roundId}::uuid,${tx.json(state)},0)
    `;
    return {...simPublicView(state,players.find(p=>p.accountId===accountId)!.seat),
      reused:false};
}
/** Read strictly caller's synthetic credit; never expose other player credit. */
export async function getOwnWagerSimulation(accountId:string,roomId:string){
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  const rows=await db()`
    select s.state,p.seat_number
    from public.angel_wager_simulations s
    join public.angel_rounds r on r.id=s.round_id
      and r.phase='DEALT_PREVIEW' and r.settlement_status='PENDING'
    join public.angel_round_runtime rt on rt.round_id=r.id
      and rt.accepts_bets=false
    join public.angel_round_players p on p.round_id=r.id
      and p.account_id=${accountId}::uuid
    where r.room_id=${roomId}::uuid
    order by r.round_number desc limit 1
  `;
  return rows[0]?simPublicView(stateFromDB(rows[0]['state']),
    Number(rows[0]['seat_number'])):null;
}
export async function performWagerSimulation(
  accountId:string,roomId:string,requestId:string,action:SimAction
){
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  if(!requestPattern.test(requestId))throw new Error("INVALID_REQUEST_ID");
  if(!ACTIONS.has(action))throw new Error("INVALID_SIM_ACTION");
  return db().begin(tx=>applyWagerSimulation(tx,accountId,roomId,requestId,action));
}
export async function applyWagerSimulation(
  tx:postgres.TransactionSql,accountId:string,roomId:string,
  requestId:string,action:SimAction
){
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  if(!requestPattern.test(requestId))throw new Error("INVALID_REQUEST_ID");
  if(!ACTIONS.has(action))throw new Error("INVALID_SIM_ACTION");
    const round=await lockedRound(tx,roomId);
    const players=await members(tx,round.roundId);
    const me=players.find(p=>p.accountId===accountId);
    if(!me)throw new Error("NOT_IN_ROUND");
    const rows=await tx`
      select state,revision from public.angel_wager_simulations
      where round_id=${round.roundId}::uuid for update
    `;
    if(!rows[0])throw new Error("SIM_NOT_STARTED");
    const state=stateFromDB(rows[0]['state']);
    const prior=await tx`
      select account_id,round_id,action
      from public.angel_wager_sim_actions where request_id=${requestId}
    `;
    if(prior[0]){
      if(String(prior[0]['account_id'])!==accountId ||
         String(prior[0]['round_id'])!==round.roundId ||
         prior[0]['action']!==action)throw new Error("REQUEST_ID_CONFLICT");
      return {...simPublicView(state,me.seat),reused:true};
    }
    const next=applySimAction(state,me.seat,action);
    const revision=Number(rows[0]['revision'])+1;
    await tx`
      update public.angel_wager_simulations
      set state=${tx.json(next)},revision=${revision},updated_at=now()
      where round_id=${round.roundId}::uuid
    `;
    await tx`
      insert into public.angel_wager_sim_actions
        (request_id,round_id,account_id,action,revision)
      values (${requestId},${round.roundId}::uuid,${accountId}::uuid,
        ${action},${revision})
    `;
    return {...simPublicView(next,me.seat),reused:false};
}
