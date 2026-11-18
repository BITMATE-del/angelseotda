/**
 * Railway-only read-only wallet screen model.
 * No deposits, withdrawals, balance adjustment or settlement endpoints.
 * Never accepts a user/account ID from the request; caller identity is
 * obtained from an unexpired server-side Telegram session.
 */
import postgres from "postgres";

let pool:ReturnType<typeof postgres>|undefined;
function db(){
  if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
     process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
     !process.env['DATABASE_URL'])throw new Error("STAGING_ONLY");
  pool??=postgres(process.env['DATABASE_URL'],{max:4,prepare:false,connect_timeout:10});
  return pool;
}
export async function getOwnRailwayWallet(accountId:string){
  const rows=await db()`
    select w.balance,w.locked_balance,(w.balance-w.locked_balance) as available
    from public.angel_wallets w
    join public.angel_accounts a on a.id=w.account_id and a.status='ACTIVE'
    where w.account_id=${accountId}::uuid
    limit 1
  `;
  const wallet=rows[0];
  if(!wallet)throw new Error("WALLET_NOT_FOUND");
  const recent=await db()`
    select e.id,e.amount,e.created_at,v.event_type
    from public.angel_ledger_entries e
    join public.angel_ledger_events v on v.id=e.event_id
    where e.account_id=${accountId}::uuid
    order by e.created_at desc,e.id desc limit 20
  `;
  return {
    balance:String(wallet['balance']),
    locked:String(wallet['locked_balance']),
    available:String(wallet['available']),
    transactions:recent.map(r=>({
      id:String(r['id']),amount:String(r['amount']),
      type:String(r['event_type']),
      createdAt:new Date(r['created_at'] as string).toISOString(),
    })),
    depositEnabled:false,withdrawEnabled:false,settlementEnabled:false,
  };
}
