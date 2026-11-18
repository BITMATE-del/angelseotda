/**
 * Staging-only transactional debit primitive, NOT wired to any HTTP endpoint.
 *
 * This is exercised in a fully rolled-back database fixture. The test action
 * SANDBOX_DEBIT is not a real bet, and cannot be invoked by members.
 * Later, audited game actions must supply their own legal action/turn/rake rules.
 */
import postgres from "postgres";

type Tx = postgres.TransactionSql;
export type SandboxDebitInput = {
  roomId:string; roundId:string; actorId:string; requestId:string; amount:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY=/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/;

export function checkSandboxDebit(input:SandboxDebitInput):void {
  if (![input.roomId,input.roundId,input.actorId].every(s=>UUID.test(s)) ||
      !/^[a-zA-Z0-9_-]{12,100}$/.test(input.requestId) ||
      !MONEY.test(input.amount) || Number(input.amount)<=0)
    throw new Error("INVALID_SANDBOX_DEBIT");
}

/**
 * Must run inside an existing SQL transaction. Caller may roll it back.
 * Lock order: room -> round -> wallet -> round player; no partial commit.
 */
export async function applySandboxDebit(tx:Tx,input:SandboxDebitInput) {
  checkSandboxDebit(input);
  const room=await tx`
    select id,status from public.angel_rooms
    where id=${input.roomId}::uuid for update
  `;
  if (room[0]?.['status']!=="WAITING") throw new Error("ROOM_UNAVAILABLE");

  const round=await tx`
    select r.id,r.phase,r.settlement_status,rt.accepts_bets
    from public.angel_rounds r
    join public.angel_round_runtime rt on rt.round_id=r.id
    where r.id=${input.roundId}::uuid and r.room_id=${input.roomId}::uuid
    for update of r,rt
  `;
  if (round[0]?.['phase']!=="DEALT_PREVIEW" ||
      round[0]?.['settlement_status']!=="PENDING" ||
      round[0]?.['accepts_bets']!==false)
    throw new Error("ROUND_NOT_SANDBOX");

  // After the room lock, a duplicate request may safely return its original result.
  const previous=await tx`
    select request_id,account_id,round_id,amount,wallet_after,pot_after
    from public.angel_bet_receipts where request_id=${input.requestId}
  `;
  if (previous[0]) {
    const p=previous[0];
    if (String(p['account_id'])!==input.actorId ||
        String(p['round_id'])!==input.roundId ||
        Number(p['amount'])!==Number(input.amount))
      throw new Error("REQUEST_ID_CONFLICT");
    return {reused:true,walletAfter:String(p['wallet_after']),
      potAfter:String(p['pot_after'])};
  }
  const account=await tx`
    select id from public.angel_accounts
    where id=${input.actorId}::uuid and status='ACTIVE'
  `;
  const participant=await tx`
    select account_id from public.angel_round_players
    where round_id=${input.roundId}::uuid and account_id=${input.actorId}::uuid
  `;
  if (!account.length || !participant.length) throw new Error("NOT_IN_ROUND");

  const prior=await tx`
    select 1 from public.angel_bet_receipts
    where round_id=${input.roundId}::uuid and account_id=${input.actorId}::uuid
  `;
  if (prior.length) throw new Error("SANDBOX_ALREADY_DEBITED");

  // Balance and locked funds are verified together under wallet row lock.
  const wallet=await tx`
    select balance,locked_balance from public.angel_wallets
    where account_id=${input.actorId}::uuid for update
  `;
  if (!wallet[0]) throw new Error("WALLET_NOT_FOUND");
  const debited=await tx`
    update public.angel_wallets
    set balance=balance-${input.amount}::numeric, updated_at=now()
    where account_id=${input.actorId}::uuid
      and balance-locked_balance>=${input.amount}::numeric
    returning balance
  `;
  if (!debited[0]) throw new Error("INSUFFICIENT_AVAILABLE_BALANCE");

  const player=await tx`
    update public.angel_round_players
    set committed_amount=committed_amount+${input.amount}::numeric
    where round_id=${input.roundId}::uuid and account_id=${input.actorId}::uuid
    returning committed_amount
  `;
  if (!player.length) throw new Error("NOT_IN_ROUND");
  const pot=await tx`
    update public.angel_rounds
    set pot=pot+${input.amount}::numeric
    where id=${input.roundId}::uuid and settlement_status='PENDING'
    returning pot
  `;
  if (!pot[0]) throw new Error("ROUND_NOT_SANDBOX");

  const event=await tx`
    insert into public.angel_ledger_events(idempotency_key,event_type,round_id,metadata)
    values (${'sandbox:'+input.requestId},'SANDBOX_BET',${input.roundId}::uuid,
      ${tx.json({source:"staging-rollback-test",action:"SANDBOX_DEBIT"})})
    returning id
  `;
  const eventId=String(event[0]?.['id']);
  await tx`
    insert into public.angel_ledger_entries(event_id,account_id,amount)
    values(${eventId}::uuid,${input.actorId}::uuid,-${input.amount}::numeric)
  `;
  await tx`
    insert into public.angel_game_actions(round_id,actor_id,request_id,action_type,amount)
    values(${input.roundId}::uuid,${input.actorId}::uuid,${input.requestId},'SANDBOX_DEBIT',${input.amount}::numeric)
  `;
  await tx`
    insert into public.angel_bet_receipts
    (request_id,round_id,account_id,action,amount,wallet_after,pot_after,ledger_event_id)
    values (${input.requestId},${input.roundId}::uuid,${input.actorId}::uuid,
      'SANDBOX_DEBIT',${input.amount}::numeric,
      ${String(debited[0]['balance'])}::numeric,
      ${String(pot[0]['pot'])}::numeric,${eventId}::uuid)
  `;
  return {reused:false,walletAfter:String(debited[0]['balance']),
    potAfter:String(pot[0]['pot'])};
}
