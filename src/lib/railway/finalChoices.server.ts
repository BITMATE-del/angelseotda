import postgres from "postgres";
import { isRoomUuid } from "./rooms.server";
import { evaluateSutda2 } from "@/lib/game/sutda2Rules";
import { validateDoriMake } from "@/lib/game/dori/doriRules";

export type FinalHandMode = "SUTDA3"|"DORI";
let pool:ReturnType<typeof postgres>|undefined;
function db() {
  if (process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
      process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
      !process.env['DATABASE_URL']) throw new Error("STAGING_ONLY");
  pool??=postgres(process.env['DATABASE_URL'],{max:5,prepare:false,connect_timeout:10});
  return pool;
}

/** Pure validation, never trusts the browser's hand rank. */
export function validateFinalChoice(
  mode:FinalHandMode,ownCards:readonly string[],chosen:readonly string[]
) {
  if (mode!=="SUTDA3" && mode!=="DORI") throw new Error("INVALID_FINAL_MODE");
  if(!Array.isArray(ownCards) || ownCards.length!==(mode==="SUTDA3"?3:5) ||
     !ownCards.every(x=>typeof x==="string") ||
     new Set(ownCards).size!==ownCards.length ||
     !Array.isArray(chosen) || chosen.length!==(mode==="SUTDA3"?2:3) ||
     !chosen.every(x=>typeof x==="string") ||
     new Set(chosen).size!==chosen.length ||
     !chosen.every(x=>ownCards.includes(x)))
    throw new Error("INVALID_FINAL_CHOICE");
  if(mode==="SUTDA3") {
    const hand=evaluateSutda2(chosen);
    return {selected:[...chosen],handName:hand.name,handCode:hand.code};
  }
  const dori=validateDoriMake(ownCards,chosen);
  if(!dori.ok || !dori.hand) throw new Error("INVALID_DORI_MAKE");
  return {selected:[...chosen],handName:dori.hand.label,handCode:dori.hand.code};
}

/** Immutable single submission, serialized via room row lock.
 * No ability to choose the cards of another player. */
export async function chooseFinalHand(
  accountId:string,roomId:string,chosen:readonly string[]
) {
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  return db().begin(tx=>applyFinalChoice(tx,accountId,roomId,chosen));
}

/** Transaction-injectable core for rollback-only PostgreSQL integration tests. */
export async function applyFinalChoice(
  tx:postgres.TransactionSql,accountId:string,roomId:string,chosen:readonly string[]
){
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
    const rooms=await tx`
      select id,mode,status from public.angel_rooms
      where id=${roomId}::uuid for update
    `;
    const room=rooms[0];
    if(!room || room['status']!=="WAITING")throw new Error("ROOM_UNAVAILABLE");
    const mode=String(room['mode']);
    if(mode!=="SUTDA3" && mode!=="DORI")throw new Error("FINAL_CHOICE_NOT_REQUIRED");
    const found=await tx`
      select r.id,h.card_ids
      from public.angel_rounds r
      join public.angel_round_private_hands h
        on h.round_id=r.id and h.account_id=${accountId}::uuid
      where r.room_id=${roomId}::uuid and r.phase='DEALT_PREVIEW'
        and r.settlement_status='PENDING'
      order by r.round_number desc limit 1
    `;
    if(!found[0])throw new Error("NOT_IN_DEALT_ROUND");
    const roundId=String(found[0]['id']);
    const ownCards=found[0]['card_ids'];
    if(!Array.isArray(ownCards) || !ownCards.every(x=>typeof x==="string"))
      throw new Error("PRIVATE_HAND_CORRUPT");
    const verified=validateFinalChoice(mode,ownCards,chosen);
    const previous=await tx`
      select selected_card_ids from public.angel_round_final_selections
      where round_id=${roundId}::uuid and account_id=${accountId}::uuid
    `;
    if(previous[0]) {
      const old=previous[0]['selected_card_ids'];
      if(!Array.isArray(old) || !old.every(x=>verified.selected.includes(x)) ||
         old.length!==verified.selected.length)
        throw new Error("FINAL_CHOICE_LOCKED");
      return {roundId,selected:verified.selected,handName:verified.handName,
        reused:true,previewOnly:true};
    }
    await tx`
      insert into public.angel_round_final_selections
        (round_id,account_id,mode,selected_card_ids)
      values(${roundId}::uuid,${accountId}::uuid,${mode},
             ${tx.json(verified.selected)})
    `;
    return {roundId,selected:verified.selected,handName:verified.handName,
      reused:false,previewOnly:true};
}

/** Only reveal the caller's saved selection. Never return other players' cards. */
export async function readOwnFinalChoice(accountId:string,roomId:string) {
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  const rows=await db()`
    select s.mode,s.selected_card_ids
    from public.angel_round_final_selections s
    join public.angel_rounds r on r.id=s.round_id
    where r.room_id=${roomId}::uuid and r.phase='DEALT_PREVIEW'
      and r.settlement_status='PENDING'
      and s.account_id=${accountId}::uuid
    order by r.round_number desc limit 1
  `;
  const row=rows[0];
  return row?{mode:String(row['mode']),selected:row['selected_card_ids'],previewOnly:true}:null;
}
