/**
 * End-of-preview showdown status. This is a server-only, read-only bridge.
 * Fetches ALL hands inside the server and returns only a coarse outcome
 * (winner seat numbers). No other player's cards/ranks leave the server.
 * Requires every participant to complete their preview turn first.
 */
import postgres from "postgres";
import {isRoomUuid} from "./rooms.server";
import {getPreviewTurnStatus} from "./previewTurns.server";
import {evaluatePreviewShowdown,type PreviewMode,type PreviewShowdownPlayer} from "./showdownPreview.server";

let pool:ReturnType<typeof postgres>|undefined;
function db(){
  if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
     process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
     !process.env['DATABASE_URL'])throw new Error("STAGING_ONLY");
  pool??=postgres(process.env['DATABASE_URL'],{max:4,prepare:false,connect_timeout:10});
  return pool;
}
export async function readPreviewOutcome(accountId:string,roomId:string) {
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  const sql=db();
  const metadata=await sql`
    select r.id,r.phase,room.mode,
      (select count(*)::integer from public.angel_round_players
        where round_id=r.id) as players
    from public.angel_rounds r
    join public.angel_rooms room on room.id=r.room_id and room.status='WAITING'
    join public.angel_round_players participant on participant.round_id=r.id
      and participant.account_id=${accountId}::uuid
    where r.room_id=${roomId}::uuid and r.phase='DEALT_PREVIEW'
      and r.settlement_status='PENDING'
    order by r.round_number desc limit 1
  `;
  const m=metadata[0];
  if(!m)return null;
  const players=Number(m['players']);
  const turn=await getPreviewTurnStatus(accountId,roomId);
  if(!turn)throw new Error("PREVIEW_TURN_STATE_MISSING");
  if(players<2 || !turn.complete)
    return {status:"WAITING_FOR_PREVIEW_TURNS" as const,
      passed:turn.actedSeats.length,players,realSettlement:false};
  const hands=await sql`
    select p.account_id,p.seat_number,p.committed_amount,p.result,
      h.card_ids,s.selected_card_ids,s.mode as chosen_mode
    from public.angel_round_players p
    join public.angel_round_private_hands h
      on h.round_id=p.round_id and h.account_id=p.account_id
    left join public.angel_round_final_selections s
      on s.round_id=p.round_id and s.account_id=p.account_id
    where p.round_id=${String(m['id'])}::uuid
    order by p.seat_number
  `;
  if(hands.length!==players)throw new Error("PRIVATE_HAND_COUNT_MISMATCH");
  const mode=String(m['mode']) as PreviewMode;
  const candidates:PreviewShowdownPlayer[]=hands.map(row=>{
    const cards=row['card_ids'];
    const selection=row['selected_card_ids'];
    if(!Array.isArray(cards)||!cards.every(x=>typeof x==="string"))
      throw new Error("PRIVATE_HAND_CORRUPT");
    if(selection!==null && !Array.isArray(selection))
      throw new Error("FINAL_CHOICE_CORRUPT");
    return {
      accountId:String(row['account_id']),
      seat:Number(row['seat_number']),
      cards:cards as string[],
      contribution:String(row['committed_amount']),
      folded:turn.foldedSeats.includes(Number(row['seat_number'])),
      ...(mode==="SUTDA3" && Array.isArray(selection)?
        {selectedPair:selection as string[]}:{}),
      ...(mode==="DORI" && Array.isArray(selection)?
        {selectedMake:selection as string[]}:{}),
    };
  });
  const result=evaluatePreviewShowdown(mode,candidates);
  if(result.status==="BLOCKED")return {
    status:result.status,reason:result.reason,realSettlement:false,
  };
  const highest=Math.max(...result.hands.map(h=>h.rank));
  return {
    status:"PREVIEW_RESULT_ONLY" as const,
    winnerSeats:result.hands.filter(h=>h.rank===highest).map(h=>h.seat),
    // Deliberately hide other players' cards and hand rankings.
    pot:"0.000",fee:"0.000",realSettlement:false,
  };
}
