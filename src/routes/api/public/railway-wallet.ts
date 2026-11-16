import {createFileRoute} from "@tanstack/react-router";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
const enabled=()=>process.env['BACKEND_MODE']==="railway_postgres_staging" &&
  process.env['RAILWAY_ENVIRONMENT_NAME']==="staging" &&
  process.env['ANGEL_AUTH_PREVIEW_ENABLED']==="true";
export const Route=createFileRoute("/api/public/railway-wallet")({
  server:{handlers:{
    GET:async({request})=>{
      if(!enabled())return json({error:"NOT_FOUND"},404);
      try{
        const {tokenFromCookie,getRailwaySession}=await import("@/lib/railway/session.server");
        const token=tokenFromCookie(request.headers.get("cookie"));
        const account=token?await getRailwaySession(token):null;
        if(!account)return json({error:"UNAUTHORIZED"},401);
        const {getOwnRailwayWallet}=await import("@/lib/railway/wallet.server");
        return json({wallet:await getOwnRailwayWallet(account.id)});
      }catch{
        return json({error:"WALLET_UNAVAILABLE"},503);
      }
    }
  }}
});
